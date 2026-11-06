import { assertCapacity, lockTenant } from "@portalflow/core";
import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Req,
  Res,
  Inject,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { z } from "zod";
import {
  canManage,
  canChangeMember,
  loginSchema,
  registerSchema,
  tenantSchema,
  inviteSchema,
  tokenSchema,
  resetSchema,
  emailSchema,
} from "@portalflow/shared";
import { Accounts, publicUser } from "./accounts";
import { Database } from "./database";
import { Public, AuthRequest } from "./auth";
import { opaqueToken, hashToken } from "./security";
import { config } from "./config";
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException({
      message: "Validation failed",
      issues: result.error.flatten(),
    });
  return result.data;
}
const idSchema = z.string().uuid();
@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(Accounts) private readonly accounts: Accounts,
    @Inject(Database) private readonly database: Database,
  ) {}
  @Public() @Post("register") register(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accounts.register(parse(registerSchema, body), res);
  }
  @Public() @Post("login") login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(loginSchema, body);
    return this.accounts.login(input.email, input.password, res);
  }
  @Public() @Post("refresh") refresh(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accounts.refresh(
      req.cookies?.pf_refresh,
      req.headers["x-csrf-token"],
      res,
    );
  }
  @Post("logout") async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.database.db.session.updateMany({
      where: { id: req.auth.sessionId, userId: req.auth.userId },
      data: { revokedAt: new Date() },
    });
    this.accounts.clear(res);
    return { ok: true };
  }
  @Public() @Post("forgot-password") forgot(@Body() body: unknown) {
    return this.accounts.requestToken(
      parse(z.object({ email: emailSchema }).strict(), body).email,
      "RESET_PASSWORD",
    );
  }
  @Public() @Post("reset-password") reset(@Body() body: unknown) {
    const input = parse(resetSchema, body);
    return this.accounts.consumeToken(
      input.token,
      "RESET_PASSWORD",
      input.password,
    );
  }
  @Public() @Post("verify-email") verify(@Body() body: unknown) {
    return this.accounts.consumeToken(
      parse(tokenSchema, body).token,
      "VERIFY_EMAIL",
    );
  }
  @Post("resend-verification") async resend(@Req() req: AuthRequest) {
    const user = await this.database.db.user.findUniqueOrThrow({
      where: { id: req.auth.userId },
    });
    return this.accounts.requestToken(user.email, "VERIFY_EMAIL");
  }
  @Get("me") async me(@Req() req: AuthRequest) {
    const [user, tenant] = await Promise.all([
      this.database.db.user.findUniqueOrThrow({
        where: { id: req.auth.userId },
        select: publicUser,
      }),
      this.database.db.tenant.findUniqueOrThrow({
        where: { id: req.auth.tenantId },
        select: {
          id: true,
          name: true,
          timezone: true,
          language: true,
          currency: true,
        },
      }),
    ]);
    return { user, tenant, role: req.auth.role, sessionId: req.auth.sessionId };
  }
  @Get("sessions") sessions(@Req() req: AuthRequest) {
    return this.database.db.session.findMany({
      where: {
        userId: req.auth.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        tenant: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
  @Delete("sessions/:id") async revoke(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    const result = await this.database.db.session.updateMany({
      where: { id: parse(idSchema, id), userId: req.auth.userId },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }
}
@ApiTags("Workspaces")
@ApiCookieAuth()
@Controller("tenants")
export class TenantController {
  constructor(@Inject(Database) private readonly database: Database) {}
  private manage(req: AuthRequest) {
    if (!canManage(req.auth.role))
      throw new ForbiddenException("Owner or administrator required");
  }
  @Get() async list(@Req() req: AuthRequest) {
    const memberships = await this.database.db.tenantMembership.findMany({
      where: { userId: req.auth.userId, tenant: { suspendedAt: null } },
      include: { tenant: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m) => ({
      id: m.tenantId,
      name: m.tenant.name,
      role: m.role,
    }));
  }
  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = parse(
      z.object({ name: z.string().trim().min(2).max(100) }).strict(),
      body,
    );
    return this.database.db.tenant.create({
      data: {
        name: input.name,
        memberships: { create: { userId: req.auth.userId, role: "OWNER" } },
        audits: {
          create: { actorId: req.auth.userId, action: "workspace.created" },
        },
      },
      select: { id: true, name: true },
    });
  }
  @Post("switch") async switch(@Req() req: AuthRequest, @Body() body: unknown) {
    const { tenantId } = parse(z.object({ tenantId: idSchema }).strict(), body);
    const member = await this.database.db.tenantMembership.findFirst({
      where: {
        tenantId,
        userId: req.auth.userId,
        tenant: { suspendedAt: null },
      },
    });
    if (!member) throw new ForbiddenException("Workspace unavailable");
    await this.database.db.session.update({
      where: { id: req.auth.sessionId },
      data: { tenantId },
    });
    return { ok: true };
  }
  @Get("current") current(@Req() req: AuthRequest) {
    return this.database.db.tenant.findUniqueOrThrow({
      where: { id: req.auth.tenantId },
    });
  }
  @Patch("current") async update(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    this.manage(req);
    const data = parse(tenantSchema, body);
    return this.database.db.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: req.auth.tenantId },
        data,
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: req.auth.userId,
          action: "workspace.updated",
        },
      });
      return tenant;
    });
  }
  @Get("members") members(@Req() req: AuthRequest) {
    return this.database.db.tenantMembership.findMany({
      where: { tenantId: req.auth.tenantId },
      select: {
        id: true,
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }
  @Get("audit-logs") logs(@Req() req: AuthRequest) {
    this.manage(req);
    return this.database.db.auditLog.findMany({
      where: { tenantId: req.auth.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
  @Post("invitations") async invite(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    this.manage(req);
    if (!req.auth.verified)
      throw new ForbiddenException("Verify your email before inviting members");
    const input = parse(inviteSchema, body);
    if (req.auth.role === "ADMIN" && input.role === "ADMIN")
      throw new ForbiddenException("Only owners can invite administrators");
    const token = opaqueToken();
    await this.database.db.$transaction(async (tx) => {
      await lockTenant(tx, req.auth.tenantId);
      await tx.invitation.updateMany({
        where: {
          tenantId: req.auth.tenantId,
          email: input.email,
          acceptedAt: null,
        },
        data: { expiresAt: new Date() },
      });
      await assertCapacity(tx, req.auth.tenantId, "members", true);
      await tx.invitation.create({
        data: {
          ...input,
          tenantId: req.auth.tenantId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      await tx.emailOutbox.create({
        data: {
          recipient: input.email,
          subject: "Your PortalFlow invitation",
          text: `Sign in or register with ${input.email}, then open ${config.WEB_ORIGIN}/accept-invitation#token=${token}`,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.auth.tenantId,
          actorId: req.auth.userId,
          action: "member.invited",
        },
      });
    });
    return { ok: true };
  }
  @Post("invitations/accept") async accept(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    if (!req.auth.verified)
      throw new ForbiddenException("Verify your email first");
    const { token } = parse(tokenSchema, body);
    await this.database.db.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { tenant: true },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: req.auth.userId },
      });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.expiresAt <= new Date() ||
        invitation.email !== user.email ||
        invitation.tenant.suspendedAt
      )
        throw new BadRequestException("Invitation is invalid or expired");
      await lockTenant(tx, invitation.tenantId);
      const member = await tx.tenantMembership.findUnique({
        where: {
          tenantId_userId: { tenantId: invitation.tenantId, userId: user.id },
        },
      });
      if (!member) await assertCapacity(tx, invitation.tenantId, "members");
      const used = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (!used.count) throw new BadRequestException("Invitation already used");
      await tx.tenantMembership.upsert({
        where: {
          tenantId_userId: { tenantId: invitation.tenantId, userId: user.id },
        },
        create: {
          tenantId: invitation.tenantId,
          userId: user.id,
          role: invitation.role,
        },
        update: {},
      });
      await tx.auditLog.create({
        data: {
          tenantId: invitation.tenantId,
          actorId: user.id,
          action: "member.joined",
        },
      });
    });
    return { ok: true };
  }
  @Patch("members/:id") async change(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { role } = parse(
      z
        .object({ role: z.enum(["ADMIN", "MANAGER", "AGENT", "VIEWER"]) })
        .strict(),
      body,
    );
    this.manage(req);
    return this.database.db.$transaction(async (tx) => {
      const member = await tx.tenantMembership.findFirst({
        where: { id: parse(idSchema, id), tenantId: req.auth.tenantId },
      });
      if (!member) throw new NotFoundException();
      if (
        !canChangeMember(req.auth.role, member.role) ||
        (role === "ADMIN" && req.auth.role !== "OWNER")
      )
        throw new ForbiddenException();
      await tx.tenantMembership.update({
        where: { id: member.id },
        data: { role },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.auth.tenantId,
          actorId: req.auth.userId,
          action: "member.role_changed",
          resourceId: member.id,
        },
      });
      return { ok: true };
    });
  }
  @Delete("members/:id") async remove(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    this.manage(req);
    return this.database.db.$transaction(async (tx) => {
      const member = await tx.tenantMembership.findFirst({
        where: { id: parse(idSchema, id), tenantId: req.auth.tenantId },
      });
      if (!member) throw new NotFoundException();
      if (!canChangeMember(req.auth.role, member.role))
        throw new ForbiddenException();
      await tx.conversation.updateMany({
        where: { tenantId: req.auth.tenantId, assignedUserId: member.userId },
        data: { assignedUserId: null },
      });
      await tx.tenantMembership.delete({ where: { id: member.id } });
      await tx.session.updateMany({
        where: { userId: member.userId, tenantId: req.auth.tenantId },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.auth.tenantId,
          actorId: req.auth.userId,
          action: "member.removed",
          resourceId: member.id,
        },
      });
      return { ok: true };
    });
  }
  @Get("overview") async overview(@Req() req: AuthRequest) {
    const tenantId = req.auth.tenantId;
    const [members, invitations, events] = await Promise.all([
      this.database.db.tenantMembership.count({ where: { tenantId } }),
      this.database.db.invitation.count({
        where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.database.db.auditLog.findMany({
        where: { tenantId },
        take: 8,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { members, pendingInvitations: invitations, events };
  }
}
