import { IsLatitude, IsLongitude, IsString } from "class-validator";

export class CreateDeliveryDto {
  @IsString()
  orderId!: string;

  @IsLatitude()
  restaurantLat!: number;

  @IsLongitude()
  restaurantLng!: number;

  @IsLatitude()
  customerLat!: number;

  @IsLongitude()
  customerLng!: number;
}
