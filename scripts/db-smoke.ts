import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

// Smoke test: prueba que Drizzle puede abrir conexión al Postgres del
// docker-compose y ejecutar una query. No toca NestJS — es la prueba más
// chica posible de que el stack de datos (pg + drizzle + DB) está vivo.
// Se corre con `node --env-file=.env.development` para inyectar DATABASE_URL.
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const result = await db.execute(sql`select 1 as ok, current_database() as db`);
  // eslint-disable-next-line no-console
  console.log('✅ DB connection OK:', result.rows);

  await pool.end(); // cerramos el pool para que el proceso termine limpio.
}

main().catch((err) => {
  // Fail loud: si la conexión falla, salimos con código != 0 (principio A4/T5).
  // eslint-disable-next-line no-console
  console.error('❌ DB connection FAILED:', err);
  process.exit(1);
});
