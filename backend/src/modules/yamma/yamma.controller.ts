import { BadRequestException, Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from "@nestjs/common";
import { IsLatitude, IsLongitude, IsObject, IsOptional, IsString, ValidateIf } from "class-validator";
import { NexoDeliveryWebhookDto } from "./dto/nexo-delivery-webhook.dto";
import { YammaService } from "./yamma.service";

class YammaOrderWebhookDto {
  @IsString()
  orderId!: string;

  @IsLatitude()
  @ValidateIf((o: YammaOrderWebhookDto) => o.restaurantLat != null || o.pickup?.latitude == null)
  restaurantLat!: number;

  @IsLongitude()
  @ValidateIf((o: YammaOrderWebhookDto) => o.restaurantLng != null || o.pickup?.longitude == null)
  restaurantLng!: number;

  @IsLatitude()
  @ValidateIf((o: YammaOrderWebhookDto) => o.customerLat != null || o.dropoff?.latitude == null)
  customerLat!: number;

  @IsLongitude()
  @ValidateIf((o: YammaOrderWebhookDto) => o.customerLng != null || o.dropoff?.longitude == null)
  customerLng!: number;

  @IsOptional()
  @IsObject()
  pickup?: { latitude?: number; longitude?: number };

  @IsOptional()
  @IsObject()
  dropoff?: { latitude?: number; longitude?: number };
}

@Controller("integrations/yamma")
export class YammaController {
  constructor(private readonly yammaService: YammaService) {}

  @Post("orders-created")
  onOrderCreated(@Body() payload: YammaOrderWebhookDto, @Headers("authorization") auth?: string) {
    const expected = process.env.YAMMA_DISPATCH_TOKEN?.trim();
    if (expected) {
      const got = auth?.replace(/^Bearer\s+/i, "").trim();
      if (got !== expected) {
        throw new UnauthorizedException("Invalid Yamma dispatch token.");
      }
    }

    const restaurantLat = payload.restaurantLat ?? payload.pickup?.latitude;
    const restaurantLng = payload.restaurantLng ?? payload.pickup?.longitude;
    const customerLat = payload.customerLat ?? payload.dropoff?.latitude;
    const customerLng = payload.customerLng ?? payload.dropoff?.longitude;
    if (
      restaurantLat == null ||
      restaurantLng == null ||
      customerLat == null ||
      customerLng == null
    ) {
      throw new BadRequestException("Missing pickup/dropoff coordinates for delivery handoff.");
    }

    return this.yammaService.createDeliveryFromOrder({
      orderId: payload.orderId,
      restaurantLat,
      restaurantLng,
      customerLat,
      customerLng
    });
  }

  @Post("order-ready-for-delivery")
  onOrderReady(@Body() payload: YammaOrderWebhookDto, @Headers("authorization") auth?: string) {
    return this.onOrderCreated(payload, auth);
  }

  /**
   * Inbound handler for the same JSON Nexo POSTs to `YAMMA_WEBHOOK_URL`.
   * Validates auth and body shape. (Nexo already emits `yamma:buyer:delivery` over Socket.IO before calling
   * the outbound URL, so this route does not re-emit — safe to point `YAMMA_WEBHOOK_URL` here in dev.)
   * Yamma’s own server should mirror this: verify token, persist `buyerFacingStatus` / headline for the buyer UI.
   */
  @Post("delivery-webhook")
  @HttpCode(200)
  onNexoDeliveryWebhook(
    @Body() body: NexoDeliveryWebhookDto,
    @Headers("x-nexo-delivery-token") token?: string
  ) {
    const secret = process.env.YAMMA_WEBHOOK_SECRET?.trim();
    if (secret && token !== secret) {
      throw new UnauthorizedException("Invalid delivery webhook token.");
    }
    return { ok: true, received: { orderId: body.orderId, event: body.event, buyerFacingStatus: body.buyerFacingStatus } };
  }
}
