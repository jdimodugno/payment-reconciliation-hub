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
  async save(discrepancy: Discrepancy, runId: string): Promise<void> {
    await this.db
      .insert(discrepanciesTable)
      .values(toRow(discrepancy, runId))
      .onConflictDoNothing();
  }

  /**
   * Persiste lo que UNA corrida observó. `runId` lo genera el shell, no el repo:
   * la identidad de la corrida es del caso de uso, y el repo solo la escribe.
   *
   * Sin transacción a propósito: cada observación es un hecho independiente
   * (ADR-013 decisión B — una discrepancia por dimensión, con acción correctiva
   * distinta). Si una falla, las ya escritas siguen siendo ciertas; envolverlas
   * en un all-or-nothing borraría hallazgos válidos por un problema ajeno.
   */
  async saveAll(discrepancies: Discrepancy[], runId: string): Promise<void> {
    for (const discrepancy of discrepancies) {
      await this.save(discrepancy, runId);
    }
  }
}
