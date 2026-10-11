// D13: organizer (/organizer/events) and admin (/admin/events) management. The
// two modes share layout and form behavior but not data scope; the API enforces
// role and ownership on every request.
import { ApiError } from "../api/client.js";
import { LIFECYCLE_STATUSES, type LifecycleStatus, type ManagementEvent } from "../api/types.js";
import { createBannerUploader } from "../components/banner-uploader.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import {
  createEventForm,
  EVENT_FIELDS,
  type EventField,
  type EventFormHandle,
} from "../components/event-form.js";
import { COPY, ERROR_COPY, messageForError } from "../copy.js";
import { el, replaceChildren } from "../dom.js";
import { capacityText, formatDateTime } from "../format.js";
import type { PageContext } from "./context.js";

export type ManagementMode = "organizer" | "admin";

interface PageState {
  events: ManagementEvent[];
  status: LifecycleStatus;
}

export async function renderEventManagement(ctx: PageContext, mode: ManagementMode): Promise<void> {
  const title = mode === "admin" ? "Manage all events" : "Your events";
  ctx.setTitle(title);
  const state: PageState = { events: [], status: "active" };
  const listStatus = el("p", { testid: "manage-list-status", attrs: { role: "status" } });
  const listBody = el("div", { testid: "manage-list" });
  const form: EventFormHandle = createEventForm({
    onSubmit: () => void save(),
    onCancel: () => form.close(),
  });

  const load = async (): Promise<void> => {
    listStatus.textContent = "Loading events";
    replaceChildren(listBody, []);
    try {
      state.events =
        mode === "admin"
          ? await ctx.api.listAdminEvents(state.status)
          : await ctx.api.listOrganizerEvents();
      listStatus.textContent = `${state.events.length} ${state.events.length === 1 ? "event" : "events"}`;
      renderList();
    } catch (error) {
      showListError(error);
    }
  };

  const showListError = (error: unknown): void => {
    listStatus.textContent = "";
    if (error instanceof ApiError && error.status === 401) {
      return; // The API client already sent the user to sign-in.
    }
    if (error instanceof ApiError && error.status === 403) {
      replaceChildren(listBody, [
        el("p", {
          text: COPY.permissionDenied,
          testid: "manage-forbidden",
          attrs: { role: "alert" },
        }),
      ]);
      return;
    }
    replaceChildren(listBody, [
      el("p", { text: messageForError(error), testid: "manage-error", attrs: { role: "alert" } }),
      el("button", {
        text: COPY.retry,
        testid: "manage-retry",
        attrs: { type: "button" },
        on: { click: () => void load() },
      }),
    ]);
  };

  const renderList = (): void => {
    if (state.events.length === 0) {
      replaceChildren(listBody, [
        el("p", { text: "No events yet. Use Create event to add one.", testid: "manage-empty" }),
      ]);
      return;
    }
    replaceChildren(listBody, [
      managementTable(state.events, mode, actionsFor),
      el(
        "ul",
        { testid: "manage-cards", className: "manage-cards" },
        state.events.map((event) => el("li", {}, [managementCard(event, mode, actionsFor)])),
      ),
    ]);
  };

  const actionsFor = (event: ManagementEvent): HTMLElement => {
    const edit = el("button", {
      text: "Edit",
      testid: "manage-edit",
      className: "secondary",
      attrs: { type: "button", "aria-label": `Edit ${event.title}` },
      on: { click: () => openForm(event) },
    });
    const remove = el("button", {
      text: "Delete",
      testid: "manage-delete",
      className: "danger",
      attrs: { type: "button", "aria-label": `Delete ${event.title}` },
    });
    remove.addEventListener("click", () => void deleteEvent(event, remove));
    return el("div", { className: "actions" }, [edit, remove]);
  };

  const openForm = (event: ManagementEvent | null): void => {
    form.open(event);
    replaceChildren(form.bannerSlot, [
      createBannerUploader({
        eventId: event?.eventId ?? null,
        api: ctx.api,
        fetchImpl: ctx.fetchImpl,
        announce: ctx.announce,
      }),
    ]);
  };

  const save = async (): Promise<void> => {
    const write = form.validate(new Date());
    if (!write) {
      return;
    }
    const existing = form.currentEvent();
    form.setPending(true);
    try {
      const saved = existing
        ? await ctx.api.updateEvent(existing.eventId, write)
        : await ctx.api.createEvent(write);
      const merged: ManagementEvent = {
        organizerSubject: existing?.organizerSubject ?? ctx.session?.sub ?? "",
        lifecycleStatus: existing?.lifecycleStatus ?? "active",
        ...saved,
      };
      state.events = existing
        ? state.events.map((event) => (event.eventId === merged.eventId ? merged : event))
        : [...state.events, merged];
      renderList();
      // After a create, the form switches to editing the new event so a banner
      // can be added straight away.
      openForm(merged);
      const message = `${existing ? "Event updated" : "Event created"}: ${merged.title}`;
      form.setStatus(message, "success");
      ctx.announce(message);
    } catch (error) {
      showSaveError(form, error);
      ctx.announce(messageForError(error));
    } finally {
      form.setPending(false);
    }
  };

  const deleteEvent = async (event: ManagementEvent, trigger: HTMLElement): Promise<void> => {
    const confirmed = await confirmDialog({
      title: `Delete ${event.title}?`,
      body: `${event.title} will be removed from the public event list and can no longer take RSVPs.`,
      confirmLabel: "Delete event",
      testid: "delete-dialog",
      trigger,
    });
    if (!confirmed) {
      return;
    }
    try {
      await ctx.api.deleteEvent(event.eventId);
      state.events = state.events.filter((candidate) => candidate.eventId !== event.eventId);
      renderList();
      if (form.currentEvent()?.eventId === event.eventId) {
        form.close();
      }
      listStatus.textContent = `Event deleted: ${event.title}`;
      ctx.announce(`Event deleted: ${event.title}`);
    } catch (error) {
      const message = messageForError(error);
      listStatus.textContent = message;
      ctx.announce(message);
    }
  };

  const createButton = el("button", {
    text: "Create event",
    testid: "manage-create",
    attrs: { type: "button" },
    on: { click: () => openForm(null) },
  });
  replaceChildren(ctx.main, [
    el("h1", { text: title }),
    el("div", { className: "toolbar" }, [
      createButton,
      mode === "admin" ? statusFilter(state, load) : null,
    ]),
    form.section,
    el("section", { attrs: { "aria-label": "Event list" } }, [listStatus, listBody]),
  ]);
  await load();
}

