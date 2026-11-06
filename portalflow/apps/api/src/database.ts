import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createDatabase } from "@portalflow/database";
@Injectable()
export class Database implements OnModuleDestroy {
  readonly db = createDatabase();
  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}
