import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { RidesController } from "./rides.controller";
import { RidesService } from "./rides.service";

@Module({
  imports: [RealtimeModule, PaymentsModule],
  controllers: [RidesController],
  providers: [RidesService]
})
export class RidesModule {}
