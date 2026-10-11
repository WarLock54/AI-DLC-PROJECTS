import { ApiError, internalError, notFound } from "./errors.js";
import { errorName, type Logger } from "./logger.js";
import { requestId, type HttpRequest } from "./request.js";

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function json(statusCode: number, payload: unknown): HttpResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(payload) };
}

export function noContent(): HttpResponse {
  return { statusCode: 204, headers: { "cache-control": "no-store" }, body: "" };
}

/**
 * Maps a thrown error to the C-02 {code, message, field} body. Unexpected
 * errors become 500 INTERNAL_ERROR; only the error name, route, and request ID
 * are logged, never the message, stack, body, or claims.
 */
export function errorResponse(error: unknown, request: HttpRequest, logger: Logger): HttpResponse {
  if (error instanceof ApiError) {
    return json(error.statusCode, error.toBody());
  }
  logger.error({
    event: "UNHANDLED_ERROR",
    errorName: errorName(error),
    routeKey: request.routeKey,
    requestId: requestId(request),
  });
  const failure = internalError();
  return json(failure.statusCode, failure.toBody());
}

export type RouteHandler = (request: HttpRequest) => Promise<HttpResponse>;

/** Dispatches on the HTTP API v2 routeKey; unknown routes return 404. */
export function createRouter(
  routes: Record<string, RouteHandler>,
  logger: Logger,
): (request: HttpRequest) => Promise<HttpResponse> {
  return async (request) => {
    try {
      const route = Object.hasOwn(routes, request.routeKey) ? routes[request.routeKey] : undefined;
      if (!route) {
        throw notFound("Route not found.");
      }
      return await route(request);
    } catch (error) {
      return errorResponse(error, request, logger);
    }
  };
}
