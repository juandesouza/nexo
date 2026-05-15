import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class SetupDriverPayoutDto {
  @IsUUID()
  driverId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountHolder!: string;

  /** Testing-mode payout destination (e.g. email / PIX key / phone). */
  @IsString()
  @MinLength(4)
  @MaxLength(180)
  payoutDestination!: string;
}

