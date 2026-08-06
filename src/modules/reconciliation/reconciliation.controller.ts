import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationRunResult } from './reconciliation.types';

@ApiTags('reconciliation')
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  /**
   * Dispara una corrida. Puerta manual (ADR-017 D2): el scheduler futuro entra
   * como una segunda puerta al mismo `run()`, no como un rediseño.
   *
   * `POST` y no `GET` porque una corrida ESCRIBE: deja observaciones. El recurso
   * es la corrida, no el estado — de ahí `/runs`.
   *
   * 201 y no 200: cada llamada crea una corrida nueva, identificada por su
   * `runId`. No es idempotente y no debería leerse como si lo fuera.
   */
  @Post('/runs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Run a reconciliation batch and record what it observed',
  })
  async run(): Promise<ReconciliationRunResult> {
    return this.reconciliationService.run();
  }
}
