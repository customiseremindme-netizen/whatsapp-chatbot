import { BillingController } from "./billing";
import "reflect-metadata";
import { EntitlementError } from "@portalflow/core";
import {
  AdminController,
  ConfigurationController,
  PlatformAdminGuard,
} from "./admin";
import { BotsController, LeadsController } from "./bots";
import {
  Module,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
  Controller,
  Get,
  Inject,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { Response, Request, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import Redis from "ioredis";
import { Database } from "./database";
import { Accounts } from "./accounts";
import { AuthGuard, Public } from "./auth";
import { AuthController, TenantController } from "./controllers";
import { config, allowedOrigins, originAllowed } from "./config";
import {
  ContactsController,
  ConversationsController,
  MockWhatsAppController,
} from "./messaging";
import { InboxGateway } from "./inbox.gateway";
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof EntitlementError
        ? 403
        : error instanceof HttpException
          ? error.getStatus()
          : 500;
    if (status === 500)
      console.error(
        JSON.stringify({
          event: "request.error",
          type: error instanceof Error ? error.name : "Unknown",
        }),
      );
    res.status(status).json({
      statusCode: status,
      error:
        error instanceof EntitlementError
          ? { message: error.message, code: error.code }
          : error instanceof HttpException
            ? error.getResponse()
            : "Internal server error",
    });
  }
}
@Controller("health")
class Health {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Public() @Get() async health() {
    await this.database.db.$queryRaw`SELECT 1`;
    return { status: "ok" };
  }
}
@Module({
  controllers: [
    BillingController,
    AdminController,
    ConfigurationController,
    BotsController,
    LeadsController,
    AuthController,
    TenantController,
    Health,
    ContactsController,
    ConversationsController,
    MockWhatsAppController,
  ],
  providers: [
    PlatformAdminGuard,
    Database,
    Accounts,
    InboxGateway,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new Errors());
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  });
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  redis.on("error", () =>
    console.error(JSON.stringify({ event: "redis.unavailable" })),
  );
  await redis.connect();
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !originAllowed(req.headers.origin)
    ) {
      if (config.NODE_ENV !== "production")
        console.warn(
          JSON.stringify({
            event: "origin.rejected",
            origin: String(req.headers.origin ?? "").slice(0, 200),
          }),
        );
      res.status(403).json({ error: "Origin not permitted" });
      return;
    }
    try {
      const auth =
        req.path.startsWith("/api/v1/auth/") &&
        ![
          "/api/v1/auth/me",
          "/api/v1/auth/sessions",
          "/api/v1/auth/refresh",
          // Signing out must never be blocked by the login/registration limiter.
          "/api/v1/auth/logout",
        ].includes(req.path);
      const key = `limit:${auth ? "auth" : "api"}:${req.ip}:${Math.floor(Date.now() / 60000)}`;
      const count = (await redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
        1,
        key,
      )) as number;
      if (count > (auth ? 30 : 300)) {
        res.setHeader("Retry-After", "60");
        res.status(429).json({ error: "Too many requests" });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: "Rate limiter unavailable" });
    }
  });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("PortalFlow Phase 1 API")
      .setVersion("0.1.0")
      .addCookieAuth("pf_access")
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document);
  const close = app.close.bind(app);
  app.close = async () => {
    redis.disconnect();
    await close();
  };
  return app;
}
