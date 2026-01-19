
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { SwaggerOptions } from "@fastify/swagger";
import type { FastifySwaggerUiOptions } from "@fastify/swagger-ui";
import { ZodError } from "zod";
import { AppError } from "./common/errors";
import { ContainerOptions, createContainer } from "./di";
import { registerAccountsRoutesWithSchemas } from "./modules/accounts/routes";
import { openapiDocument } from "./common/openapi";
import { config } from "./config";
import { getPool } from "./infra/postgres/pool";

export function buildApp(options: ContainerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const container = createContainer(options);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS
  });

  const swaggerOptions: SwaggerOptions = {
    mode: "static",
    specification: {
      document: openapiDocument
    }
  };

  const swaggerUiOptions: FastifySwaggerUiOptions = {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      url: "/docs/json"
    }
  };

  app.register(swagger, swaggerOptions);
  app.register(swaggerUi, swaggerUiOptions);


  app.get("/health", async () => ({ status: "ok" }));

  app.get("/health/db", async () => {
    if (config.REPO_PROVIDER !== "postgres") {
      return { status: "skipped" };
    }
    try {
      const pool = getPool();
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return { status: "down" };
    }
  });

  registerAccountsRoutesWithSchemas(app, container.accountsController);

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.status)
        .send({ error: error.code, message: error.message });
    }

    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message
      }));

      const amountIssue = error.issues.find(
        (issue) => issue.path.includes("amountCents") && issue.code === "too_small"
      );

      if (amountIssue) {
        return reply.status(400).send({
          error: "INVALID_AMOUNT",
          message: "Amount must be greater than zero",
          details: issues
        });
      }

      return reply.status(400).send({
        error: "INVALID_REQUEST",
        message: "Validation failed",
        details: issues
      });
    }

    const err = error instanceof Error ? error : new Error("Unknown error");
    request.log.error({ err }, "Unhandled error");
    return reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error"
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: "NOT_FOUND",
      message: `Route ${request.method} ${request.url} not found`
    });
  });

  return app;
}
