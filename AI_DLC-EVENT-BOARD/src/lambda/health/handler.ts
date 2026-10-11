import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export interface HealthResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function createHealthResponse(isHealthy: () => boolean = () => true): HealthResponse {
  try {
    if (!isHealthy()) {
      return response(503, { status: "unavailable" });
    }
    return response(200, { status: "ok" });
  } catch {
    // Keep health failures deterministic and never log exception details that may contain secrets.
    return response(500, { status: "error", code: "HEALTH_CHECK_FAILED" });
  }
}

function response(statusCode: number, body: object): HealthResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

export async function handler(): Promise<APIGatewayProxyStructuredResultV2> {
  return createHealthResponse();
}
