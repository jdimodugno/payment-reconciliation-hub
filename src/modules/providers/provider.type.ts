import { LogSerializer } from '@/shared/logging/log-serializer.interface';

export type Provider = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  createdAt: string;
};

export const ProviderSerializer: LogSerializer<Provider> = {
  name: 'Provider',
  allowlist: ['id', 'name', 'type', 'enabled'],
};
