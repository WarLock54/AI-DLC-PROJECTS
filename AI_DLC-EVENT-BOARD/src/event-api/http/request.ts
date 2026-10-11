import { validationError } from "./errors.js";

/** The subset of the API Gateway HTTP API v2 payload these handlers read. */
export interface HttpRequest {
  routeKey: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    requestId?: string;
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
}

/** Bodies above this size are rejected before parsing (largest field is 5000 chars). */
export const MAX_BODY_BYTES = 64 * 1024;

export function parseJsonBody(request: HttpRequest): unknown {
  const raw = request.body;
  if (raw === undefined || raw === null || raw.length === 0) {
    throw validationError("body", "A JSON request body is required.");
  }
  const text = request.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw validationError("body", `The request body must be at most ${MAX_BODY_BYTES} bytes.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw validationError("body", "The request body must be valid JSON.");
  }
}

export function pathParameter(request: HttpRequest, name: string): string | undefined {
  return request.pathParameters?.[name] ?? undefined;
}

export function queryParameters(request: HttpRequest): Record<string, string | undefined> {
  return { ...(request.queryStringParameters ?? {}) };
}

/** Claims verified by the API Gateway JWT authorizer, if the route has one. */
export function jwtClaims(request: HttpRequest): Record<string, unknown> | undefined {
  return request.requestContext?.authorizer?.jwt?.claims;
}

export function requestId(request: HttpRequest): string {
  return request.requestContext?.requestId ?? "unknown";
}
