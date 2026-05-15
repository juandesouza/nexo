import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

/** Body Nexo POSTs to Yamma (`YAMMA_WEBHOOK_URL`) and accepts back at `POST .../delivery-webhook`. */
export class NexoDeliveryWebhookDto {
  @IsIn(["accepted", "picked_up", "in_transit", "delivered", "cancelled", "going_to_restaurant"])
  event!:
    | "accepted"
    | "picked_up"
    | "in_transit"
    | "delivered"
    | "cancelled"
    | "going_to_restaurant";

  @IsString()
  orderId!: string;

  @IsUUID()
  driverId!: string;

  @IsString()
  timestamp!: string;

  @IsOptional()
  @IsUUID()
  deliveryId?: string;

  @IsOptional()
  @IsString()
  buyerFacingStatus?: string;
}
