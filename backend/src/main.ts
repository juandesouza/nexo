import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";
import { parseEnv } from "./config/env";

async function bootstrap() {
  const env = parseEnv(process.env);
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );
  app.setGlobalPrefix(`api/${env.BACKEND_VERSION}`);

  await app.listen(Number(env.PORT));
}

void bootstrap();
