import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Money } from '@/shared/money/money';
import { TransactionsService } from '../transactions/transactions.service';
import { Transaction } from '../transactions/transaction.types';
import { WebhookService } from '../webhooks/webhooks.service';
import { ProviderSideEvent } from '../webhooks/webhook.types';
import { DiscrepancyRepository } from './reconciliation.repository';
import {
  InternalSide,
  ProviderSide,
  reconcile,
} from './reconciliation.matcher';
import { DiscrepancyKind } from './reconciliation.schema';
import { ReconciliationRunResult } from './reconciliation.types';

/**
 * Imperative shell de la reconciliación (ADR-017).
 *
 * El núcleo (`reconcile`) es puro y se prueba con arrays. Acá vive todo lo que él
 * no sabe hacer: cargar los dos universos, normalizarlos a formas comparables, y
 * persistir lo observado. El docstring del matcher describía este colaborador
 * desde el día 27; hasta hoy no existía, y por eso el motor era inalcanzable
 * fuera de los tests.
 *
 * Depende de los SERVICIOS de los otros dos módulos, no de sus repositorios
 * (ADR-017 D1): contrato, no esquema ajeno. Cuando M2 traiga la API real del
 * provider, lo único que cambia es de dónde sale el lado provider — el núcleo y
 * `webhooks/` no se enteran.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly webhookService: WebhookService,
    private readonly discrepancyRepository: DiscrepancyRepository,
  ) {}

  /**
   * Una corrida. NO sabe quién la invocó —hoy un POST, mañana un scheduler— y por
   * eso agregar el cron es una segunda puerta y no un rediseño (ADR-017 D2).
   *
   * `runId` se genera acá, no en el repo: la identidad de la corrida es del caso
   * de uso. Es lo que convierte cada fila en "lo que ESTA corrida observó"
   * (ADR-017 D4), en vez de un problema mutable que un re-run pisa en silencio.
   */
  async run(): Promise<ReconciliationRunResult> {
    const runId = randomUUID();

    const [transactions, providerSide] = await Promise.all([
      this.transactionsService.findAll(),
      this.webhookService.findProviderSideEvents(),
    ]);

    const internals: InternalSide[] = transactions.map(
      (transaction: Transaction) => ({
        internalId: transaction.id,
        providerId: transaction.providerId,
        providerRef: transaction.externalId,
        amount: transaction.amount,
        status: transaction.status,
      }),
    );

    const providers: ProviderSide[] = providerSide.events.map(
      (event: ProviderSideEvent) => ({
        providerId: event.providerId,
        providerRef: event.providerRef,
        // T1: Money.fromDecimal(string, currency), nunca number.
        amount: Money.fromDecimal(event.amount, event.currency),
        status: event.status,
        rawStatus: event.rawStatus,
      }),
    );

    const discrepancies = reconcile(internals, providers);

    await this.discrepancyRepository.saveAll(discrepancies, runId);

    const byKind = discrepancies.reduce<Record<string, number>>(
      (acc, discrepancy) => {
        acc[discrepancy.kind] = (acc[discrepancy.kind] ?? 0) + 1;
        return acc;
      },
      {},
    );

    return {
      runId,
      scanned: {
        internal: internals.length,
        provider: providers.length,
        // Eventos que el provider reportó y esta corrida NO pudo leer. No están
        // en `provider`, así que el matcher no los vio: cualquier par que
        // dependiera de ellos queda mal clasificado. Va en el resultado para que
        // una corrida "limpia" sobre datos ilegibles no se lea como sana.
        unreadable: providerSide.unreadable,
      },
      discrepancies: discrepancies.length,
      byKind: byKind as Record<DiscrepancyKind, number>,
    };
  }
}
