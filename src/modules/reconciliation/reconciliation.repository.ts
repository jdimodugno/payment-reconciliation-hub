import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import { discrepanciesTable } from './reconciliation.schema';
import { toRow } from './mapper/discrepancy.mapper';
import { Discrepancy } from './reconciliation.types';

@Injectable()
export class DiscrepancyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /**
   * Persiste una discrepancia de forma idempotente.
   *
   * El árbitro de la duplicidad es el UNIQUE (internalId, providerRef, kind)
   * con nullsNotDistinct — NO un check-then-insert (que perdería la race).
   * Un re-run del batch sobre el mismo par + dimensión choca el constraint y
   * onConflictDoNothing lo trata como comportamiento esperado, no como error:
   * el conflicto NO es un error, es la convergencia idempotente. Cualquier OTRO
   * error de la DB sigue propagándose solo (T5: modelar, no silenciar en bloque).
   */
  async save(discrepancy: Discrepancy): Promise<void> {
    await this.db
      .insert(discrepanciesTable)
      .values(toRow(discrepancy))
      .onConflictDoNothing();
  }
}
