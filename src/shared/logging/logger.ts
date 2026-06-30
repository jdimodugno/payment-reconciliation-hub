import { PinoLogger } from 'nestjs-pino';
import { LogSerializer } from './log-serializer.interface';
import { Injectable } from '@nestjs/common';

@Injectable()
export class StructuredLogger {
  constructor(private readonly pino: PinoLogger) {}

  private getLoggableFields<T extends Record<string, unknown>>(
    entity: T,
    serializer: LogSerializer<T>,
  ): Record<string, unknown> {
    const dict: Record<string, unknown> = {
      entityName: serializer.name,
    };
    const entityAllowList = serializer.allowlist;
    if (entityAllowList.length === 0) return dict;
    return entityAllowList.reduce((acc, curr: string) => {
      const val = entity[curr];
      acc[curr] = val;
      return acc;
    }, dict);
  }

  info<T extends Record<string, unknown>>(
    entity: T,
    serializer: LogSerializer<T>,
    msg: string,
  ): void {
    this.pino.info({ ...this.getLoggableFields(entity, serializer) }, msg);
  }

  error<T extends Record<string, unknown>>(
    entity: T,
    serializer: LogSerializer<T>,
    msg: string,
    err?: unknown,
  ): void {
    if (err) {
      this.pino.error(
        { ...this.getLoggableFields(entity, serializer), err },
        msg,
      );
    } else {
      this.pino.error({ ...this.getLoggableFields(entity, serializer) }, msg);
    }
  }

  warn<T extends Record<string, unknown>>(
    entity: T,
    serializer: LogSerializer<T>,
    msg: string,
    err?: unknown,
  ): void {
    if (err) {
      this.pino.warn(
        { ...this.getLoggableFields(entity, serializer), err },
        msg,
      );
    } else {
      this.pino.warn({ ...this.getLoggableFields(entity, serializer) }, msg);
    }
  }
}
