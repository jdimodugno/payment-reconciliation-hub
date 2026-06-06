import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Provider } from './provider.type';
import { providersTable } from './provider.schema';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class ProvidersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async existsAndIsEnabled(providerId: string): Promise<Provider> {
    const rows = await this.db
      .select()
      .from(providersTable)
      .where(
        and(
          eq(providersTable.id, providerId),
          eq(providersTable.enabled, true),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(
        `There is no enabled provided with id ${providerId}`,
      );
    }

    return {
      ...rows[0],
      createdAt: rows[0].createdAt.toISOString(),
    };
  }
}
