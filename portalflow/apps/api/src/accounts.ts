import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Inject,
} from "@nestjs/common";
import { hash, verify, argon2id } from "argon2";
import { Response } from "express";
import { Prisma, TokenPurpose } from "@portalflow/database";
import { Database } from "./database";
import { config } from "./config";
import { hashToken, opaqueToken, requireActive, verifyCsrf } from "./security";
const passwordOptions = {
  type: argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};
export const passwordHash = (password: string) =>
  hash(password, passwordOptions);
export const passwordMatches = (hashed: string, password: string) =>
  verify(hashed, password);
export const publicUser = {
  id: true,
  email: true,
  name: true,
  emailVerifiedAt: true,
  platformAdmin: true,
} as const;
@Injectable()
export class Accounts {
  private readonly dummy = passwordHash(opaqueToken());
  constructor(@Inject(Database) readonly database: Database) {}
  private cookies(
    res: Response,
    access: string,
    refresh: string,
    csrf: string,
  ) {
    const options = {
      httpOnly: true,
      secure: config.COOKIE_SECURE === "true",
      sameSite: "lax" as const,
      path: "/",
    };
    res.cookie("pf_access", access, { ...options, maxAge: 15 * 60 * 1000 });
    res.cookie("pf_refresh", refresh, {
      ...options,
      maxAge: 30 * 86400 * 1000,
      path: "/api/v1/auth",
    });
    res.cookie("pf_csrf", csrf, {
      ...options,
      httpOnly: false,
      maxAge: 30 * 86400 * 1000,
    });
  }
  clear(res: Response) {
    for (const name of ["pf_access", "pf_csrf", "pf_refresh"])
      res.clearCookie(name, {
        httpOnly: name !== "pf_csrf",
        sameSite: "lax",
        secure: config.COOKIE_SECURE === "true",
        path: name === "pf_refresh" ? "/api/v1/auth" : "/",
      });
  }
  private async issue(userId: string, tenantId: string, res: Response) {
    const access = opaqueToken(),
      refresh = opaqueToken(),
      csrf = opaqueToken();
    await this.database.db.session.create({
      data: {
        userId,
        tenantId,
        accessHash: hashToken(access),
        refreshHash: hashToken(refresh),
        csrfHash: hashToken(csrf),
        accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        expiresAt: new Date(Date.now() + 30 * 86400 * 1000),
      },
    });
    this.cookies(res, access, refresh, csrf);
  }
  async register(
    input: { name: string; email: string; password: string; workspace: string },
    res: Response,
  ) {
    const password = await passwordHash(input.password);
    try {
      const { user, tenant } = await this.database.db.$transaction(
        async (tx) => {
          const user = await tx.user.create({
            data: {
              name: input.name,
              email: input.email,
              passwordHash: password,
            },
          });
          const tenant = await tx.tenant.create({
            data: {
              name: input.workspace,
              memberships: { create: { userId: user.id, role: "OWNER" } },
            },
          });
          await tx.auditLog.create({
            data: {
              tenantId: tenant.id,
              actorId: user.id,
              action: "workspace.created",
            },
          });
          await this.addToken(tx, user.id, user.email, "VERIFY_EMAIL");
          return { user, tenant };
        },
      );
      await this.issue(user.id, tenant.id, res);
      return { id: user.id };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("Unable to register this email");
      throw error;
    }
  }
  async login(email: string, password: string, res: Response) {
    const user = await this.database.db.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { tenant: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const valid = await passwordMatches(
      user?.passwordHash ?? (await this.dummy),
      password,
    );
    if (!user || !valid)
      throw new UnauthorizedException("Invalid email or password");
    const member = user.memberships.find((m) => !m.tenant.suspendedAt);
    if (!member) throw new ForbiddenException("No active workspace");
    await this.issue(user.id, member.tenantId, res);
    return { ok: true };
  }
  async refresh(token: unknown, csrf: unknown, res: Response) {
    if (typeof token !== "string") throw new UnauthorizedException();
    const oldHash = hashToken(token);
    const session = await this.database.db.session.findUnique({
      where: { refreshHash: oldHash },
      include: { tenant: true },
    });
    if (!session) {
      // A previously rotated token indicates replay; invalidate the session family.
      await this.database.db.session.updateMany({
        where: { previousRefreshHash: oldHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.clear(res);
      throw new UnauthorizedException("Refresh token invalid");
    }
    requireActive(session.expiresAt, session.revokedAt);
    verifyCsrf(csrf, session.csrfHash);
    if (session.tenant.suspendedAt)
      throw new ForbiddenException("Workspace suspended");
    const membership = await this.database.db.tenantMembership.findUnique({
      where: {
        tenantId_userId: { tenantId: session.tenantId, userId: session.userId },
      },
    });
    if (!membership) throw new ForbiddenException();
    const access = opaqueToken(),
      refresh = opaqueToken(),
      nextCsrf = opaqueToken();
    const changed = await this.database.db.session.updateMany({
      where: { id: session.id, refreshHash: oldHash, revokedAt: null },
      data: {
        accessHash: hashToken(access),
        refreshHash: hashToken(refresh),
        previousRefreshHash: oldHash,
        csrfHash: hashToken(nextCsrf),
        accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    if (changed.count !== 1)
      throw new UnauthorizedException("Refresh already consumed");
    this.cookies(res, access, refresh, nextCsrf);
    return { ok: true };
  }
  async addToken(
    tx: Prisma.TransactionClient,
    userId: string,
    email: string,
    purpose: TokenPurpose,
  ) {
    const token = opaqueToken();
    await tx.accountToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.accountToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(
          Date.now() + (purpose === "RESET_PASSWORD" ? 3600000 : 86400000),
        ),
      },
    });
    const path =
      purpose === "RESET_PASSWORD" ? "reset-password" : "verify-email";
    await tx.emailOutbox.create({
      data: {
        recipient: email,
        subject:
          purpose === "RESET_PASSWORD"
            ? "Reset your PortalFlow password"
            : "Verify your PortalFlow email",
        text: `Open ${config.WEB_ORIGIN}/${path}#token=${token}. If you did not request this, ignore this email.`,
      },
    });
  }
  async requestToken(email: string, purpose: TokenPurpose) {
    const user = await this.database.db.user.findUnique({ where: { email } });
    if (user && !(purpose === "VERIFY_EMAIL" && user.emailVerifiedAt))
      await this.database.db.$transaction((tx) =>
        this.addToken(tx, user.id, email, purpose),
      );
    return {
      message: "If the account is eligible, an email will arrive shortly.",
    };
  }
  async consumeToken(token: string, purpose: TokenPurpose, password?: string) {
    const passwordValue = password ? await passwordHash(password) : undefined;
    await this.database.db.$transaction(async (tx) => {
      const record = await tx.accountToken.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (
        !record ||
        record.purpose !== purpose ||
        record.usedAt ||
        record.expiresAt <= new Date()
      )
        throw new BadRequestException("Token is invalid or expired");
      const consumed = await tx.accountToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new BadRequestException("Token already used");
      await tx.user.update({
        where: { id: record.userId },
        data:
          purpose === "VERIFY_EMAIL"
            ? { emailVerifiedAt: new Date() }
            : { passwordHash: passwordValue },
      });
      if (purpose === "RESET_PASSWORD")
        await tx.session.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
    });
    return { ok: true };
  }
}
