import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export class AcceptRideDto {
  @IsUUID()
  driverId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  driverName?: string;

  /** Total road route (driver → pickup → drop-off), km — from driver's GPS + OSRM; updates fare. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  routedDistanceKm?: number;

  /** Road distance driver GPS → pickup, km — optional metadata for riders. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  distanceToPickupKm?: number;

  /** Driver’s GPS position at accept time — echoed to rider for map placement and route redraw. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  driverLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  driverLng?: number;
}
