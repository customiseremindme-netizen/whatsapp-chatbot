import { lockTenant, subscriptionSummary } from "@portalflow/core";
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  configurationSchema,
  defaultConfiguration,
  pageSchema,
  planSchema,
  assignmentSchema,
} from "@portalflow/shared";
import { Database } from "./database";
import { AuthRequest, Public } from "./auth";
import { parse } from "./controllers";
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (!context.switchToHttp().getRequest<AuthRequest>().auth?.platformAdmin)
      throw new ForbiddenException("Platform administrator access required");
    return true;
  }
}
@Controller("configuration")
export class ConfigurationController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Public() @Get() async get() {
    return (
      (await this.database.db.platformConfiguration.findUnique({
        where: { id: "global" },
        select: {
          brandName: true,
          primaryColor: true,
          supportEmail: true,
          revision: true,
        },
      })) ?? defaultConfiguration
    );
  }
}
@ApiTags("Platform administration")
@ApiCookieAuth()
@UseGuards(PlatformAdminGuard)
@Controller("admin")
export class AdminController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get("overview") async overview() {
    const db = this.database.db;
    const [
      tenants,
      suspended,
      users,
      contacts,
      messages,
      flows,
      pendingInbound,
      failedMessages,
      pendingEmails,
    ] = await db.$transaction([
      db.tenant.count(),
      db.tenant.count({ where: { suspendedAt: { not: null } } }),
      db.user.count(),
      db.contact.count({ where: { deletedAt: null } }),
      db.message.count(),
      db.botFlow.count({
        where: { deletedAt: null, publishedVersion: { not: null } },
      }),
      db.inboundEvent.count({ where: { status: "PENDING" } }),
      db.message.count({ where: { status: "FAILED" } }),
      db.emailOutbox.count({ where: { sentAt: null } }),
    ]);
    return {
      tenants,
      suspended,
      users,
      contacts,
      messages,
      flows,
      pendingInbound,
      failedMessages,
      pendingEmails,
    };
  }
  @Get("tenants") async tenants(@Query() query: unknown) {
    const input = parse(pageSchema, query),
      db = this.database.db;
    const where = {
      name: { contains: input.search, mode: "insensitive" as const },
    };
    const [items, total] = await db.$transaction([
      db.tenant.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        include: {
          _count: {
            select: { memberships: true, contacts: true, conversations: true },
          },
        },
      }),
      db.tenant.count({ where }),
    ]);
    return { items, total, page: input.page, limit: input.limit };
  }
  @Patch("tenants/:id/status") async status(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    parse(z.string().uuid(), id);
    const input = parse(
      z
        .object({
          suspended: z.boolean(),
          reason: z.string().trim().min(3).max(500),
        })
        .strict(),
      body,
    );
    return this.database.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${id}::uuid FOR UPDATE`;
      const tenant = await tx.tenant.findUnique({
        where: { id },
        include: {
          memberships: {
            where: { user: { platformAdmin: true } },
            select: { id: true },
          },
        },
      });
      if (!tenant) throw new NotFoundException();
      if (input.suspended && tenant.memberships.length)
        throw new BadRequestException(
          "A workspace containing a platform administrator cannot be suspended",
        );
      const updated = await tx.tenant.update({
        where: { id },
        data: { suspendedAt: input.suspended ? new Date() : null },
      });
      if (input.suspended)
        await tx.session.updateMany({
          where: { tenantId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.platformAuditLog.create({
        data: {
          actorId: req.auth.userId,
          action: input.suspended ? "tenant.suspended" : "tenant.reactivated",
          resourceId: id,
          details: { reason: input.reason },
        },
      });
      return updated;
    });
  }
  @Get("tenants/:id/subscription") async subscription(@Param("id") id: string) {
    parse(z.string().uuid(), id);
    if (!(await this.database.db.tenant.findUnique({ where: { id } })))
      throw new NotFoundException();
    return this.database.db.$transaction((tx) => subscriptionSummary(tx, id));
  }
  @Patch("tenants/:id/subscription") async assign(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    parse(z.string().uuid(), id);
    const input = parse(assignmentSchema, body),
      expiresAt = new Date(input.expiresAt);
    if (input.status === "ACTIVE" && expiresAt <= new Date())
      throw new BadRequestException("Active grants require a future expiry");
    return this.database.db.$transaction(async (tx) => {
      await lockTenant(tx, id);
      if (!(await tx.tenant.findUnique({ where: { id } })))
        throw new NotFoundException();
      const current = await tx.tenantSubscription.findUnique({
        where: { tenantId: id },
      });
      if ((current?.revision ?? 0) !== input.revision)
        throw new ConflictException(
          "Access grant changed. Reload before saving.",
        );
      const plan = await tx.subscriptionPlan.findUnique({
        where: { id: input.planId },
      });
      if (
        !plan ||
        (plan.archived &&
          (current?.planId !== plan.id || input.status === "ACTIVE"))
      )
        throw new BadRequestException("Choose an available plan");
      const summary = await subscriptionSummary(tx, id);
      if (
        summary.usage.contacts > plan.maxContacts ||
        summary.usage.bots > plan.maxBots ||
        summary.usage.members + summary.usage.invitations > plan.maxMembers
      )
        throw new ConflictException(
          "Usage or reserved invitation seats exceed this plan. Reduce usage before downgrading.",
        );
      const data = {
        planId: plan.id,
        planName: plan.name,
        planRevision: plan.revision,
        monthlyPaise: plan.monthlyPaise,
        yearlyPaise: plan.yearlyPaise,
        maxNumbers: plan.maxNumbers,
        maxMembers: plan.maxMembers,
        maxContacts: plan.maxContacts,
        maxBots: plan.maxBots,
        status: input.status,
        expiresAt,
      };
      await tx.tenantSubscription.upsert({
        where: { tenantId: id },
        create: { ...data, tenantId: id },
        update: { ...data, revision: { increment: 1 } },
      });
      await tx.platformAuditLog.create({
        data: {
          actorId: req.auth.userId,
          action: "subscription.manual_grant",
          resourceId: id,
          details: { ...input, source: "MANUAL", planRevision: plan.revision },
        },
      });
      return subscriptionSummary(tx, id);
    });
  }
  @Get("users") async users(@Query() query: unknown) {
    const input = parse(pageSchema, query),
      db = this.database.db;
    const where = {
      OR: [
        { email: { contains: input.search, mode: "insensitive" as const } },
        { name: { contains: input.search, mode: "insensitive" as const } },
      ],
    };
    const [items, total] = await db.$transaction([
      db.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          emailVerifiedAt: true,
          platformAdmin: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      db.user.count({ where }),
    ]);
    return { items, total, page: input.page, limit: input.limit };
  }
  @Get("plans") plans() {
    return this.database.db.subscriptionPlan.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }
  @Post("plans") async createPlan(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const input = parse(planSchema, body);
    return this.database.db.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.create({ data: input });
      await tx.platformAuditLog.create({
        data: {
          actorId: req.auth.userId,
          action: "plan.created",
          resourceId: plan.id,
          details: input,
        },
      });
      return plan;
    });
  }
  @Patch("plans/:id") async updatePlan(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    parse(z.string().uuid(), id);
    const { revision, ...data } = parse(
      planSchema.extend({ revision: z.number().int().positive() }),
      body,
    );
    return this.database.db.$transaction(async (tx) => {
      const changed = await tx.subscriptionPlan.updateMany({
        where: { id, revision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (!changed.count)
        throw new ConflictException(
          "Plan changed or no longer exists. Reload before saving.",
        );
      await tx.platformAuditLog.create({
        data: {
          actorId: req.auth.userId,
          action: "plan.updated",
          resourceId: id,
          details: { ...data, previousRevision: revision },
        },
      });
      return tx.subscriptionPlan.findUniqueOrThrow({ where: { id } });
    });
  }
  @Patch("configuration") async configuration(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const { revision, ...data } = parse(
      configurationSchema.extend({ revision: z.number().int().min(0) }),
      body,
    );
    return this.database.db.$transaction(async (tx) => {
      // Serialize first creation and subsequent compare-and-swap updates.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724091)`;
      const current = await tx.platformConfiguration.findUnique({
        where: { id: "global" },
      });
      if ((current?.revision ?? 0) !== revision)
        throw new ConflictException(
          "Configuration changed. Reload before saving.",
        );
      const saved = await tx.platformConfiguration.upsert({
        where: { id: "global" },
        create: { ...data },
        update: { ...data, revision: { increment: 1 } },
      });
      await tx.platformAuditLog.create({
        data: {
          actorId: req.auth.userId,
          action: "configuration.updated",
          resourceId: "global",
          details: { ...data, previousRevision: revision },
        },
      });
      return saved;
    });
  }
  @Get("audit-logs") async audits(@Query() query: unknown) {
    const input = parse(pageSchema, query),
      db = this.database.db;
    const where = {
      action: { contains: input.search, mode: "insensitive" as const },
    };
    const [items, total] = await db.$transaction([
      db.platformAuditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      db.platformAuditLog.count({ where }),
    ]);
    return { items, total, page: input.page, limit: input.limit };
  }
}
