import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CreateRideDto } from "./dto/create-ride.dto";

type RideStatus =
  | "requested"
  | "accepted"
  | "driver_arriving"
  | "in_progress"
  | "completed"
  | "canceled";

type RideRecord = {
  id: string;
  passengerId: string;
  driverId: string | null;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  status: RideStatus;
  price: number;
  dropoffLabel?: string;
  routedDistanceKm?: number;
  distanceToPickupKm?: number;
  paymentTransactionId?: string;
};

@Injectable()
export class RidesService {
  private readonly rides = new Map<string, RideRecord>();

  async createRide(payload: CreateRideDto): Promise<RideRecord> {
    const id = randomUUID();
    const estimatedPrice = this.estimatePrice(payload);

    const record: RideRecord = {
      id,
      passengerId: payload.passengerId,
      driverId: null,
      pickup: { lat: payload.pickupLat, lng: payload.pickupLng },
      dropoff: { lat: payload.dropoffLat, lng: payload.dropoffLng },
      status: "requested",
      price: estimatedPrice,
      ...(payload.dropoffLabel ? { dropoffLabel: payload.dropoffLabel } : {}),
      ...(payload.routedDistanceKm != null ? { routedDistanceKm: payload.routedDistanceKm } : {}),
      ...(payload.distanceToPickupKm != null ? { distanceToPickupKm: payload.distanceToPickupKm } : {})
    };

    this.rides.set(id, record);
    return record;
  }

  /**
   * First driver to claim wins; concurrent accepts beyond the first receive `taken`.
   */
  acceptRide(
    rideId: string,
    driverId: string,
    driverRoutedPricing?: {
      routedDistanceKm?: number;
      distanceToPickupKm?: number;
    }
  ): { ok: true; record: RideRecord } | { ok: false; reason: "not_found" | "taken" } {
    const ride = this.rides.get(rideId);
    if (!ride) {
      return { ok: false, reason: "not_found" };
    }
    if (ride.status !== "requested" || ride.driverId !== null) {
      return { ok: false, reason: "taken" };
    }

    ride.driverId = driverId;
    ride.status = "accepted";

    const rKm = driverRoutedPricing?.routedDistanceKm;
    if (rKm != null && rKm > 0) {
      ride.routedDistanceKm = rKm;
      ride.price = this.priceFromRoutedKm(rKm);
      if (driverRoutedPricing?.distanceToPickupKm != null) {
        ride.distanceToPickupKm = driverRoutedPricing.distanceToPickupKm;
      }
    }

    return { ok: true, record: { ...ride } };
  }

  getRide(id: string): RideRecord {
    const ride = this.rides.get(id);
    if (!ride) {
      throw new NotFoundException("Ride not found");
    }

    return ride;
  }

  cancelRide(id: string): RideRecord {
    const ride = this.rides.get(id);
    if (!ride) {
      throw new NotFoundException("Ride not found");
    }
    ride.status = "canceled";
    return { ...ride };
  }

  completeRide(id: string): RideRecord {
    const ride = this.rides.get(id);
    if (!ride) {
      throw new NotFoundException("Ride not found");
    }
    ride.status = "completed";
    return { ...ride };
  }

  attachPaymentTransaction(rideId: string, txId: string) {
    const ride = this.rides.get(rideId);
    if (!ride) return;
    ride.paymentTransactionId = txId;
  }

  private estimatePrice(payload: CreateRideDto): number {
    if (payload.routedDistanceKm != null && payload.routedDistanceKm > 0) {
      return this.priceFromRoutedKm(payload.routedDistanceKm);
    }
    const distanceFactor =
      Math.abs(payload.pickupLat - payload.dropoffLat) +
      Math.abs(payload.pickupLng - payload.dropoffLng);
    return Number((6 + distanceFactor * 120).toFixed(2));
  }

  private priceFromRoutedKm(routedKm: number): number {
    return Number((4 + routedKm * 2.2).toFixed(2));
  }
}
