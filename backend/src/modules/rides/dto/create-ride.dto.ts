import { Type } from "class-transformer";
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, MaxLength, Min, IsUUID } from "class-validator";

export class CreateRideDto {
  @IsUUID()
  passengerId!: string;

  @IsLatitude()
  pickupLat!: number;

  @IsLongitude()
  pickupLng!: number;

  @IsLatitude()
  dropoffLat!: number;

  @IsLongitude()
  dropoffLng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  dropoffLabel?: string;

  /** Total road distance (driver → pickup → drop-off), km — from client OSRM for demo pricing. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  routedDistanceKm?: number;

  /** Road distance driver → pickup only, km. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  distanceToPickupKm?: number;
}
