import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { AcceptRideDto } from "./dto/accept-ride.dto";
import { CreateRideDto } from "./dto/create-ride.dto";
import { PaymentsService } from "../payments/payments.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RidesService } from "./rides.service";

@Controller("rides")
export class RidesController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly payments: PaymentsService,
    private readonly realtime: RealtimeGateway
  ) {}

  @Post()
  async create(@Body() payload: CreateRideDto) {
    const ride = await this.ridesService.createRide(payload);
    this.realtime.notifyRideOffer({
      id: ride.id,
      passengerId: ride.passengerId,
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      status: ride.status,
      price: ride.price,
      dropoffLabel: ride.dropoffLabel,
      routedDistanceKm: ride.routedDistanceKm,
      distanceToPickupKm: ride.distanceToPickupKm
    });
    return ride;
  }

  @Post(":id/accept")
  async accept(@Param("id") rideId: string, @Body() body: AcceptRideDto) {
    const result = this.ridesService.acceptRide(rideId, body.driverId, {
      routedDistanceKm: body.routedDistanceKm,
      distanceToPickupKm: body.distanceToPickupKm
    });
    if (!result.ok) {
      if (result.reason === "not_found") {
        throw new NotFoundException("Ride not found");
      }
      throw new ConflictException("This ride was already accepted by another driver.");
    }

    const { record } = result;
    const charged = await this.payments.chargePassengerForRide({
      passengerId: record.passengerId,
      amount: record.price,
      rideId: record.id
    });
    if (!charged.ok) {
      // Release ride immediately when pre-charge fails; rider can retry.
      this.ridesService.cancelRide(record.id);
      this.realtime.notifyRideTaken(record.id);
      this.realtime.notifyRideStatus(record.id, "canceled");
      throw new ConflictException("Could not charge passenger at accept time. Ride canceled.");
    }
    this.ridesService.attachPaymentTransaction(record.id, charged.transactionId);

    this.realtime.notifyRideTaken(record.id);
    const driverPosOk =
      body.driverLat != null &&
      body.driverLng != null &&
      Number.isFinite(body.driverLat) &&
      Number.isFinite(body.driverLng);
    this.realtime.notifyRideAccepted(record.passengerId, {
      rideId: record.id,
      driverId: body.driverId,
      driverName: body.driverName,
      pickup: record.pickup,
      dropoff: record.dropoff,
      price: record.price,
      routedDistanceKm: record.routedDistanceKm,
      distanceToPickupKm: record.distanceToPickupKm,
      ...(driverPosOk ? { driverLat: body.driverLat, driverLng: body.driverLng } : {})
    });

    return { ...record, payment: charged };
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.ridesService.getRide(id);
  }

  @Post(":id/cancel")
  async cancelRide(@Param("id") rideId: string) {
    const before = this.ridesService.getRide(rideId);
    const ride = this.ridesService.cancelRide(rideId);
    this.realtime.notifyRideTaken(rideId);
    this.realtime.notifyRideStatus(rideId, "canceled");
    const refund =
      before.paymentTransactionId && before.status !== "canceled"
        ? await this.payments.refundRideCharge({
            transactionId: before.paymentTransactionId,
            rideId
          })
        : { ok: false as const, reason: "not_applicable" as const };
    return { ...ride, refund };
  }

  @Post(":id/complete")
  async completeRide(@Param("id") rideId: string) {
    const ride = this.ridesService.completeRide(rideId);
    this.realtime.notifyRideStatus(rideId, "driver_arrived_dropoff");
    return {
      ...ride,
      payment: ride.paymentTransactionId
        ? { ok: true as const, transactionId: ride.paymentTransactionId, stage: "accepted" as const }
        : { ok: false as const, reason: "missing_charge" as const }
    };
  }
}
