import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class SetupPaymentMethodDto {
  @IsUUID()
  passengerId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  paymentMethodNonce!: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  email?: string;
}

