// User-facing copy. Raw API error codes never reach visible text; every code in
// the C-02 error matrix maps to a plain-language message here.
import { ApiError, NetworkError } from "./api/client.js";
import type { ErrorCode } from "./api/types.js";

export const ERROR_COPY: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Some details need attention. Check the highlighted fields and try again.",
  EVENT_START_TIME_INVALID: "Choose a date and time in the future.",
  AUTHENTICATION_REQUIRED: "Your session has ended. Sign in again to continue.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find that event. It may have been removed or is no longer available.",
  CANCEL_TOKEN_CONSUMED: "This cancellation link is invalid or has already been used.",
  CAPACITY_CONFLICT:
    "Capacity can't be lower than the number of confirmed places. Increase the capacity and try again.",
  INTERNAL_ERROR: "Something went wrong on our side. Try again in a moment.",
};

export const COPY = {
  siteName: "Community Event Board",
  footer: "Community Event Board · Public events and RSVPs for local residents",
  networkError: "We couldn't reach the service. Check your connection and try again.",
  configError: "The event board is unavailable right now. Try again later.",
  retry: "Retry",
  loadingEvents: "Loading events",
  eventsLoadError: "We couldn't load events. Your filters are unchanged. Try again.",
  noEventsMatch: "No events match these filters",
  eventUnavailable: "This event is not available",
  eventUnavailableBody:
    "The event may have been removed, archived, or the link may be incorrect. Browse the current events instead.",
  backToEvents: "Back to all events",
  copyLinkDone: "Event link copied.",
  copyLinkManual: "Copy this link manually: select the text and copy it.",
  joinEvent: "Join event",
  joining: "Sending your RSVP",
  rsvpConfirmed: "Confirmed",
  rsvpWaitlisted: "Waitlisted",
  rsvpConfirmedBody: "You have a place at this event.",
  rsvpWaitlistedBody: "This event is full. You've been added to the waitlist.",
  rsvpDuplicateBody:
    "You already have an RSVP for this event with this email address. The cancellation link you received the first time still applies.",
  cancellationLinkIntro:
    "Keep this one-time link if you might need to cancel. It is shown only once.",
  invalidEmail: "Enter a valid email address.",
  requiredDisplayName: "Enter your display name.",
  cancelInvalid: "This cancellation link is invalid or has already been used.",
  cancelConfirmedDone:
    "Your place has been released. If anyone was on the waitlist, the first person has been moved up.",
  cancelWaitlistedDone: "You've left the waitlist. Confirmed attendance did not change.",
  signInIncorrect: "Email or password is incorrect.",
  signInService: "We couldn't complete sign-in right now. Try again.",
  signingIn: "Signing in",
  bannerRule: "Choose a JPEG, PNG, or WebP image no larger than 5 MB.",
  bannerNetworkError: "The upload failed. Your event details are saved. Try again.",
  bannerUploading: "Uploading banner",
  bannerUploaded: "Banner uploaded.",
  statsUnavailable: "Statistics are unavailable right now.",
  statsEmpty: "No activity recorded yet",
  statsLoading: "Loading statistics",
  permissionDenied: "You don't have permission to do that.",
  notFoundTitle: "Page not found",
} as const;

/** Maps an error code (known or not) to user copy, never echoing the code. */
export function messageForCode(code: string): string {
  return (ERROR_COPY as Record<string, string>)[code] ?? ERROR_COPY.INTERNAL_ERROR;
}

/** User copy for any failure thrown by the API client. */
export function messageForError(error: unknown): string {
  if (error instanceof NetworkError) {
    return COPY.networkError;
  }
  if (error instanceof ApiError) {
    return messageForCode(error.code);
  }
  return ERROR_COPY.INTERNAL_ERROR;
}
