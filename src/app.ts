import Fastify from "fastify";
import { ZodError } from "zod";
import { AppError } from "./common/errors";
import { ContainerOptions, createContainer } from "./di";
import { registerAccountsRoutes } from "./modules/accounts/routes";

export function buildApp(options: ContainerOptions = {}) {
  const app = Fastify({ logger: false });
  const container = createContainer(options);

  registerAccountsRoutes(app, container.accountsController);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.status)
        .send({ error: error.code, message: error.message });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "INVALID_REQUEST",
        message: error.message
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error"
    });
  });

  return app;
}
