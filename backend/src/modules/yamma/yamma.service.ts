import { Injectable } from "@nestjs/common";
import { DeliveriesService } from "../deliveries/deliveries.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

type YammaOrderPayload = {
  orderId: string;
  restaurantLat: number;
  restaurantLng: number;
  customerLat: number;
  customerLng: number;
};

@Injectable()
export class YammaService {
  constructor(
    private readonly deliveriesService: DeliveriesService,
    private readonly realtime: RealtimeGateway
  ) {}

  createDeliveryFromOrder(payload: YammaOrderPayload) {
    const delivery = this.deliveriesService.create({
      orderId: payload.orderId,
      restaurantLat: payload.restaurantLat,
      restaurantLng: payload.restaurantLng,
      customerLat: payload.customerLat,
      customerLng: payload.customerLng
    });
    /** Same as `POST /deliveries` — Yamma was skipping this so drivers never got `delivery:offer`. */
    this.realtime.notifyDeliveryOffer({
      id: delivery.id,
      orderId: delivery.orderId,
      restaurant: delivery.restaurant,
      customer: delivery.customer,
      status: delivery.status
    });
    return delivery;
  }
}
