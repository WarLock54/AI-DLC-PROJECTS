import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../../event-api/data/client.js";
import { requireEnv, type Environment } from "../../event-api/http/environment.js";
import { jwtClaims, type HttpRequest } from "../../event-api/http/request.js";
import { createRouter, json, type HttpResponse } from "../../event-api/http/response.js";
import { createOperationsLogger, type OperationsLogger } from "../../operations/shared/logger.js";
import { StatisticsRepository } from "../../operations/statistics/statistics-repository.js";
import { StatisticsService } from "../../operations/statistics/statistics-service.js";

// team32-ceb-admin-stats: GET /api/admin/stats behind the C1 JWT authorizer.
export interface AdminStatsDependencies {
  statistics: Pick<StatisticsService, "get">;
  logger: OperationsLogger;
}

export function createAdminStatsRouter(deps: AdminStatsDependencies) {
  return createRouter(
    {
      "GET /api/admin/stats": async (request) =>
        json(200, await deps.statistics.get(jwtClaims(request))),
    },
    deps.logger,
  );
}

export function buildAdminStatsDependencies(
  env: Environment,
  client: DynamoDBDocumentClient = createDocumentClient(),
): AdminStatsDependencies {
  const tableName = requireEnv(env, "TABLE_NAME");
  return {
    statistics: new StatisticsService({
      repository: new StatisticsRepository(client, tableName),
    }),
    logger: createOperationsLogger(),
  };
}

let route: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;

export async function handler(request: HttpRequest): Promise<HttpResponse> {
  // Built once per container; a missing setting throws and fails the invocation.
  route ??= createAdminStatsRouter(buildAdminStatsDependencies(process.env));
  return route(request);
}
