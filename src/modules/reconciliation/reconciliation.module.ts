import { Module } from '@nestjs/common';

/**
 * ReconciliationModule
 *
 * Matches internal transactions against provider-reported transactions
 * over time windows, identifying discrepancies.
 *
 * Critical concepts (semana 5):
 * - MATCHING ALGORITHM (by externalId + amount + date window)
 * - DISCREPANCY TYPES:
 *   - missing_internal (provider reports we don't have)
 *   - missing_external (we have it, provider doesn't report)
 *   - amount_mismatch (both exist, amounts differ)
 * - BATCH PROCESSING (async for large windows)
 * - REPORTING (discrepancies summary by period/provider)
 *
 * To implement:
 * - ReconciliationBatch entity
 * - Discrepancy entity
 * - ReconciliationEngine (matching logic)
 * - BatchProcessor (BullMQ consumer for async batches)
 * - ReportingService
 */
@Module({})
export class ReconciliationModule {}
