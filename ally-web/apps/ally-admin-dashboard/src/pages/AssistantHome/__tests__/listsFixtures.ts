import type { ListRule, UserList } from "@types";

/** Slots and Appointments as ally-be serves them, for Lists' tests (chunk 5b). */
export const field = (
  key: string,
  label: string,
  type: string,
  extra: Record<string, unknown> = {},
) => ({
  key,
  label,
  type,
  options: {},
  required: false,
  default: null,
  privacy: {},
  agent_read: true,
  agent_write: false,
  position: 0,
  archived_at: null,
  ...extra,
});

const transitions: ListRule = {
  id: "r3",
  kind: "transitions",
  config: {
    field: "status",
    initial: ["booked"],
    allowed: {
      booked: ["confirmed", "cancelled"],
      confirmed: ["completed", "cancelled", "no_show"],
      completed: [],
      cancelled: [],
      no_show: [],
    },
  },
};

export const SLOTS = {
  id: "l1",
  key: "slots",
  name: "Slots",
  settings: { title_field: "starts_at", default_sort: "starts_at" },
  agent_read: true,
  agent_write: false,
  deleted_at: null,
  record_count: 3,
  fields: [
    field("starts_at", "Time", "datetime", { required: true, position: 0 }),
    field("practitioner", "Practitioner", "text", { position: 1 }),
    field("duration", "Duration", "duration", { default: 50, position: 2 }),
    field("open", "Open", "boolean", { default: true, position: 3 }),
  ],
  rules: [],
  abilities: { find: "do_it", create: "never", update: "never" },
  time_zone: "Asia/Kolkata",
} as unknown as UserList;

export const APPOINTMENTS = {
  ...SLOTS,
  id: "l2",
  key: "appointments",
  name: "Appointments",
  settings: { title_field: "slot", person_field: "client" },
  fields: [
    field("slot", "Slot", "relation", {
      options: { to: "slots" },
      required: true,
      agent_write: true,
      position: 0,
    }),
    field("client", "Client", "relation", { options: { to: "contact" }, position: 1 }),
    field("service", "Service", "select", {
      options: { values: ["Consultation", "Follow-up"] },
      agent_write: true,
      position: 2,
    }),
    field("status", "Status", "select", {
      options: { values: ["booked", "confirmed", "completed", "cancelled", "no_show"] },
      default: "booked",
      agent_write: true,
      position: 3,
    }),
    field("notes", "Notes", "long_text", { privacy: { never_store: true }, position: 4 }),
  ],
  rules: [
    {
      id: "r1",
      kind: "unique",
      config: { fields: ["slot"], where: { field: "status", not_in: ["cancelled"] } },
    },
    {
      id: "r2",
      kind: "limit_per_person",
      config: { field: "client", max: 2, where: { field: "status", in: ["booked", "confirmed"] } },
    },
    transitions,
  ],
} as unknown as UserList;
