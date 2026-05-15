import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { SetupDriverPayoutDto } from "./dto/setup-driver-payout.dto";
import { SetupPaymentMethodDto } from "./dto/setup-payment-method.dto";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get("method/:passengerId")
  getMethodStatus(@Param("passengerId") passengerId: string) {
    return { configured: this.payments.hasPaymentMethod(passengerId) };
  }

  @Post("method")
  async setupMethod(@Body() payload: SetupPaymentMethodDto) {
    return this.payments.setupPassengerPaymentMethod(payload);
  }

  @Get("payout/:driverId")
  getPayoutStatus(@Param("driverId") driverId: string) {
    return { configured: this.payments.hasDriverPayoutMethod(driverId) };
  }

  @Post("payout")
  setupPayout(@Body() payload: SetupDriverPayoutDto) {
    return this.payments.setupDriverPayoutMethod(payload);
  }
}

