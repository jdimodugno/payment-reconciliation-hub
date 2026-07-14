import { Module } from '@nestjs/common';
import { DiscrepancyRepository } from './reconciliation.repository';

/**
 * ReconciliationModule
 *
 * Persiste y (a futuro) reporta discrepancias entre el lado interno y el
 * reportado por el provider. El modelo de dominio (union por-variante) vive en
 * reconciliation.types; el mapper row<->union en mapper/; la persistencia acá.
 *
 * Estado (día 26):
 * - [x] DiscrepancyRepository.save (idempotente vía UNIQUE + onConflictDoNothing)
 * - [ ] find (diferido — sin consumidor todavía; entra con reporting/dashboard)
 * - [ ] batch run que produce discrepancias reales (día 27)
 */
@Module({
  providers: [DiscrepancyRepository],
  exports: [DiscrepancyRepository],
})
export class ReconciliationModule {}
