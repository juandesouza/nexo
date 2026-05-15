import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import crypto from "node:crypto";
import { IsIn, IsString, IsUUID } from "class-validator";
import { CreateDeliveryDto } from "./dto/create-delivery.dto";
import { DeliveriesService } from "./deliveries.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

class AcceptDeliveryDto {
  @IsUUID()
  driverId!: string;
}

class DeliveryStatusDto {
  @IsIn(["going_to_restaurant", "picked_up", "delivering", "delivered", "canceled"])
  status!: "going_to_restaurant" | "picked_up" | "delivering" | "delivered" | "canceled";

  @IsString()
  @IsUUID()
  driverId!: string;
}

@Controller("deliveries")
export class DeliveriesController {
  constructor(
    private readonly deliveriesService: DeliveriesService,
    private readonly realtime: RealtimeGateway
  ) {}

  private async notifyYammaWebhook(payload: {
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
    /** Nexo delivery id (correlation). */
    deliveryId?: string;
    /**
     * Normalized label for Yamma buyer UI (e.g. order tracker).
     * On driver accept we set `on_the_way` so the buyer sees food is en route.
     */
    buyerFacingStatus?: string;
  }) {
    this.realtime.emitYammaBuyerDeliveryWebhook(payload);

    const url = process.env.YAMMA_WEBHOOK_URL?.trim();
    if (!url) return;
    const body = JSON.stringify(payload);
    const secret = process.env.YAMMA_WEBHOOK_SECRET?.trim();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) {
      headers["x-delivery-signature"] = crypto.createHmac("sha256", secret).update(body).digest("hex");
      headers["x-nexo-delivery-token"] = secret;
    }
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      if (!res.ok && process.env.NODE_ENV !== "production") {
        const errText = await res.text().catch(() => "");
        console.warn(`[Yamma webhook] POST ${url} → ${res.status}`, errText.slice(0, 400));
      }
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[Yamma webhook] fetch failed:", e);
      }
      // Yamma may be offline during local development; do not block delivery state changes.
    }
  }

  @Post()
  create(@Body() payload: CreateDeliveryDto) {
    const delivery = this.deliveriesService.create(payload);
    this.realtime.notifyDeliveryOffer({
      id: delivery.id,
      orderId: delivery.orderId,
      restaurant: delivery.restaurant,
      customer: delivery.customer,
      status: delivery.status
    });
    return delivery;
  }

  @Post(":id/accept")
  async accept(@Param("id") id: string, @Body() payload: AcceptDeliveryDto) {
    const delivery = this.deliveriesService.acceptDelivery(id, payload.driverId);
    this.realtime.notifyDeliveryTaken(id);
    this.realtime.notifyDeliveryAccepted({
      deliveryId: delivery.id,
      orderId: delivery.orderId,
      driverId: payload.driverId,
      restaurant: delivery.restaurant,
      customer: delivery.customer
    });
    this.realtime.notifyDeliveryStatus(id, "accepted", delivery.orderId);
    // Yamma HTTP webhook: `accepted` triggers `markInTransitFromPartner` (order → in_transit).
    // `in_transit` without `location` is ignored there; do not use it for this transition.
    // Nexo socket headline still uses buyerFacingStatus for “On the way”.
    await this.notifyYammaWebhook({
      event: "accepted",
      orderId: delivery.orderId,
      driverId: payload.driverId,
      deliveryId: delivery.id,
      timestamp: new Date().toISOString(),
      buyerFacingStatus: "on_the_way"
    });
    return delivery;
  }

  @Post(":id/status")
  async updateStatus(@Param("id") id: string, @Body() payload: DeliveryStatusDto) {
    const delivery = this.deliveriesService.updateStatus(id, payload.status);
    this.realtime.notifyDeliveryStatus(id, payload.status, delivery.orderId);
    const event =
      payload.status === "delivering"
        ? "in_transit"
        : payload.status === "canceled"
          ? "cancelled"
          : payload.status === "going_to_restaurant"
            ? "going_to_restaurant"
            : (payload.status as "picked_up" | "delivered");
    await this.notifyYammaWebhook({
      event,
      orderId: delivery.orderId,
      driverId: payload.driverId,
      timestamp: new Date().toISOString()
    });
    return delivery;
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.deliveriesService.getById(id);
  }
}
