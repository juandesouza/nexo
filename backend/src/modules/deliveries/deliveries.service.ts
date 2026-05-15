import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CreateDeliveryDto } from "./dto/create-delivery.dto";

type DeliveryStatus =
  | "requested"
  | "accepted"
  | "going_to_restaurant"
  | "picked_up"
  | "delivering"
  | "delivered"
  | "canceled";

type DeliveryRecord = {
  id: string;
  driverId: string | null;
  status: DeliveryStatus;
  orderId: string;
  restaurant: { lat: number; lng: number };
  customer: { lat: number; lng: number };
};

@Injectable()
export class DeliveriesService {
  private readonly store = new Map<string, DeliveryRecord>();

  create(payload: CreateDeliveryDto): DeliveryRecord {
    const record: DeliveryRecord = {
      id: randomUUID(),
      driverId: null,
      status: "requested",
      orderId: payload.orderId,
      restaurant: { lat: payload.restaurantLat, lng: payload.restaurantLng },
      customer: { lat: payload.customerLat, lng: payload.customerLng }
    };
    this.store.set(record.id, record);
    return record;
  }

  getById(id: string): DeliveryRecord {
    const record = this.store.get(id);
    if (!record) {
      throw new NotFoundException("Delivery not found");
    }
    return record;
  }

  acceptDelivery(id: string, driverId: string): DeliveryRecord {
    const record = this.store.get(id);
    if (!record) {
      throw new NotFoundException("Delivery not found");
    }
    if (record.status !== "requested") {
      return { ...record };
    }
    record.driverId = driverId;
    record.status = "accepted";
    return { ...record };
  }

  updateStatus(id: string, status: DeliveryStatus): DeliveryRecord {
    const record = this.store.get(id);
    if (!record) {
      throw new NotFoundException("Delivery not found");
    }
    record.status = status;
    return { ...record };
  }
}
