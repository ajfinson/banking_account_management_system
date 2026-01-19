// @ts-nocheck
import Fastify from "fastify";
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");
import { ZodError } from "zod";
import { AppError } from "./common/errors";
import { ContainerOptions, createContainer } from "./di";
import { registerAccountsRoutesWithSchemas } from "./modules/accounts/routes";

export function buildApp(options: ContainerOptions = {}) {
  const app = Fastify({ logger: false });
  const container = createContainer(options);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  const openapiDocument = {
    openapi: "3.0.3",
    info: {
      title: "Banking Account Management API",
      description: "REST API for banking accounts",
      version: "1.0.0"
    },
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Health" }
                }
              }
            }
          }
        }
      },
      "/accounts": {
        post: {
          summary: "Create account",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateAccountBody" }
              }
            }
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Account" }
                }
              }
            }
          }
        }
      },
      "/accounts/{id}/deposit": {
        post: {
          summary: "Deposit funds",
          parameters: [{ $ref: "#/components/parameters/AccountId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AmountBody" }
              }
            }
          },
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BalanceWithTransaction" }
                }
              }
            }
          }
        }
      },
      "/accounts/{id}/withdraw": {
        post: {
          summary: "Withdraw funds",
          parameters: [{ $ref: "#/components/parameters/AccountId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AmountBody" }
              }
            }
          },
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BalanceWithTransaction" }
                }
              }
            }
          }
        }
      },
      "/accounts/{id}/balance": {
        get: {
          summary: "Get balance",
          parameters: [{ $ref: "#/components/parameters/AccountId" }],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Balance" }
                }
              }
            }
          }
        }
      },
      "/accounts/{id}/block": {
        post: {
          summary: "Block account",
          parameters: [{ $ref: "#/components/parameters/AccountId" }],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Account" }
                }
              }
            }
          }
        }
      },
      "/accounts/{id}/statement": {
        get: {
          summary: "Get statement",
          parameters: [
            { $ref: "#/components/parameters/AccountId" },
            { $ref: "#/components/parameters/From" },
            { $ref: "#/components/parameters/To" }
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Transaction" }
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      parameters: {
        AccountId: {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" }
        },
        From: {
          name: "from",
          in: "query",
          required: false,
          schema: { type: "string" }
        },
        To: {
          name: "to",
          in: "query",
          required: false,
          schema: { type: "string" }
        }
      },
      schemas: {
        Health: {
          type: "object",
          properties: { status: { type: "string", enum: ["ok"] } },
          required: ["status"]
        },
        Account: {
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
        },
        Balance: {
          type: "object",
          properties: { balanceCents: { type: "integer" } },
          required: ["balanceCents"]
        },
        BalanceWithTransaction: {
          type: "object",
          properties: {
            balanceCents: { type: "integer" },
            transactionId: { type: "string" }
          },
          required: ["balanceCents", "transactionId"]
        },
        Transaction: {
          type: "object",
          properties: {
            transactionId: { type: "string" },
            accountId: { type: "string" },
            valueCents: { type: "integer" },
            transactionDate: { type: "string" }
          },
          required: ["transactionId", "accountId", "valueCents", "transactionDate"]
        },
        CreateAccountBody: {
          type: "object",
          properties: {
            personId: { type: "string" },
            dailyWithdrawalLimitCents: { type: "integer", minimum: 0 },
            accountType: { type: "string" },
            initialBalanceCents: { type: "integer", minimum: 0 }
          },
          required: ["personId", "dailyWithdrawalLimitCents", "accountType"]
        },
        AmountBody: {
          type: "object",
          properties: { amountCents: { type: "integer" } },
          required: ["amountCents"]
        }
      }
    }
  };

  // @ts-expect-error - plugin typing mismatch with current module resolution
  app.register(swagger as any, {
    mode: "static",
    specification: {
      document: openapiDocument
    }
  } as any);
  // @ts-expect-error - plugin typing mismatch with current module resolution
  app.register(swaggerUi as any, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list"
    },
    swaggerOptions: {
      url: "/docs/json"
    }
  } as any);


  app.get("/health", async () => ({ status: "ok" }));

  // @ts-expect-error - schema typing causes deep instantiation in TS
  registerAccountsRoutesWithSchemas(app, container.accountsController);

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
