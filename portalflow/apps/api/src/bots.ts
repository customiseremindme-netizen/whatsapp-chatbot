import { assertCapacity } from "@portalflow/core";
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  Query,
  Inject,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { z } from "zod";
import {
  flowSchema,
  validateFlow,
  quotationFlow,
  incomingSchema,
  replySchema,
  mediaSchema,
  pageSchema,
} from "@portalflow/shared";
import type { Prisma } from "@portalflow/database";
import { Database } from "./database";
import { AuthRequest } from "./auth";
import { parse } from "./controllers";
const uuid = z.string().uuid();
@ApiTags("Chatbots")
@ApiCookieAuth()
@Controller("bots")
export class BotsController {
  constructor(@Inject(Database) private readonly database: Database) {}
  private write(req: AuthRequest) {
    if (!["OWNER", "ADMIN", "MANAGER"].includes(req.auth.role))
      throw new ForbiddenException(
        "Manager or workspace administrator required",
      );
  }
  /** Assign Agent nodes must name a current non-viewer member of this workspace. */
  private async memberErrors(
    db: Pick<Prisma.TransactionClient, "tenantMembership">,
    tenantId: string,
    draft: unknown,
  ) {
    const parsed = flowSchema.safeParse(draft);
    if (!parsed.success) return [];
    const nodes = parsed.data.nodes.filter(
      (n) => n.type === "assign_agent" && uuid.safeParse(n.data.value).success,
    );
    if (!nodes.length) return [];
    const members = new Set(
      (
        await db.tenantMembership.findMany({
          where: {
            tenantId,
            role: { not: "VIEWER" },
            userId: { in: nodes.map((n) => n.data.value) },
          },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    return nodes
      .filter((n) => !members.has(n.data.value))
      .map((n) => `${n.id}: the assigned teammate is not an active agent here`);
  }
  private async find(req: AuthRequest, id: string) {
    const flow = await this.database.db.botFlow.findFirst({
      where: {
        id: parse(uuid, id),
        tenantId: req.auth.tenantId,
        deletedAt: null,
      },
    });
    if (!flow) throw new NotFoundException();
    return flow;
  }
  @Get() async list(@Req() req: AuthRequest) {
    return this.database.db.botFlow.findMany({
      where: { tenantId: req.auth.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        revision: true,
        publishedVersion: true,
        priority: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  }
  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown) {
    this.write(req);
    const { name } = parse(
      z.object({ name: z.string().trim().min(2).max(100) }).strict(),
      body,
    );
    return this.database.db.$transaction(async (tx) => {
      await assertCapacity(tx, req.auth.tenantId, "bots");
      return tx.botFlow.create({
        data: { tenantId: req.auth.tenantId, name, draft: quotationFlow },
      });
    });
  }
  @Get(":id") get(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.find(req, id);
  }
  @Patch(":id") async save(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.write(req);
    await this.find(req, id);
    const data = parse(
      z
        .object({
          name: z.string().trim().min(2).max(100),
          revision: z.number().int().positive(),
          draft: flowSchema,
          priority: z.number().int().min(0).max(10000).default(100),
        })
        .strict(),
      body,
    );
    const changed = await this.database.db.botFlow.updateMany({
      where: { id, tenantId: req.auth.tenantId, revision: data.revision },
      data: {
        name: data.name,
        draft: data.draft,
        priority: data.priority,
        revision: { increment: 1 },
      },
    });
    if (!changed.count)
      throw new ConflictException(
        "Draft changed elsewhere. Reload before saving.",
      );
    return this.find(req, id);
  }
  @Post(":id/validate") async validate(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    const flow = await this.find(req, id);
    const errors = [
      ...validateFlow(flow.draft),
      ...(await this.memberErrors(
        this.database.db,
        req.auth.tenantId,
        flow.draft,
      )),
    ];
    return { valid: errors.length === 0, errors };
  }
  @Post(":id/publish") async publish(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.write(req);
    await this.find(req, id);
    const { revision } = parse(
      z.object({ revision: z.number().int().positive() }).strict(),
      body,
    );
    return this.database.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BotFlow" WHERE id=${id}::uuid AND "tenantId"=${req.auth.tenantId}::uuid FOR UPDATE`;
      const flow = await tx.botFlow.findFirstOrThrow({
        where: { id, tenantId: req.auth.tenantId, deletedAt: null },
      });
      if (flow.revision !== revision)
        throw new ConflictException("Save the latest draft before publishing");
      const errors = [
        ...validateFlow(flow.draft),
        ...(await this.memberErrors(tx, req.auth.tenantId, flow.draft)),
      ];
      if (errors.length) throw new BadRequestException({ message: errors });
      const latest = await tx.botFlowVersion.findFirst({
        where: { flowId: id, tenantId: req.auth.tenantId },
        orderBy: { number: "desc" },
      });
      const number = (latest?.number ?? 0) + 1;
      await tx.botFlowVersion.create({
        data: {
          tenantId: req.auth.tenantId,
          flowId: id,
          number,
          data: flow.draft!,
        },
      });
      await tx.botFlow.update({
        where: { id },
        data: { publishedVersion: number },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.auth.tenantId,
          actorId: req.auth.userId,
          action: "bot.published",
          resourceId: id,
        },
      });
      return { version: number };
    });
  }
  @Post(":id/unpublish") async unpublish(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    this.write(req);
    await this.find(req, id);
    await this.database.db.botFlow.updateMany({
      where: { id, tenantId: req.auth.tenantId },
      data: { publishedVersion: null },
    });
    return { ok: true };
  }
  @Delete(":id") async remove(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    this.write(req);
    await this.find(req, id);
    await this.database.db.botFlow.updateMany({
      where: { id, tenantId: req.auth.tenantId },
      data: { deletedAt: new Date(), publishedVersion: null },
    });
    return { ok: true };
  }
  @Get(":id/versions") async versions(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    await this.find(req, id);
    return this.database.db.botFlowVersion.findMany({
      where: { flowId: id, tenantId: req.auth.tenantId },
      orderBy: { number: "desc" },
      take: 50,
    });
  }
  @Get(":id/executions") async executions(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    await this.find(req, id);
    return this.database.db.botExecution.findMany({
      where: { tenantId: req.auth.tenantId, flowVersion: { flowId: id } },
      include: {
        contact: { select: { name: true, phone: true } },
        conversation: { select: { humanTakeover: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }
  @Post(":id/simulate") async simulate(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.write(req);
    const flow = await this.find(req, id);
    if (!flow.publishedVersion)
      throw new BadRequestException("Publish a validated flow before testing");
    const input = parse(incomingSchema, body);
    const active = await this.database.db.botExecution.findFirst({
      where: {
        tenantId: req.auth.tenantId,
        contact: { phone: input.phone },
        status: { in: ["WAITING", "RUNNING", "SLEEPING", "PAUSED"] },
      },
      include: { flowVersion: true },
    });
    if (active && active.flowVersion.flowId !== id)
      throw new ConflictException(
        "This test sender has another active flow. Reset the simulator.",
      );
    await this.database.db.inboundEvent.createMany({
      data: [{ ...input, simulationFlowId: id, tenantId: req.auth.tenantId }],
      skipDuplicates: true,
    });
    const event = await this.database.db.inboundEvent.findUniqueOrThrow({
      where: {
        tenantId_externalId: {
          tenantId: req.auth.tenantId,
          externalId: input.externalId,
        },
      },
    });
    if (
      event.phone !== input.phone ||
      event.text !== input.text ||
      JSON.stringify(event.reply ? replySchema.parse(event.reply) : null) !==
        JSON.stringify(input.reply ?? null) ||
      JSON.stringify(event.media ? mediaSchema.parse(event.media) : null) !==
        JSON.stringify(input.media ?? null) ||
      event.simulationFlowId !== id
    )
      throw new ConflictException("Event ID already used");
    return {
      queued: true,
      provider: "mock",
      publishedVersion: flow.publishedVersion,
    };
  }
}
@ApiTags("Leads")
@ApiCookieAuth()
@Controller("leads")
export class LeadsController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get() async list(@Req() req: AuthRequest, @Query() query: unknown) {
    const { page, limit } = parse(pageSchema, query);
    const where = { tenantId: req.auth.tenantId, contact: { deletedAt: null } };
    const [items, total] = await this.database.db.$transaction([
      this.database.db.lead.findMany({
        where,
        include: { contact: { select: { name: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.database.db.lead.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  @Patch(":id") async update(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    if (req.auth.role === "VIEWER") throw new ForbiddenException();
    const { status } = parse(
      z
        .object({
          status: z.enum([
            "NEW",
            "CONTACTED",
            "QUALIFIED",
            "QUOTATION_SENT",
            "FOLLOW_UP",
            "WON",
            "LOST",
          ]),
        })
        .strict(),
      body,
    );
    const result = await this.database.db.lead.updateMany({
      where: { id: parse(uuid, id), tenantId: req.auth.tenantId },
      data: { status },
    });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }
}
