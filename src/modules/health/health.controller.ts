import type {
  LivenessReport,
  ReadinessReport,
} from '@/modules/health/health.types';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthService } from './health.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private healthService: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  async getLivenessStatus(): Promise<LivenessReport> {
    const report = await this.healthService.checkLiveness();
    return report;
  }

  @Get('ready')
  async getReadinessStatus(): Promise<ReadinessReport> {
    const report = await this.healthService.checkReadiness();
    if (report.status === 'down') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
