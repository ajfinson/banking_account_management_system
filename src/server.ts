import "dotenv/config";
import { buildApp } from "./app";
import { config } from "./config";
import { getPool } from "./infra/postgres/pool";

async function start() {
  const app = buildApp();
  
  // Health check database connection if using Postgres
  if (config.REPO_PROVIDER === "postgres") {
    try {
      const pool = getPool();
      await pool.query("SELECT 1");
      app.log.info("Database connection successful");
    } catch (error) {
      app.log.error({ err: error }, "Database connection failed");
      process.exit(1);
    }
  }
  const port = config.PORT;
  const host = config.HOST;

  if (config.REPO_PROVIDER === "memory") {
    app.log.warn("Running with in-memory storage (non-durable)");
  }

  app
    .listen({ port, host })
    .catch((error: unknown) => {
      app.log.error(error);
      process.exit(1);
    });
}

start();
