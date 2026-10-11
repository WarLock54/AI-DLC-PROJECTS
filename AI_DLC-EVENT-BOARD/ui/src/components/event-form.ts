// EventForm (D13): create/edit form with inline client checks that mirror C3 D8.
// The API stays authoritative; its field errors are shown on the same inputs.
import type { EventWrite, ManagementEvent } from "../api/types.js";
import { el, focusElement, setFieldError } from "../dom.js";
import { toDateTimeLocalValue } from "../format.js";

export type EventField = keyof EventWrite;

export const EVENT_FIELDS: readonly EventField[] = [
  "title",
  "description",
  "startsAt",
  "location",
  "category",
  "capacity",
];

const LIMITS = { title: 200, description: 5000, location: 100, category: 100 } as const;
const LABELS: Record<EventField, string> = {
  title: "Title",
  description: "Description",
  startsAt: "Date and time",
  location: "Location",
  category: "Category",
  capacity: "Capacity",
};

type Control = HTMLInputElement | HTMLTextAreaElement;

export interface EventFormHandle {
  section: HTMLElement;
  bannerSlot: HTMLElement;
  open(event: ManagementEvent | null): void;
  close(): void;
  currentEvent(): ManagementEvent | null;
  validate(now: Date): EventWrite | null;
  setFieldError(field: EventField, message: string | null): void;
  setStatus(message: string, kind: "success" | "error"): void;
  setPending(pending: boolean): void;
}

export interface EventFormHandlers {
  onSubmit(): void;
  onCancel(): void;
}

function createControl(field: EventField): Control {
  const id = `event-${field}`;
  const testid = `event-form-${field.toLowerCase()}`;
  if (field === "description") {
    return el("textarea", { testid, attrs: { id, rows: "4", required: "" } });
  }
  const type = field === "startsAt" ? "datetime-local" : field === "capacity" ? "number" : "text";
  return el("input", {
    testid,
    attrs: {
      id,
      type,
      required: "",
      min: field === "capacity" ? "1" : undefined,
      step: field === "capacity" ? "1" : undefined,
    },
  });
}

export function createEventForm(handlers: EventFormHandlers): EventFormHandle {
  const controls = {} as Record<EventField, Control>;
  const errors = {} as Record<EventField, HTMLParagraphElement>;
  const fields = EVENT_FIELDS.map((field) => {
    controls[field] = createControl(field);
    errors[field] = el("p", {
      className: "field-error",
      testid: `event-form-${field.toLowerCase()}-error`,
      attrs: { id: `event-${field}-error` },
    });
    errors[field].hidden = true;
    return el("div", { className: "field" }, [
      el("label", { text: LABELS[field], attrs: { for: `event-${field}` } }),
      controls[field],
      errors[field],
    ]);
  });
  let current: ManagementEvent | null = null;
  const heading = el("h2", { text: "Create event", testid: "event-form-heading" });
  const status = el("p", { testid: "event-form-status", attrs: { role: "status" } });
  const save = el("button", {
    text: "Save event",
    testid: "event-form-save",
    attrs: { type: "submit" },
  });
  const cancel = el("button", {
    text: "Cancel",
    testid: "event-form-cancel",
    className: "secondary",
    attrs: { type: "button" },
    on: { click: () => handlers.onCancel() },
  });
  const bannerSlot = el("div", { testid: "event-form-banner-slot" });
  const form = el("form", { testid: "event-form", attrs: { novalidate: "" } }, [
    ...fields,
    el("div", { className: "actions" }, [save, cancel]),
    status,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.onSubmit();
  });
  const section = el("section", { testid: "event-form-section", className: "panel" }, [
    heading,
    form,
    bannerSlot,
  ]);
  section.hidden = true;

  const setError = (field: EventField, message: string | null): void =>
    setFieldError(controls[field], errors[field], message);

  return {
    section,
    bannerSlot,
    open: (event) => {
      current = event;
      heading.textContent = event ? `Edit ${event.title}` : "Create event";
      for (const field of EVENT_FIELDS) {
        setError(field, null);
        controls[field].value = event ? valueFor(event, field) : "";
      }
      status.textContent = "";
      section.hidden = false;
      focusElement(controls.title);
    },
    close: () => {
      section.hidden = true;
      current = null;
    },
    currentEvent: () => current,
    validate: (now) => {
      const messages = checkValues(controls, now, current === null);
      for (const field of EVENT_FIELDS) {
        setError(field, messages[field] ?? null);
      }
      const firstInvalid = EVENT_FIELDS.find((field) => messages[field]);
      if (firstInvalid) {
        focusElement(controls[firstInvalid]);
        return null;
      }
      return readValues(controls);
    },
    setFieldError: (field, message) => {
      setError(field, message);
      if (message) {
        focusElement(controls[field]);
      }
    },
    setStatus: (message, kind) => {
      status.textContent = message;
      status.className = kind === "error" ? "status-error" : "status-success";
    },
    setPending: (pending) => {
      save.disabled = pending;
      form.setAttribute("aria-busy", String(pending));
    },
  };
}

function valueFor(event: ManagementEvent, field: EventField): string {
  if (field === "startsAt") {
    return toDateTimeLocalValue(event.startsAt);
  }
  return String(event[field]);
}

function readValues(controls: Record<EventField, Control>): EventWrite {
  return {
    title: controls.title.value.trim(),
    description: controls.description.value.trim(),
    startsAt: new Date(controls.startsAt.value).toISOString(),
    location: controls.location.value.trim(),
    category: controls.category.value.trim(),
    capacity: Number(controls.capacity.value),
  };
}

function checkValues(
  controls: Record<EventField, Control>,
  now: Date,
  creating: boolean,
): Partial<Record<EventField, string>> {
  const messages: Partial<Record<EventField, string>> = {};
  for (const field of ["title", "description", "location", "category"] as const) {
    const value = controls[field].value.trim();
    if (value === "") {
      messages[field] = `Enter a ${LABELS[field].toLowerCase()}.`;
    } else if (value.length > LIMITS[field]) {
      messages[field] = `Use ${LIMITS[field]} characters or fewer.`;
    }
  }
  const startsAt = new Date(controls.startsAt.value);
  if (controls.startsAt.value === "" || !Number.isFinite(startsAt.getTime())) {
    messages.startsAt = "Choose a date and time.";
  } else if (creating && startsAt.getTime() <= now.getTime()) {
    messages.startsAt = "Choose a date and time in the future.";
  }
  const capacity = Number(controls.capacity.value);
  if (controls.capacity.value.trim() === "" || !Number.isSafeInteger(capacity) || capacity < 1) {
    messages.capacity = "Enter a whole number of places, 1 or more.";
  }
  return messages;
}
