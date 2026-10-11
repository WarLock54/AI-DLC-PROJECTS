// C-02 shared error matrix. Every API-boundary failure is surfaced to the caller
// as {code, message, field}; INTERNAL_ERROR never carries internal detail.
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "EVENT_START_TIME_INVALID"
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CANCEL_TOKEN_CONSUMED"
  | "CAPACITY_CONFLICT"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  EVENT_START_TIME_INVALID: 400,
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CANCEL_TOKEN_CONSUMED: 409,
  CAPACITY_CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  field: string | null;
}

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly field: string | null;

  constructor(code: ErrorCode, message: string, field: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.field = field;
  }

  get statusCode(): number {
    return STATUS_BY_CODE[this.code];
  }

  toBody(): ErrorBody {
    return { code: this.code, message: this.message, field: this.field };
  }
}

export function validationError(field: string, message: string): ApiError {
  return new ApiError("VALIDATION_ERROR", message, field);
}

export function notFound(
  message = "The requested resource was not found.",
  field: string | null = null,
): ApiError {
  return new ApiError("NOT_FOUND", message, field);
}

export function forbidden(message = "You are not allowed to perform this operation."): ApiError {
  return new ApiError("FORBIDDEN", message);
}

export function authenticationRequired(
  message = "A valid authenticated session is required.",
): ApiError {
  return new ApiError("AUTHENTICATION_REQUIRED", message);
}

export function internalError(): ApiError {
  return new ApiError("INTERNAL_ERROR", "An unexpected error occurred.");
}
