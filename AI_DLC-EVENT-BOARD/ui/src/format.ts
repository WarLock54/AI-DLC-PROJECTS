// Date/time and capacity text. Status is conveyed as text, never by color alone.

export interface FormatOptions {
  locale?: string;
  timeZone?: string;
}

export function formatDateTime(iso: string, options: FormatOptions = {}): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "Date to be confirmed";
  }
  return new Intl.DateTimeFormat(options.locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: options.timeZone,
  }).format(date);
}

export function capacityText(capacity: number, confirmed: number): string {
  if (confirmed >= capacity) {
    return "Full — waitlist open";
  }
  return `${confirmed} of ${capacity} places taken`;
}

/** Converts an ISO timestamp to a local `datetime-local` input value. */
export function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
