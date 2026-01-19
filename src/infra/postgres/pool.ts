import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for Postgres repository");
    }
    pool = new Pool({ connectionString });
  }

  return pool;
}
