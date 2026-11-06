import { Inject, OnModuleDestroy } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import Redis from "ioredis";
import { Database } from "./database";
import { config } from "./config";
import { hashToken } from "./security";
@WebSocketGateway({
  cors: { origin: config.WEB_ORIGIN, credentials: true },
  transports: ["websocket"],
})
export class InboxGateway implements OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly subscriber = new Redis(config.REDIS_URL);
  private readonly publisher = new Redis(config.REDIS_URL);
  private readonly clients = new Map<string, Socket>();
  constructor(@Inject(Database) private readonly database: Database) {
    for (const connection of [this.subscriber, this.publisher])
      connection.on("error", () =>
        console.error(JSON.stringify({ event: "inbox.redis_error" })),
      );
    void this.subscriber.subscribe("portalflow:inbox");
    this.subscriber.on("message", (_channel, payload) => {
      void this.broadcast(payload).catch(() =>
        console.error(JSON.stringify({ event: "inbox.broadcast_failed" })),
      );
    });
  }
  private async identity(socket: Socket) {
    const token = socket.handshake.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("pf_access="))
      ?.slice(10);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.database.db.session.findUnique({
      where: { accessHash: hashToken(token) },
      include: { tenant: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.accessExpiresAt <= new Date() ||
      session.expiresAt <= new Date() ||
      session.tenant.suspendedAt
    )
      return null;
    const membership = await this.database.db.tenantMembership.findUnique({
      where: {
        tenantId_userId: { tenantId: session.tenantId, userId: session.userId },
      },
    });
    return membership ? session : null;
  }
  async handleConnection(socket: Socket) {
    try {
      const count = (await this.publisher.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
        1,
        `ws-limit:${socket.handshake.address}:${Math.floor(Date.now() / 60000)}`,
      )) as number;
      if (count > 30) {
        socket.disconnect(true);
        return;
      }
      if (
        socket.handshake.headers.origin !== config.WEB_ORIGIN ||
        !(await this.identity(socket))
      ) {
        socket.disconnect(true);
        return;
      }
      this.clients.set(socket.id, socket);
      socket.on("disconnect", () => this.clients.delete(socket.id));
      socket.emit("ready");
    } catch {
      socket.disconnect(true);
    }
  }
  private async broadcast(payload: string) {
    const event: unknown = JSON.parse(payload);
    if (
      !event ||
      typeof event !== "object" ||
      !("tenantId" in event) ||
      typeof event.tenantId !== "string"
    )
      return;
    // Reauthorize every delivery, including membership removal, active workspace changes and expiry.
    for (const socket of this.clients.values()) {
      const session = await this.identity(socket);
      if (!session) {
        socket.disconnect(true);
        continue;
      }
      if (session.tenantId === event.tenantId) socket.emit("inbox.changed");
    }
  }
  async publish(tenantId: string, conversationId: string) {
    await this.publisher.publish(
      "portalflow:inbox",
      JSON.stringify({ tenantId, conversationId }),
    );
  }
  async onModuleDestroy() {
    this.subscriber.disconnect();
    this.publisher.disconnect();
    for (const socket of this.clients.values()) socket.disconnect(true);
  }
}
