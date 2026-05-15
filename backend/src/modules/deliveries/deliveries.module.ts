import { Module } from "@nestjs/common";
import { DeliveriesController } from "./deliveries.controller";
import { DeliveriesService } from "./deliveries.service";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService]
})
export class DeliveriesModule {}
