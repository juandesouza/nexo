import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "../app.controller";
import { AuthModule } from "./auth/auth.module";
import { DeliveriesModule } from "./deliveries/deliveries.module";
import { MatchingModule } from "./matching/matching.module";
import { PaymentsModule } from "./payments/payments.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { RidesModule } from "./rides/rides.module";
import { YammaModule } from "./yamma/yamma.module";

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    RidesModule,
    DeliveriesModule,
    RealtimeModule,
    MatchingModule,
    PaymentsModule,
    YammaModule
  ]
})
export class AppModule {}
