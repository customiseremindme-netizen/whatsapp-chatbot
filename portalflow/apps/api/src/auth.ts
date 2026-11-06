import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { Role } from "@portalflow/shared";
import { Database } from "./database";
import { hashToken, requireActive, verifyCsrf } from "./security";
export const Public = () => SetMetadata("public", true);
export interface AuthContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  role: Role;
  verified: boolean;
  platformAdmin: boolean;
}
export type AuthRequest = Request & { auth: AuthContext };
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>("public", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      return true;
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token: unknown = req.cookies?.pf_access;
    if (typeof token !== "string") throw new UnauthorizedException();
    const session = await this.database.db.session.findUnique({
      where: { accessHash: hashToken(token) },
      include: { user: true, tenant: true },
    });
    if (!session) throw new UnauthorizedException();
    requireActive(session.expiresAt, session.revokedAt);
    requireActive(session.accessExpiresAt, null);
    if (session.tenant.suspendedAt)
      throw new ForbiddenException("Workspace suspended");
    const member = await this.database.db.tenantMembership.findUnique({
      where: {
        tenantId_userId: { tenantId: session.tenantId, userId: session.userId },
      },
    });
    if (!member) throw new ForbiddenException("Workspace membership required");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      verifyCsrf(req.headers["x-csrf-token"], session.csrfHash);
    req.auth = {
      userId: session.userId,
      tenantId: session.tenantId,
      sessionId: session.id,
      role: member.role,
      verified: !!session.user.emailVerifiedAt,
      platformAdmin: session.user.platformAdmin,
    };
    return true;
  }
}
