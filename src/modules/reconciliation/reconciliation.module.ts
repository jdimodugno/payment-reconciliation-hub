import { Module } from '@nestjs/common';
import { DiscrepancyRepository } from './reconciliation.repository';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

/**
 * ReconciliationModule
 *
 * Detecta, persiste y expone discrepancias entre el lado interno y el reportado
 * por el provider. El modelo de dominio (union por-variante) vive en
 * reconciliation.types; el núcleo puro del cruce en reconciliation.matcher; el
 * imperative shell que lo alimenta en reconciliation.service.
 *
 * Importa los otros dos módulos y depende de sus SERVICIOS, nunca de sus
 * repositorios (ADR-017 D1): este módulo es dueño del concepto "reconciliación",
 * y por eso es el que compone las fuentes. Acoplarse a `WebhookRepository` lo
 * ataría al esquema de persistencia ajeno (T3).
 *
 * Estado (día 31):
 * - [x] DiscrepancyRepository.save (idempotente por corrida vía UNIQUE)
 * - [x] imperative shell + POST /reconciliation/runs (ADR-017)
 * - [ ] find / lectura de discrepancias (entra con el reporting)
 * - [ ] scheduler (segunda puerta al mismo run(), ADR-017 D2)
 */
@Module({
  imports: [TransactionsModule, WebhooksModule],
  controllers: [ReconciliationController],
  providers: [DiscrepancyRepository, ReconciliationService],
  exports: [DiscrepancyRepository],
})
export class ReconciliationModule {}
