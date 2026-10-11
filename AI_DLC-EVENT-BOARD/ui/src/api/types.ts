// C-02 HTTP API shapes consumed by the UI.

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "EVENT_START_TIME_INVALID"
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CANCEL_TOKEN_CONSUMED"
  | "CAPACITY_CONFLICT"
  | "INTERNAL_ERROR";

export const ERROR_CODES: readonly ErrorCode[] = [
  "VALIDATION_ERROR",
  "EVENT_START_TIME_INVALID",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CANCEL_TOKEN_CONSUMED",
  "CAPACITY_CONFLICT",
  "INTERNAL_ERROR",
];

export interface ErrorBody {
  code: string;
  message: string;
  field?: string | null;
}

export interface EventSummary {
  eventId: string;
  title: string;
  startsAt: string;
  location: string;
  category: string;
  capacity: number;
  confirmedRsvpCount: number;
  bannerReference?: string | null;
}

export interface EventDetail extends EventSummary {
  description: string;
}

export type LifecycleStatus = "active" | "archived" | "deleted" | "cancelled";

export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  "active",
  "archived",
  "deleted",
  "cancelled",
];

export interface ManagementEvent extends EventDetail {
  organizerSubject: string;
  lifecycleStatus: LifecycleStatus;
}

export interface EventWrite {
  title: string;
  description: string;
  startsAt: string;
  location: string;
  category: string;
  capacity: number;
}

export interface EventFilters {
  date?: string;
  category?: string;
  location?: string;
}

export type RsvpStatus = "confirmed" | "waitlisted";

export interface RsvpCreatedResponse {
  status: RsvpStatus;
  cancelToken: string;
}

export interface RsvpExistingResponse {
  status: RsvpStatus;
}

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
  bannerReference: string;
}

export interface AdminStats {
  totalRsvps: number;
  pageViews: number;
  detailViews: number;
  popularCategories: { category: string; count: number }[];
}
