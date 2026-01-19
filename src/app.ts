
import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { SwaggerOptions } from "@fastify/swagger";
import type { FastifySwaggerUiOptions } from "@fastify/swagger-ui";
import { ZodError } from "zod";
import { AppError } from "./common/errors";
import { ContainerOptions, createContainer } from "./di";
import { registerAccountsRoutesWithSchemas } from "./modules/accounts/routes";
import { openapiDocument } from "./common/openapi";

export function buildApp(options: ContainerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const container = createContainer(options);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
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

  registerAccountsRoutesWithSchemas(app, container.accountsController);

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.status)
        .send({ error: error.code, message: error.message });
    }

    if (error instanceof ZodError) {
      const hasAmountIssue = error.issues.some((issue) =>
        issue.path.includes("amountCents")
      );
      if (hasAmountIssue) {
        return reply.status(400).send({
          error: "INVALID_AMOUNT",
          message: "Amount must be greater than zero"
        });
      }

      return reply.status(400).send({
        error: "INVALID_REQUEST",
        message: error.message
      });
    }

    const err = error instanceof Error ? error : new Error("Unknown error");
    request.log.error({ err }, "Unhandled error");
    return reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error"
    });
  });

  return app;
}