function statusFilter(state: PageState, reload: () => Promise<void>): HTMLElement {
  const select = el(
    "select",
    { testid: "manage-status-filter", attrs: { id: "manage-status" } },
    LIFECYCLE_STATUSES.map((status) => el("option", { text: status, attrs: { value: status } })),
  );
  const apply = el("button", {
    text: "Show",
    testid: "manage-status-apply",
    className: "secondary",
    attrs: { type: "button" },
    on: {
      click: () => {
        state.status = select.value as LifecycleStatus;
        void reload();
      },
    },
  });
  return el("div", { className: "field inline" }, [
    el("label", { text: "Status", attrs: { for: "manage-status" } }),
    select,
    apply,
  ]);
}

function showSaveError(form: EventFormHandle, error: unknown): void {
  if (error instanceof ApiError) {
    const field = fieldFor(error);
    if (field) {
      const message =
        error.code === "VALIDATION_ERROR"
          ? "Check this value and try again."
          : messageForError(error);
      form.setFieldError(field, message);
      form.setStatus(message, "error");
      return;
    }
    if (error.status === 403) {
      form.setStatus(ERROR_COPY.FORBIDDEN, "error");
      return;
    }
  }
  form.setStatus(messageForError(error), "error");
}

function fieldFor(error: ApiError): EventField | null {
  if (error.code === "CAPACITY_CONFLICT") {
    return "capacity";
  }
  if (error.code === "EVENT_START_TIME_INVALID") {
    return "startsAt";
  }
  return EVENT_FIELDS.find((field) => field === error.field) ?? null;
}

type ActionsFactory = (event: ManagementEvent) => HTMLElement;

function managementTable(
  events: ManagementEvent[],
  mode: ManagementMode,
  actions: ActionsFactory,
): HTMLElement {
  const headers = [
    "Event",
    ...(mode === "admin" ? ["Owner"] : []),
    "Date",
    "Capacity",
    "Status",
    "Actions",
  ];
  return el("table", { testid: "manage-table", className: "manage-table" }, [
    el("thead", {}, [
      el(
        "tr",
        {},
        headers.map((text) => el("th", { text, attrs: { scope: "col" } })),
      ),
    ]),
    el(
      "tbody",
      {},
      events.map((event) =>
        el("tr", { testid: "manage-row" }, [
          el("th", { text: event.title, attrs: { scope: "row" } }),
          mode === "admin"
            ? el("td", { text: event.organizerSubject, testid: "manage-owner" })
            : null,
          el("td", { text: formatDateTime(event.startsAt) }),
          el("td", { text: capacityText(event.capacity, event.confirmedRsvpCount) }),
          el("td", { text: event.lifecycleStatus }),
          el("td", {}, [actions(event)]),
        ]),
      ),
    ),
  ]);
}

function managementCard(
  event: ManagementEvent,
  mode: ManagementMode,
  actions: ActionsFactory,
): HTMLElement {
  const rows: [string, string][] = [
    ...(mode === "admin" ? ([["Owner", event.organizerSubject]] as [string, string][]) : []),
    ["Date", formatDateTime(event.startsAt)],
    ["Capacity", capacityText(event.capacity, event.confirmedRsvpCount)],
    ["Status", event.lifecycleStatus],
  ];
  return el("article", { testid: "manage-card", className: "card" }, [
    el("h2", { text: event.title }),
    el(
      "dl",
      { className: "meta" },
      rows.flatMap(([term, value]) => [el("dt", { text: term }), el("dd", { text: value })]),
    ),
    actions(event),
  ]);
}
