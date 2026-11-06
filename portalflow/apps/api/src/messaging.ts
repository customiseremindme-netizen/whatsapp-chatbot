import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { z } from "zod";
import { Prisma } from "@portalflow/database";
import {
  contactSchema,
  incomingSchema,
  replySchema,
  mediaSchema,
  messageSchema,
  pageSchema,
} from "@portalflow/shared";
import {
  withinServiceWindow,
  assertCapacity,
  assertActive,
} from "@portalflow/core";
import { Database } from "./database";
import { AuthRequest } from "./auth";
import { parse } from "./controllers";
import { InboxGateway } from "./inbox.gateway";
const uuid = z.string().uuid();
function canWrite(req: AuthRequest) {
  if (req.auth.role === "VIEWER")
    throw new ForbiddenException("Read-only role");
}
@ApiTags("Contacts")
@ApiCookieAuth()
@Controller("contacts")
export class ContactsController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get() async list(@Req() req: AuthRequest, @Query() query: unknown) {
    const { page, limit, search } = parse(pageSchema, query);
    const where: Prisma.ContactWhereInput = {
      tenantId: req.auth.tenantId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.db.$transaction([
      this.database.db.contact.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.database.db.contact.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  @Post() async create(@Req() req: AuthRequest, @Body() body: unknown) {
    canWrite(req);
    const data = parse(contactSchema, body);
    try {
      return await this.database.db.$transaction(async (tx) => {
        await assertCapacity(tx, req.auth.tenantId, "contacts");
        return tx.contact.create({
          data: { ...data, tenantId: req.auth.tenantId },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new ConflictException(
          "This phone already exists, including archived contacts",
        );
      throw e;
    }
  }
  @Get(":id") async get(@Req() req: AuthRequest, @Param("id") id: string) {
    const contact = await this.database.db.contact.findFirst({
      where: {
        id: parse(uuid, id),
        tenantId: req.auth.tenantId,
        deletedAt: null,
      },
    });
    if (!contact) throw new NotFoundException();
    return contact;
  }
  @Patch(":id") async update(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    canWrite(req);
    const data = parse(
      contactSchema
        .omit({ phone: true })
        .partial()
        .extend({ email: z.string().email().nullable().optional() }),
      body,
    );
    const contact = await this.get(req, id);
    return this.database.db.contact.update({
      where: {
        tenantId_phone: { tenantId: req.auth.tenantId, phone: contact.phone },
      },
      data,
    });
  }
  @Delete(":id") async remove(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    canWrite(req);
    await this.get(req, id);
    await this.database.db.contact.updateMany({
      where: { id, tenantId: req.auth.tenantId },
      data: { deletedAt: new Date(), optedOutAt: new Date(), optedInAt: null },
    });
    return { ok: true };
  }
  @Post(":id/consent") async consent(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    canWrite(req);
    await this.get(req, id);
    const data = parse(
      z
        .object({
          optedIn: z.boolean(),
          source: z.string().trim().min(3).max(300),
        })
        .strict(),
      body,
    );
    await this.database.db.$transaction(async (tx) => {
      await tx.contact.updateMany({
        where: { id, tenantId: req.auth.tenantId },
        data: data.optedIn
          ? {
              optedInAt: new Date(),
              optInSource: data.source,
              optedOutAt: null,
            }
          : { optedInAt: null, optedOutAt: new Date() },
      });
      await tx.contactConsent.create({
        data: {
          tenantId: req.auth.tenantId,
          contactId: id,
          optedIn: data.optedIn,
          source: data.source,
          recordedBy: req.auth.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.auth.tenantId,
          actorId: req.auth.userId,
          action: data.optedIn ? "contact.opted_in" : "contact.opted_out",
          resourceId: id,
        },
      });
    });
    return { ok: true };
  }
}
@ApiTags("Inbox")
@ApiCookieAuth()
@Controller("conversations")
export class ConversationsController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(InboxGateway) private readonly gateway: InboxGateway,
  ) {}
  private async find(req: AuthRequest, id: string) {
    const conversation = await this.database.db.conversation.findFirst({
      where: {
        id: parse(uuid, id),
        tenantId: req.auth.tenantId,
        contact: { deletedAt: null },
      },
      include: { contact: true },
    });
    if (!conversation) throw new NotFoundException();
    return conversation;
  }
  @Get() async list(@Req() req: AuthRequest, @Query() query: unknown) {
    const input = parse(
      pageSchema.extend({
        status: z.enum(["OPEN", "CLOSED"]).optional(),
        assignedUserId: uuid.optional(),
      }),
      query,
    );
    const where: Prisma.ConversationWhereInput = {
      tenantId: req.auth.tenantId,
      contact: {
        deletedAt: null,
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" } },
                { phone: { contains: input.search } },
              ],
            }
          : {}),
      },
      ...(input.status ? { status: input.status } : {}),
      ...(input.assignedUserId ? { assignedUserId: input.assignedUserId } : {}),
    };
    const [items, total] = await this.database.db.$transaction([
      this.database.db.conversation.findMany({
        where,
        include: {
          contact: true,
          messages: { orderBy: { sequence: "desc" }, take: 1 },
        },
        orderBy: { lastActivityAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.database.db.conversation.count({ where }),
    ]);
    return { items, total, page: input.page, limit: input.limit };
  }
  @Get(":id") get(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.find(req, id);
  }
  @Get(":id/messages") async messages(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    await this.find(req, id);
    const { page, limit, search } = parse(pageSchema, query);
    const where = {
      tenantId: req.auth.tenantId,
      conversationId: id,
      ...(search
        ? { text: { contains: search, mode: "insensitive" as const } }
        : {}),
    };
    const [items, total] = await this.database.db.$transaction([
      this.database.db.message.findMany({
        where,
        orderBy: { sequence: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.database.db.message.count({ where }),
    ]);
    return { items: items.reverse(), total, page, limit };
  }
  @Post(":id/messages") async send(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    canWrite(req);
    const conversation = await this.find(req, id),
      input = parse(messageSchema, body);
    if (conversation.contact.optedOutAt)
      throw new ForbiddenException("Contact has opted out");
    if (!withinServiceWindow(conversation.lastInboundAt))
      throw new ForbiddenException(
        "24-hour service window closed. Approved templates are required and not available in this release.",
      );
    const message = await this.database.db.$transaction(async (tx) => {
      await assertActive(tx, req.auth.tenantId);
      await tx.conversation.updateMany({
        where: { id, tenantId: req.auth.tenantId },
        data: {
          humanTakeover: true,
          lastActivityAt: new Date(),
          unread: false,
        },
      });
      await tx.botExecution.updateMany({
        where: {
          conversationId: id,
          tenantId: req.auth.tenantId,
          status: { in: ["RUNNING", "WAITING", "SLEEPING"] },
        },
        data: { status: "PAUSED" },
      });
      const result = await tx.message.upsert({
        where: {
          tenantId_idempotencyKey: {
            tenantId: req.auth.tenantId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        create: {
          ...input,
          tenantId: req.auth.tenantId,
          conversationId: id,
          status: "QUEUED",
          direction: "OUTBOUND",
        },
        update: {},
      });
      if (
        result.conversationId !== id ||
        result.text !== input.text ||
        JSON.stringify(
          result.media ? mediaSchema.parse(result.media) : null,
        ) !== JSON.stringify(input.media ?? null)
      )
        throw new ConflictException("Idempotency key already used");
      return result;
    });
    await this.gateway.publish(req.auth.tenantId, id);
    return message;
  }
  @Patch(":id") async update(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    canWrite(req);
    await this.find(req, id);
    const data = parse(
      z
        .object({
          status: z.enum(["OPEN", "CLOSED"]).optional(),
          unread: z.boolean().optional(),
        })
        .strict(),
      body,
    );
    await this.database.db.conversation.updateMany({
      where: { id, tenantId: req.auth.tenantId },
      data,
    });
    await this.gateway.publish(req.auth.tenantId, id);
    return { ok: true };
  }
  @Post(":id/assign") async assign(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    canWrite(req);
    await this.find(req, id);
    const { userId } = parse(
      z.object({ userId: uuid.nullable() }).strict(),
      body,
    );
    if (
      userId &&
      !(await this.database.db.tenantMembership.findFirst({
        where: { tenantId: req.auth.tenantId, userId, role: { not: "VIEWER" } },
      }))
    )
      throw new ForbiddenException(
        "Assignee must be an active workspace agent",
      );
    await this.database.db.conversation.updateMany({
      where: { id, tenantId: req.auth.tenantId },
      data: { assignedUserId: userId },
    });
    await this.gateway.publish(req.auth.tenantId, id);
    return { ok: true };
  }
  @Post(":id/takeover") async takeover(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    canWrite(req);
    await this.find(req, id);
    await this.database.db.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { id, tenantId: req.auth.tenantId },
        data: { humanTakeover: true },
      });
      await tx.botExecution.updateMany({
        where: {
          conversationId: id,
          tenantId: req.auth.tenantId,
          status: { in: ["RUNNING", "WAITING", "SLEEPING"] },
        },
        data: { status: "PAUSED" },
      });
    });
    await this.gateway.publish(req.auth.tenantId, id);
    return { ok: true };
  }
  @Post(":id/release") async release(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    canWrite(req);
    await this.find(req, id);
    await this.database.db.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { id, tenantId: req.auth.tenantId },
        data: { humanTakeover: false },
      });
      await tx.botExecution.updateMany({
        where: {
          conversationId: id,
          tenantId: req.auth.tenantId,
          status: "PAUSED",
          waitingKey: { not: null },
        },
        data: { status: "WAITING" },
      });
      await tx.botExecution.updateMany({
        where: {
          conversationId: id,
          tenantId: req.auth.tenantId,
          status: "PAUSED",
          waitingKey: null,
          wakeAt: null,
        },
        data: { status: "RUNNING" },
      });
      await tx.botExecution.updateMany({
        where: {
          conversationId: id,
          tenantId: req.auth.tenantId,
          status: "PAUSED",
          wakeAt: { not: null },
        },
        data: { status: "SLEEPING" },
      });
    });
    await this.gateway.publish(req.auth.tenantId, id);
    return { ok: true };
  }
  @Get(":id/notes") async notes(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    await this.find(req, id);
    return this.database.db.internalNote.findMany({
      where: { conversationId: id, tenantId: req.auth.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
  @Post(":id/notes") async note(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    canWrite(req);
    await this.find(req, id);
    const { text } = parse(
      z.object({ text: z.string().trim().min(1).max(4000) }).strict(),
      body,
    );
    const note = await this.database.db.internalNote.create({
      data: {
        tenantId: req.auth.tenantId,
        conversationId: id,
        authorId: req.auth.userId,
        text,
      },
    });
    await this.gateway.publish(req.auth.tenantId, id);
    return note;
  }
}
@ApiTags("Mock WhatsApp")
@ApiCookieAuth()
@Controller("whatsapp/mock")
export class MockWhatsAppController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Post("inbound") async inbound(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    canWrite(req);
    const data = parse(incomingSchema, body);
    await this.database.db.inboundEvent.createMany({
      data: [{ ...data, tenantId: req.auth.tenantId }],
      skipDuplicates: true,
    });
    const event = await this.database.db.inboundEvent.findUniqueOrThrow({
      where: {
        tenantId_externalId: {
          tenantId: req.auth.tenantId,
          externalId: data.externalId,
        },
      },
    });
    if (
      event.phone !== data.phone ||
      event.text !== data.text ||
      JSON.stringify(event.reply ? replySchema.parse(event.reply) : null) !==
        JSON.stringify(data.reply ?? null) ||
      JSON.stringify(event.media ? mediaSchema.parse(event.media) : null) !==
        JSON.stringify(data.media ?? null)
    )
      throw new ConflictException("Event ID already used");
    return { id: event.id, status: event.status, provider: "mock" };
  }
}
