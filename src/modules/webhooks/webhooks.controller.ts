import {
  Controller,
  Post,
  Body,
  Param,
  Res,
  HttpStatus,
  HttpCode,
  Get,
  UseFilters,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhookService } from './webhooks.service';
import { Response } from 'express';
import { EntityNotFoundExceptionFilter } from '@/shared/filter/entity-not-found-exception.filter';
import { ConflictExceptionFilter } from '@/shared/filter/conflict-exception.filter';

@ApiTags('webhooks')
@Controller('webhooks')
@UseFilters(EntityNotFoundExceptionFilter, ConflictExceptionFilter)
export class WebhookController {
  constructor(private webhookService: WebhookService) {}

  @Post('/:providerId')
  async notify(
    @Param('providerId') providerId: string,
    @Body() requestBody: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const webhookEvent = await this.webhookService.createWebhookNotification(
      providerId,
      requestBody,
    );

    res.statusCode =
      webhookEvent.status === 'created' ? HttpStatus.CREATED : HttpStatus.OK;

    return webhookEvent;
  }

  @Get('/pipeline-status')
  @HttpCode(HttpStatus.OK)
  async getPipelineStatus() {
    return this.webhookService.getPipelineStatus();
  }

  // ADR-015: reinyección manual de un evento dead-lettered.
  // 404 si no existe (EventNotFoundError), 409 si no es reprocesable
  // (EventNotReprocessableError — no está en pending_manual_review).
  @Post('/:eventId/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  async reprocess(@Param('eventId') eventId: string) {
    await this.webhookService.reprocess(eventId);
    return { status: 'reprocessing', eventId };
  }
}
