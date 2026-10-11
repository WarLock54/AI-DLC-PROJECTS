import { randomUUID } from "node:crypto";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../../event-api/data/client.js";
import { DiscoveryService } from "../../event-api/discovery/discovery-service.js";
import { ViewRecorder } from "../../event-api/discovery/view-recorder.js";
import { ViewRepository } from "../../event-api/discovery/view-repository.js";
import { EventRepository } from "../../event-api/events/event-repository.js";
import { requireEnv, type Environment } from "../../event-api/http/environment.js";
import { createJsonLogger, type Logger } from "../../event-api/http/logger.js";
import { pathParameter, queryParameters, type HttpRequest } from "../../event-api/http/request.js";
import { createRouter, json, type HttpResponse } from "../../event-api/http/response.js";

// team32-ceb-events-public: GET /api/events and GET /api/events/{id}.
export interface EventPublicDependencies {
  discovery: Pick<DiscoveryService, "listEvents" | "getEvent">;
  logger: Logger;
}

export function createEventPublicRouter(deps: EventPublicDependencies) {
  return createRouter(
    {
      "GET /api/events": async (request) =>
        json(200, await deps.discovery.listEvents(queryParameters(request))),
      "GET /api/events/{id}": async (request) =>
        json(200, await deps.discovery.getEvent(pathParameter(request, "id"))),
    },
    deps.logger,
  );
}

export function buildEventPublicDependencies(
  env: Environment,
  client: DynamoDBDocumentClient = createDocumentClient(),
): EventPublicDependencies {
  const tableName = requireEnv(env, "TABLE_NAME");
  const logger = createJsonLogger();
  const clock = () => new Date();
  const views = new ViewRecorder({
    repository: new ViewRepository(client, tableName),
    clock,
    newId: randomUUID,
    logger,
  });
  return {
    discovery: new DiscoveryService({
      events: new EventRepository(client, tableName),
      views,
      clock,
    }),
    logger,
  };
}

let route: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;

export async function handler(request: HttpRequest): Promise<HttpResponse> {
  // Built once per container; a missing setting throws and fails the invocation.
  route ??= createEventPublicRouter(buildEventPublicDependencies(process.env));
  return route(request);
}
