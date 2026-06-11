import {
  Controller,
  Post,
  Body,
  Param,
  Res,
  HttpStatus,
  HttpCode,
  Get,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhookService } from './webhooks.service';
import { Response } from 'express';

@ApiTags('webhooks')
@Controller('webhooks')
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

  @Get('/reconciliation-status')
  @HttpCode(HttpStatus.OK)
  async getReconciliationStatus() {
    return this.webhookService.findUnprocessedEvents();
  }
}
