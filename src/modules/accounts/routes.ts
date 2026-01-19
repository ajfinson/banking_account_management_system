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

export function registerAccountsRoutesWithSchemas(
  app: FastifyInstance,
  controller: AccountsController
) {
  const accountSchema = {
    type: "object",
    properties: {
      accountId: { type: "string" },
      personId: { type: "string" },
      balanceCents: { type: "integer" },
      dailyWithdrawalLimitCents: { type: "integer" },
      activeFlag: { type: "boolean" },
      accountType: { type: "string" },
      createDate: { type: "string" }
    },
    required: [
      "accountId",
      "personId",
      "balanceCents",
      "dailyWithdrawalLimitCents",
      "activeFlag",
      "accountType",
      "createDate"
    ]
  };

  const balanceSchema = {
    type: "object",
    properties: {
      balanceCents: { type: "integer" }
    },
    required: ["balanceCents"]
  };

  const txSchema = {
    type: "object",
    properties: {
      transactionId: { type: "string" },
      accountId: { type: "string" },
      valueCents: { type: "integer" },
      transactionDate: { type: "string" }
    },
    required: ["transactionId", "accountId", "valueCents", "transactionDate"]
  };

  app.post(
    "/accounts",
    {
      schema: {
        tags: ["accounts"],
        summary: "Create account",
        body: {
          type: "object",
          properties: {
            personId: { type: "string" },
            dailyWithdrawalLimitCents: { type: "integer", minimum: 0 },
            accountType: { type: "string" },
            initialBalanceCents: { type: "integer", minimum: 0 }
          },
          required: ["personId", "dailyWithdrawalLimitCents", "accountType"]
        },
        response: { 201: accountSchema }
      }
    },
    async (request, reply) => {
      const body = createAccountBodySchema.parse(request.body);
      const account = await controller.createAccount(body);
      return reply.status(201).send(account);
    }
  );

  app.post(
    "/accounts/:id/deposit",
    {
      schema: {
        tags: ["accounts"],
        summary: "Deposit funds",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        body: {
          type: "object",
          properties: { amountCents: { type: "integer" } },
          required: ["amountCents"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              balanceCents: { type: "integer" },
              transactionId: { type: "string" }
            },
            required: ["balanceCents", "transactionId"]
          }
        }
      }
    },
    async (request) => {
      const params = accountParamsSchema.parse(request.params);
      const body = amountBodySchema.parse(request.body);
      return controller.deposit(params.id, body.amountCents);
    }
  );

  app.post(
    "/accounts/:id/withdraw",
    {
      schema: {
        tags: ["accounts"],
        summary: "Withdraw funds",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        body: {
          type: "object",
          properties: { amountCents: { type: "integer" } },
          required: ["amountCents"]
        },
        response: {
          200: {
            type: "object",
            properties: {
              balanceCents: { type: "integer" },
              transactionId: { type: "string" }
            },
            required: ["balanceCents", "transactionId"]
          }
        }
      }
    },
    async (request) => {
      const params = accountParamsSchema.parse(request.params);
      const body = amountBodySchema.parse(request.body);
      return controller.withdraw(params.id, body.amountCents);
    }
  );

  app.get(
    "/accounts/:id/balance",
    {
      schema: {
        tags: ["accounts"],
        summary: "Get balance",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        response: { 200: balanceSchema }
      }
    },
    async (request) => {
      const params = accountParamsSchema.parse(request.params);
      return controller.getBalance(params.id);
    }
  );

  app.post(
    "/accounts/:id/block",
    {
      schema: {
        tags: ["accounts"],
        summary: "Block account",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        response: { 200: accountSchema }
      }
    },
    async (request) => {
      const params = accountParamsSchema.parse(request.params);
      return controller.blockAccount(params.id);
    }
  );

  app.post(
    "/accounts/:id/unblock",
    {
      schema: {
        tags: ["accounts"],
        summary: "Unblock account",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        response: { 200: accountSchema }
      }
    },
    async (request) => {
      const params = accountParamsSchema.parse(request.params);
      return controller.unblockAccount(params.id);
    }
  );

  app.get(
    "/accounts/:id/statement",
    {
      schema: {
        tags: ["accounts"],
        summary: "Get statement",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        querystring: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" }
          }
        },
        response: {
          200: {
            type: "object",
            properties: {
              openingBalance: { type: "integer" },
              closingBalance: { type: "integer" },
              totalIn: { type: "integer" },
              totalOut: { type: "integer" },
              transactions: {
                type: "array",
                items: txSchema
              }
            },
            required: [
              "openingBalance",
              "closingBalance",
              "totalIn",
              "totalOut",
              "transactions"
            ]
          }
        }
      }
    },
    async (request) => {
      const params = accountParamsSchema.parse(request.params);
      const query = statementQuerySchema.parse(request.query);
      return controller.statement(
        params.id,
        query.from,
        query.to,
        query.limit,
        query.offset
      );
    }
  );
}
