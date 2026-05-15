import { Module } from "@nestjs/common";
import { DeliveriesModule } from "../deliveries/deliveries.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { YammaController } from "./yamma.controller";
import { YammaService } from "./yamma.service";

@Module({
  imports: [DeliveriesModule, RealtimeModule],
  controllers: [YammaController],
  providers: [YammaService]
})
export class YammaModule {}
