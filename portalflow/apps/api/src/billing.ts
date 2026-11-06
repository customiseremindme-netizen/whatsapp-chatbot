import {
  Controller,
  Get,
  Post,
  Inject,
  Req,
  ForbiddenException,
} from "@nestjs/common";
import { ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { assertActive, subscriptionSummary } from "@portalflow/core";
import { Database } from "./database";
import { AuthRequest } from "./auth";
@ApiTags("Workspace access and usage")
@ApiCookieAuth()
@Controller("billing")
export class BillingController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get("subscription") get(@Req() req: AuthRequest) {
    return this.database.db.$transaction((tx) =>
      subscriptionSummary(tx, req.auth.tenantId),
    );
  }
  @Post("retry-blocked") async retry(@Req() req: AuthRequest) {
    if (!["OWNER", "ADMIN"].includes(req.auth.role))
      throw new ForbiddenException("Workspace administrator required");
    return this.database.db.$transaction(async (tx) => {
      await assertActive(tx, req.auth.tenantId);
      const rows = await tx.inboundEvent.findMany({
        where: { tenantId: req.auth.tenantId, status: "QUOTA_BLOCKED" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 25,
      });
      const result = await tx.inboundEvent.updateMany({
        where: {
          tenantId: req.auth.tenantId,
          id: { in: rows.map((r) => r.id) },
          status: "QUOTA_BLOCKED",
        },
        data: { status: "PENDING", error: null },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.auth.tenantId,
          actorId: req.auth.userId,
          action: "inbound.retry_quota_blocked",
        },
      });
      return { queued: result.count };
    });
  }
}
