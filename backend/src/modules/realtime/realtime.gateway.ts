import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

export type RideOfferPayload = {
  id: string;
  passengerId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  status: string;
  price: number;
  dropoffLabel?: string;
  routedDistanceKm?: number;
  distanceToPickupKm?: number;
};

export type DeliveryOfferPayload = {
  id: string;
  orderId: string;
  restaurant: { lat: number; lng: number };
  customer: { lat: number; lng: number };
  status: string;
};

/** Outbound payload shape Nexo POSTs to `YAMMA_WEBHOOK_URL` and accepts at `integrations/yamma/delivery-webhook`. */
export type NexoYammaDeliveryWebhookPayload = {
  event:
    | "accepted"
    | "picked_up"
    | "in_transit"
    | "delivered"
    | "cancelled"
    | "going_to_restaurant";
  orderId: string;
  driverId: string;
  timestamp: string;
  deliveryId?: string;
  buyerFacingStatus?: string;
};

function buyerHeadlineFromDeliveryWebhook(p: NexoYammaDeliveryWebhookPayload): string {
  if (p.buyerFacingStatus === "on_the_way") return "On the way";
  if (p.event === "in_transit") return "On the way";
  if (p.event === "going_to_restaurant") return "Heading to restaurant";
  if (p.event === "picked_up") return "Picked up";
  if (p.event === "delivered") return "Delivered";
  if (p.event === "cancelled") return "Canceled";
  if (p.event === "accepted") return "Driver assigned";
  return "Order update";
}

@WebSocketGateway({
  cors: { origin: "*" }
})
export class RealtimeGateway {
  @WebSocketServer()
  server!: Server;

  notifyRideOffer(ride: RideOfferPayload) {
    this.server.to("drivers").emit("ride:offer", { ride });
  }

  notifyDeliveryOffer(delivery: DeliveryOfferPayload) {
    this.server.to("drivers").emit("delivery:offer", { delivery });
  }

  notifyRideTaken(rideId: string) {
    this.server.to("drivers").emit("ride:taken", { rideId });
  }

  notifyDeliveryTaken(deliveryId: string) {
    this.server.to("drivers").emit("delivery:taken", { deliveryId });
  }

  notifyRideStatus(rideId: string, status: string) {
    this.server.emit("ride:status:updated", { rideId, status });
  }

  notifyDeliveryStatus(deliveryId: string, status: string, orderId?: string) {
    this.server.emit("delivery:status:updated", { deliveryId, status, ...(orderId ? { orderId } : {}) });
  }

  /**
   * Buyer / Yamma-facing order tracker (Nexo web “passenger” tab and any client listening).
   * Invoked when Nexo notifies Yamma and when `POST .../delivery-webhook` receives the same payload.
   */
  emitYammaBuyerDeliveryWebhook(payload: NexoYammaDeliveryWebhookPayload) {
    const buyerHeadline = buyerHeadlineFromDeliveryWebhook(payload);
    this.server.emit("yamma:buyer:delivery", {
      orderId: payload.orderId,
      deliveryId: payload.deliveryId,
      driverId: payload.driverId,
      event: payload.event,
      buyerFacingStatus: payload.buyerFacingStatus,
      buyerHeadline,
      timestamp: payload.timestamp
    });
  }

  notifyRideAccepted(
    passengerId: string,
    payload: {
      rideId: string;
      driverId: string;
      driverName?: string;
      pickup: { lat: number; lng: number };
      dropoff: { lat: number; lng: number };
      price: number;
      routedDistanceKm?: number;
      distanceToPickupKm?: number;
      driverLat?: number;
      driverLng?: number;
    }
  ) {
    this.server.to(`passenger:${passengerId}`).emit("ride:accepted", payload);
  }

  notifyDeliveryAccepted(
    payload: {
      deliveryId: string;
      orderId: string;
      driverId: string;
      restaurant: { lat: number; lng: number };
      customer: { lat: number; lng: number };
    }
  ) {
    this.server.to("drivers").emit("delivery:accepted", payload);
  }

  @SubscribeMessage("passenger:join")
  handlePassengerJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { passengerId?: string }
  ) {
    const passengerId = payload?.passengerId;
    if (!passengerId || typeof passengerId !== "string") {
      return { ok: false };
    }
    void client.join(`passenger:${passengerId}`);
    return { ok: true };
  }

  @SubscribeMessage("driver:join")
  handleDriverJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: { driverId?: string }) {
    const driverId = payload?.driverId;
    if (!driverId || typeof driverId !== "string") {
      return { ok: false };
    }
    void client.join("drivers");
    void client.join(`driver:${driverId}`);
    return { ok: true };
  }

  @SubscribeMessage("driver:leave")
  handleDriverLeave(@ConnectedSocket() client: Socket) {
    void client.leave("drivers");
    return { ok: true };
  }

  @SubscribeMessage("driver:location")
  onDriverLocation(
    @MessageBody()
    payload: {
      rideId?: string;
      driverId: string;
      lat: number;
      lng: number;
      speed?: number;
      etaSeconds?: number;
      remainingKm?: number;
    }
  ) {
    this.server.emit("driver:location:updated", payload);
    return { ok: true };
  }

  @SubscribeMessage("ride:status")
  onRideStatus(@MessageBody() payload: { rideId: string; status: string }) {
    this.server.emit("ride:status:updated", payload);
    return { ok: true };
  }
}
