import { FastifyInstance } from "fastify";
import { AccountsController } from "./controller";
import {
  accountParamsSchema,
  amountBodySchema,
  createAccountBodySchema,
  statementQuerySchema
} from "./schemas";

export function registerAccountsRoutes(
  app: FastifyInstance,
  controller: AccountsController
) {
  app.post("/accounts", async (request, reply) => {
    const body = createAccountBodySchema.parse(request.body);
    const account = await controller.createAccount(body);
    return reply.status(201).send(account);
  });

  app.post("/accounts/:id/deposit", async (request) => {
    const params = accountParamsSchema.parse(request.params);
    const body = amountBodySchema.parse(request.body);
    return controller.deposit(params.id, body.amountCents);
  });

  app.post("/accounts/:id/withdraw", async (request) => {
    const params = accountParamsSchema.parse(request.params);
    const body = amountBodySchema.parse(request.body);
    return controller.withdraw(params.id, body.amountCents);
  });

  app.get("/accounts/:id/balance", async (request) => {
    const params = accountParamsSchema.parse(request.params);
    return controller.getBalance(params.id);
  });

  app.post("/accounts/:id/block", async (request) => {
    const params = accountParamsSchema.parse(request.params);
    return controller.blockAccount(params.id);
  });

  app.get("/accounts/:id/statement", async (request) => {
    const params = accountParamsSchema.parse(request.params);
    const query = statementQuerySchema.parse(request.query);
    return controller.statement(params.id, query.from, query.to);
  });
}
