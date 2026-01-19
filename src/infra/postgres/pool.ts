import { Pool } from "pg";
import { config } from "../../config";

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: config.DATABASE_URL });
  }

  return pool;
}
