import "dotenv/config";
import { buildApp } from "./app";
import { config } from "./config";

const app = buildApp();
const port = config.PORT;
const host = config.HOST;

app
  .listen({ port, host })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
