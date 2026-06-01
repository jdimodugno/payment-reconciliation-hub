import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// Token de inyección. Mismo patrón que usaste en el health module:
// la instancia de Drizzle no es una clase que Nest pueda resolver por tipo,
// así que la registramos bajo un Symbol y la inyectamos con @Inject(DRIZZLE).
export const DRIZZLE = Symbol('DRIZZLE');

// Tipo del cliente. Hoy sin schema (Record<string, never>); el lunes, cuando
// definamos las tablas, este genérico va a llevar el schema y te va a tipar
// las queries (db.select().from(transactions) con autocompletado real).
export type DrizzleDB = NodePgDatabase<Record<string, never>>;

@Global() // global: cualquier módulo puede inyectar DRIZZLE sin re-importar.
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DrizzleDB => {
        // Pool de conexiones de pg (reutiliza conexiones en vez de abrir una
        // por query). getOrThrow: si falta DATABASE_URL, falla al boot —
        // fail loud, no arrancar con una config rota (principio T5 / A4).
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });
        return drizzle(pool);
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
