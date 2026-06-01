import { defineConfig } from 'drizzle-kit';

// Config de drizzle-kit (la CLI de migraciones).
// - schema: dónde viven las definiciones de tablas. Las vamos a colocar
//   junto a cada módulo (ej: src/modules/transactions/transaction.schema.ts),
//   por eso el glob. Hoy todavía no hay ninguna — se definen el lunes.
// - out: carpeta donde drizzle-kit escribe los archivos SQL de migración.
// - dialect: postgres (decidido en ADR-003).
// - dbCredentials.url: se lee de la env. drizzle-kit corre fuera de NestJS,
//   así que no tiene ConfigService: lee process.env directo.
export default defineConfig({
  schema: './src/modules/**/*.schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
