import type { Claims } from "../../../src/event-api/access/policy.js";
import {
  BannerService,
  type BannerPresigner,
} from "../../../src/event-api/banner/banner-service.js";
import { DiscoveryService } from "../../../src/event-api/discovery/discovery-service.js";
import { ViewRecorder } from "../../../src/event-api/discovery/view-recorder.js";
import { ViewRepository } from "../../../src/event-api/discovery/view-repository.js";
import { EventRepository } from "../../../src/event-api/events/event-repository.js";
import { EventService } from "../../../src/event-api/events/event-service.js";
import type { LogFields, Logger } from "../../../src/event-api/http/logger.js";
import { RsvpRepository } from "../../../src/event-api/rsvp/rsvp-repository.js";
import { RsvpService } from "../../../src/event-api/rsvp/rsvp-service.js";
import { issueCancelToken, type IssuedToken } from "../../../src/event-api/rsvp/token.js";
import type { FakeDynamoDb } from "./fake-dynamodb.js";
import {
  ADMIN,
  NOW,
  ORGANIZER,
  OTHER_ORGANIZER,
  sequentialIds,
  steppingClock,
  TABLE_NAME,
} from "./fixtures.js";

export const organizerClaims: Claims = { sub: ORGANIZER, "cognito:groups": "[organizer]" };
export const otherOrganizerClaims: Claims = {
  sub: OTHER_ORGANIZER,
  "cognito:groups": ["organizer"],
};
export const adminClaims: Claims = { sub: ADMIN, "cognito:groups": "[admin]" };
export const residentClaims: Claims = { sub: "44444444-4444-4444-8444-444444444444" };

export interface RecordingLogger extends Logger {
  entries: (LogFields & { level: "error" | "warn" })[];
}

export function recordingLogger(): RecordingLogger {
  const entries: RecordingLogger["entries"] = [];
  return {
    entries,
    error: (fields) => entries.push({ level: "error", ...fields }),
    warn: (fields) => entries.push({ level: "warn", ...fields }),
  };
}

/** Deterministic, distinct tokens; every issued token is kept for assertions. */
export function recordingTokenIssuer(): { issue: () => IssuedToken; issued: IssuedToken[] } {
  const issued: IssuedToken[] = [];
  let counter = 0;
  return {
    issued,
    issue: () => {
      counter += 1;
      const token = issueCancelToken((size) => {
        const bytes = Buffer.alloc(size);
        bytes.writeUInt32BE(counter, 0);
        return bytes;
      });
      issued.push(token);
      return token;
    },
  };
}

export interface ServiceOptions {
  clock?: () => Date;
  presign?: BannerPresigner;
}

export function buildServices(fake: FakeDynamoDb, options: ServiceOptions = {}) {
  const client = fake.asClient();
  const clock = options.clock ?? steppingClock(NOW);
  const logger = recordingLogger();
  const tokens = recordingTokenIssuer();
  const eventRepository = new EventRepository(client, TABLE_NAME);
  const views = new ViewRecorder({
    repository: new ViewRepository(client, TABLE_NAME),
    clock,
    newId: sequentialIds("view"),
    logger,
  });
  const presignCalls: Parameters<BannerPresigner>[0][] = [];
  const presign: BannerPresigner =
    options.presign ??
    (async (request) => {
      presignCalls.push(request);
      return {
        url: "https://banner-bucket.s3.us-east-1.amazonaws.com/",
        fields: { ...request.Fields, key: request.Key, Policy: "signed-policy" },
      };
    });
  return {
    clock,
    logger,
    tokens,
    presignCalls,
    eventRepository,
    events: new EventService({ repository: eventRepository, clock, newId: sequentialIds("event") }),
    discovery: new DiscoveryService({ events: eventRepository, views, clock }),
    banner: new BannerService({
      events: eventRepository,
      presign,
      bucketName: "team32-ceb-banner-test",
      clock,
      newId: sequentialIds("banner"),
    }),
    rsvp: new RsvpService({
      repository: new RsvpRepository(client, TABLE_NAME),
      clock,
      newId: sequentialIds("reg"),
      issueToken: tokens.issue,
      logger,
      sleep: async () => {},
    }),
  };
}

export async function captureApiError(promise: Promise<unknown>): Promise<{
  code: string;
  statusCode: number;
  field: string | null;
  message: string;
}> {
  try {
    await promise;
  } catch (error) {
    const apiError = error as {
      code?: string;
      statusCode?: number;
      field?: string | null;
      message: string;
    };
    if (apiError.code && apiError.statusCode) {
      return {
        code: apiError.code,
        statusCode: apiError.statusCode,
        field: apiError.field ?? null,
        message: apiError.message,
      };
    }
    throw error;
  }
  throw new Error("Expected the promise to reject with an ApiError.");
}
