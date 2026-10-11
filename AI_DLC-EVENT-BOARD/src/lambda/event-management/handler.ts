import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { BannerService, type BannerPresigner } from "../../event-api/banner/banner-service.js";
import { createDocumentClient } from "../../event-api/data/client.js";
import { EventRepository } from "../../event-api/events/event-repository.js";
import { EventService } from "../../event-api/events/event-service.js";
import { requireEnv, type Environment } from "../../event-api/http/environment.js";
import { createJsonLogger, type Logger } from "../../event-api/http/logger.js";
import {
  jwtClaims,
  parseJsonBody,
  pathParameter,
  queryParameters,
  type HttpRequest,
} from "../../event-api/http/request.js";
import { createRouter, json, noContent, type HttpResponse } from "../../event-api/http/response.js";

// team32-ceb-events-manage: organizer/admin routes behind the C1 JWT authorizer.
export interface EventManagementDependencies {
  events: Pick<
    EventService,
    "create" | "update" | "remove" | "listOrganizerEvents" | "listAdminEvents"
  >;
  banner: Pick<BannerService, "createUpload">;
  logger: Logger;
}

export function createEventManagementRouter(deps: EventManagementDependencies) {
  const { events, banner } = deps;
  return createRouter(
    {
      "POST /api/events": async (request) =>
        json(201, await events.create(jwtClaims(request), parseJsonBody(request))),
      "PUT /api/events/{id}": async (request) =>
        json(
          200,
          await events.update(
            jwtClaims(request),
            pathParameter(request, "id"),
            parseJsonBody(request),
          ),
        ),
      "DELETE /api/events/{id}": async (request) => {
        await events.remove(jwtClaims(request), pathParameter(request, "id"));
        return noContent();
      },
      "POST /api/events/{id}/banner-upload": async (request) =>
        json(
          200,
          await banner.createUpload(
            jwtClaims(request),
            pathParameter(request, "id"),
            parseJsonBody(request),
          ),
        ),
      "GET /api/organizer/events": async (request) =>
        json(200, await events.listOrganizerEvents(jwtClaims(request))),
      "GET /api/admin/events": async (request) =>
        json(200, await events.listAdminEvents(jwtClaims(request), queryParameters(request))),
    },
    deps.logger,
  );
}

export function buildEventManagementDependencies(
  env: Environment,
  client: DynamoDBDocumentClient = createDocumentClient(),
  presign?: BannerPresigner,
): EventManagementDependencies {
  const tableName = requireEnv(env, "TABLE_NAME");
  const bucketName = requireEnv(env, "BANNER_BUCKET_NAME");
  const repository = new EventRepository(client, tableName);
  const clock = () => new Date();
  return {
    events: new EventService({ repository, clock, newId: randomUUID }),
    banner: new BannerService({
      events: repository,
      presign: presign ?? createS3Presigner(),
      bucketName,
      clock,
      newId: randomUUID,
    }),
    logger: createJsonLogger(),
  };
}

/** Signs with the function's runtime role; Region comes from AWS_REGION. */
function createS3Presigner(): BannerPresigner {
  const s3 = new S3Client({});
  return (request) => createPresignedPost(s3, request);
}

let route: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;

export async function handler(request: HttpRequest): Promise<HttpResponse> {
  // Built once per container; a missing setting throws and fails the invocation.
  route ??= createEventManagementRouter(buildEventManagementDependencies(process.env));
  return route(request);
}
