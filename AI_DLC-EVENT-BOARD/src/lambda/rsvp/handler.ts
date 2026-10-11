import { randomUUID } from "node:crypto";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../../event-api/data/client.js";
import { requireEnv, type Environment } from "../../event-api/http/environment.js";
import { createJsonLogger, type Logger } from "../../event-api/http/logger.js";
import { parseJsonBody, pathParameter, type HttpRequest } from "../../event-api/http/request.js";
import { createRouter, json, type HttpResponse } from "../../event-api/http/response.js";
import { RsvpRepository } from "../../event-api/rsvp/rsvp-repository.js";
import { RsvpService } from "../../event-api/rsvp/rsvp-service.js";
import { issueCancelToken } from "../../event-api/rsvp/token.js";

// team32-ceb-rsvp: public RSVP and token cancellation routes.
export interface RsvpDependencies {
  rsvp: Pick<RsvpService, "submitRsvp" | "cancel">;
  logger: Logger;
}

export function createRsvpRouter(deps: RsvpDependencies) {
  return createRouter(
    {
      "POST /api/events/{id}/rsvps": async (request) => {
        const result = await deps.rsvp.submitRsvp(
          pathParameter(request, "id"),
          parseJsonBody(request),
        );
        return json(result.statusCode, result.body);
      },
      "POST /api/rsvps/cancel": async (request) =>
        json(200, await deps.rsvp.cancel(parseJsonBody(request))),
    },
    deps.logger,
  );
}

export function buildRsvpDependencies(
  env: Environment,
  client: DynamoDBDocumentClient = createDocumentClient(),
): RsvpDependencies {
  const tableName = requireEnv(env, "TABLE_NAME");
  const logger = createJsonLogger();
  return {
    rsvp: new RsvpService({
      repository: new RsvpRepository(client, tableName),
      clock: () => new Date(),
      newId: randomUUID,
      issueToken: () => issueCancelToken(),
      logger,
    }),
    logger,
  };
}

let route: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;

export async function handler(request: HttpRequest): Promise<HttpResponse> {
  // Built once per container; a missing setting throws and fails the invocation.
  route ??= createRsvpRouter(buildRsvpDependencies(process.env));
  return route(request);
}
