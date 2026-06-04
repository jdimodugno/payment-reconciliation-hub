import {
  ArgumentMetadata,
  BadRequestException,
  PipeTransform,
} from '@nestjs/common';
import z from 'zod';

export class ZodValidationPipe<
  TSchema extends z.ZodType,
> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}
  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
    return result.data;
  }
}
