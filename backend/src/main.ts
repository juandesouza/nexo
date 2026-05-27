import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";
import { parseCorsOrigins, parseEnv } from "./config/env";

async function bootstrap() {
  let env;
  try {
    env = parseEnv(process.env);
  } catch (err) {
    console.error("[nexo-api] Invalid environment configuration:", err);
    process.exit(1);
  }
  const app = await NestFactory.create(AppModule);

  const corsOrigin = parseCorsOrigins(env.CORS_ORIGINS);
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Bypass-Tunnel-Reminder",
      "bypass-tunnel-reminder"
    ]
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );
  app.setGlobalPrefix(`api/${env.BACKEND_VERSION}`);

  const port = Number(env.PORT);
  await app.listen(port, "0.0.0.0");
  const mode = env.NODE_ENV === "production" ? "production" : "development";
  console.log(`Nexo API listening on 0.0.0.0:${port} (${mode}, /api/${env.BACKEND_VERSION})`);
}

void bootstrap();
