import { BOT_ID, CHATBOT } from "./assistantHome.fixture";

import type { Page, Route } from "@playwright/test";

/**
 * Lists (chunk 5b) from fixtures: ally-be's `v1/chatbots/:id/lists` API answered in memory, with
 * the shapes 5b's contract fixes (abilities and time zone on each list, created_by on entries,
 * refusals as `details`). Register after `mockAssistantHome`: Playwright tries the newest route
 * first. `start: "empty"` has no lists; `"booked"` has Slots and Appointments with entries.
 */

const ZONE = "Asia/Kolkata";
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

type Field = {
  key: string;
  label: string;
  type: string;
  options?: Record<string, unknown>;
  required?: boolean;
  default?: unknown;
  privacy?: { masked?: boolean; never_store?: boolean };
  agent_read?: boolean;
  agent_write?: boolean;
};
type Rule = { kind: string; config: Record<string, unknown> };
type Def = {
  key: string;
  name: string;
  settings: Record<string, string>;
  agent_read: boolean;
  fields: Field[];
  rules: Rule[];
};

const f = (key: string, label: string, type: string, extra: Partial<Field> = {}): Field => ({
  key,
  label,
  type,
  ...extra,
});
const select = (key: string, label: string, values: string[], extra: Partial<Field> = {}) =>
  f(key, label, "select", { options: { values }, ...extra });
const moves = (field: string, allowed: Record<string, string[]>): Rule => ({
  kind: "transitions",
  config: { field, initial: [Object.keys(allowed)[0]], allowed },
});

/** The ready-made catalogue, as READY-MADE-LISTS.md has it (14, grouped). */
const ITEMS: {
  group: string;
  name: string;
  title: string;
  one_liner: string;
  examples: string[];
  lists: Def[];
  needs?: { list: string; field: string; label: string; examples: string[] };
}[] = [
  {
    group: "Appointments and visits",
    name: "appointments",
    title: "Appointments",
    one_liner: "For clinics, therapists, salons and consultants.",
    examples: ["What's free on Thursday?", "Book 11:00", "Cancel my appointment."],
    needs: {
      list: "appointments",
      field: "service",
      label: "Service",
      examples: ["Consultation", "Follow-up", "Therapy session"],
    },
    lists: [
      {
        key: "slots",
        name: "Slots",
        settings: { title_field: "starts_at", default_sort: "starts_at" },
        agent_read: true,
        fields: [
          f("starts_at", "Time", "datetime", { required: true, agent_write: false }),
          f("practitioner", "Practitioner", "text"),
          f("duration", "Duration", "duration", { default: 50 }),
          f("open", "Open", "boolean", { default: true }),
        ],
        rules: [],
      },
      {
        key: "appointments",
        name: "Appointments",
        settings: { title_field: "slot", person_field: "client" },
        agent_read: true,
        fields: [
          f("slot", "Slot", "relation", {
            options: { to: "slots" },
            required: true,
            agent_write: true,
          }),
          f("client", "Client", "relation", { options: { to: "contact" }, required: true }),
          select("service", "Service", ["Consultation", "Follow-up", "Therapy session"], {
            agent_write: true,
          }),
          select("status", "Status", ["booked", "confirmed", "completed", "cancelled", "no_show"], {
            default: "booked",
            agent_write: true,
          }),
          f("notes", "Notes", "long_text", { privacy: { never_store: true }, agent_read: false }),
        ],
        rules: [
          {
            kind: "unique",
            config: { fields: ["slot"], where: { field: "status", not_in: ["cancelled"] } },
          },
          {
            kind: "limit_per_person",
            config: {
              field: "client",
              max: 2,
              where: { field: "status", in: ["booked", "confirmed"] },
            },
          },
          moves("status", {
            booked: ["confirmed", "cancelled"],
            confirmed: ["completed", "cancelled", "no_show"],
            completed: [],
            cancelled: [],
            no_show: [],
          }),
        ],
      },
    ],
  },
  {
    group: "Appointments and visits",
    name: "site_visits",
    title: "Site visits",
    one_liner: "For real estate agents and builders.",
    examples: ["2BHK in Baner under 85 lakh", "Can I see it on Saturday at 11?"],
    lists: [
      {
        key: "property_listings",
        name: "Property listings",
        settings: { title_field: "title" },
        agent_read: true,
        fields: [
          f("title", "Title", "text", { required: true }),
          f("area", "Area", "text", { required: true }),
          select("bhk", "BHK", [
            "1 RK",
            "1 BHK",
            "2 BHK",
            "3 BHK",
            "4+ BHK",
            "Plot",
            "Shop",
            "Office",
          ]),
          f("price", "Price", "money"),
        ],
        rules: [],
      },
      {
        key: "site_visits",
        name: "Site visits",
        settings: { title_field: "at", person_field: "visitor" },
        agent_read: true,
        fields: [
          f("listing", "Listing", "relation", {
            options: { to: "property_listings" },
            required: true,
          }),
          f("visitor", "Visitor", "relation", { options: { to: "contact" }, required: true }),
          f("at", "At", "datetime", { required: true, agent_write: true }),
          select("status", "Status", ["requested", "confirmed", "done", "cancelled"]),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Appointments and visits",
    name: "table_reservations",
    title: "Table reservations",
    one_liner: "For restaurants and cafés.",
    examples: ["A table for 4 tomorrow at 8?"],
    lists: [
      {
        key: "tables",
        name: "Tables",
        settings: { title_field: "starts_at" },
        agent_read: true,
        fields: [
          f("starts_at", "Time", "datetime", { required: true }),
          f("table", "Table", "text", { required: true }),
          f("seats", "Seats", "number"),
          f("open", "Open", "boolean"),
        ],
        rules: [],
      },
      {
        key: "reservations",
        name: "Reservations",
        settings: { title_field: "table_slot", person_field: "guest" },
        agent_read: true,
        fields: [
          f("table_slot", "Table slot", "relation", { options: { to: "tables" }, required: true }),
          f("guest", "Guest", "relation", { options: { to: "contact" }, required: true }),
          f("party_size", "Party size", "number"),
          f("occasion", "Occasion", "text"),
          select("status", "Status", ["booked", "seated", "completed", "cancelled", "no_show"]),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Classes and events",
    name: "classes",
    title: "Class bookings",
    one_liner: "For gyms, yoga, dance and coaching batches.",
    examples: ["Is there a beginners' yoga class on Saturday?", "Book me in."],
    lists: [
      {
        key: "classes",
        name: "Classes",
        settings: { title_field: "name" },
        agent_read: true,
        fields: [
          f("name", "Name", "text", { required: true }),
          f("starts_at", "Time", "datetime", { required: true }),
          f("teacher", "Teacher", "text"),
          f("seats", "Seats", "number", { default: 20 }),
          select("level", "Level", ["beginner", "intermediate", "advanced", "all"]),
        ],
        rules: [],
      },
      {
        key: "bookings",
        name: "Bookings",
        settings: { title_field: "class", person_field: "member" },
        agent_read: true,
        fields: [
          f("class", "Class", "relation", { options: { to: "classes" }, required: true }),
          f("member", "Member", "relation", { options: { to: "contact" }, required: true }),
          select("status", "Status", ["booked", "attended", "cancelled"]),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Classes and events",
    name: "event_registrations",
    title: "Event registrations",
    one_liner: "For workshops, webinars, camps and open days.",
    examples: ["Is the Saturday workshop still open?", "Register me and a friend."],
    lists: [
      {
        key: "events",
        name: "Events",
        settings: { title_field: "name" },
        agent_read: true,
        fields: [
          f("name", "Name", "text", { required: true }),
          f("starts_at", "Time", "datetime", { required: true }),
          f("venue", "Venue", "text"),
          f("seats", "Seats", "number"),
          f("fee", "Fee", "money"),
        ],
        rules: [],
      },
      {
        key: "registrations",
        name: "Registrations",
        settings: { title_field: "event", person_field: "attendee" },
        agent_read: true,
        fields: [
          f("event", "Event", "relation", { options: { to: "events" }, required: true }),
          f("attendee", "Attendee", "relation", { options: { to: "contact" }, required: true }),
          f("guests", "Guests", "number"),
          select("status", "Status", ["registered", "attended", "cancelled"]),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Sales and enquiries",
    name: "leads",
    title: "Leads",
    one_liner: "For any business that follows up on enquiries.",
    examples: ["Can someone call me about the 3-month plan?"],
    needs: {
      list: "leads",
      field: "interest",
      label: "Interest",
      examples: ["Consultation", "Package", "Other"],
    },
    lists: [
      {
        key: "leads",
        name: "Leads",
        settings: { title_field: "name" },
        agent_read: false,
        fields: [
          f("name", "Name", "text", { required: true }),
          f("phone", "Phone", "phone", { required: true }),
          f("email", "Email", "email"),
          select("interest", "Interest", ["Consultation", "Package", "Other"]),
          f("budget", "Budget", "money"),
          select("status", "Status", ["new", "contacted", "qualified", "won", "lost"]),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Sales and enquiries",
    name: "callback_requests",
    title: "Callback requests",
    one_liner: "When someone wants the team to call them back.",
    examples: ["Call me back about my bill"],
    lists: [
      {
        key: "callback_requests",
        name: "Callback requests",
        settings: { title_field: "reason" },
        agent_read: true,
        fields: [
          f("phone", "Phone", "phone", { required: true }),
          f("requester", "Requester", "relation", { options: { to: "contact" }, required: true }),
          f("reason", "Reason", "text", { required: true }),
          select("preferred_time", "Preferred time", [
            "morning",
            "afternoon",
            "evening",
            "any time",
          ]),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Sales and enquiries",
    name: "admissions_enquiries",
    title: "Admissions enquiries",
    one_liner: "For coaching institutes, schools and colleges.",
    examples: ["Is there a weekend batch for Class 10?"],
    lists: [
      {
        key: "admissions_enquiries",
        name: "Admissions enquiries",
        settings: { title_field: "student_name" },
        agent_read: true,
        fields: [
          f("student_name", "Student name", "text", { required: true }),
          f("parent", "Parent", "relation", { options: { to: "contact" }, required: true }),
          f("phone", "Phone", "phone", { required: true }),
          select("grade", "Grade", ["Class 6–8", "Class 9–10", "Class 11–12", "Graduate", "Other"]),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Shops and orders",
    name: "products",
    title: "Products",
    one_liner: "For shops, pharmacies (non-prescription items only) and bakeries.",
    examples: ["Do you have whole-wheat bread? How much?"],
    lists: [
      {
        key: "products",
        name: "Products",
        settings: { title_field: "name" },
        agent_read: true,
        fields: [
          f("name", "Name", "text", { required: true }),
          f("price", "Price", "money"),
          f("in_stock", "In stock", "boolean"),
          f("sku", "SKU", "text"),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Shops and orders",
    name: "orders",
    title: "Orders",
    one_liner: "For shops that take orders on WhatsApp.",
    examples: ["Where's my order?"],
    lists: [
      {
        key: "orders",
        name: "Orders",
        settings: { title_field: "number" },
        agent_read: true,
        fields: [
          f("number", "Number", "text", { required: true }),
          f("customer", "Customer", "relation", { options: { to: "contact" }, required: true }),
          f("items", "Items", "long_text", { required: true }),
          f("total", "Total", "money"),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Shops and orders",
    name: "service_areas",
    title: "Service areas",
    one_liner: "For delivery and home services.",
    examples: ["Do you deliver to 411045?"],
    lists: [
      {
        key: "service_areas",
        name: "Service areas",
        settings: { title_field: "area" },
        agent_read: true,
        fields: [
          f("pincode", "Pincode", "text", { required: true }),
          f("area", "Area", "text", { required: true }),
          f("delivers", "Delivers", "boolean"),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Services and support",
    name: "price_list",
    title: "Price list",
    one_liner: "Your services and prices, answered the same way every time.",
    examples: ["How much is a consultation?"],
    lists: [
      {
        key: "price_list",
        name: "Price list",
        settings: { title_field: "service" },
        agent_read: true,
        fields: [
          f("service", "Service", "text", { required: true }),
          f("price", "Price", "money"),
          f("duration", "Duration", "duration"),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Services and support",
    name: "support_tickets",
    title: "Support tickets",
    one_liner: "For any business with after-sales questions.",
    examples: ["Any update on my complaint?"],
    lists: [
      {
        key: "support_tickets",
        name: "Support tickets",
        settings: { title_field: "subject" },
        agent_read: true,
        fields: [
          f("subject", "Subject", "text", { required: true }),
          f("customer", "Customer", "relation", { options: { to: "contact" }, required: true }),
          select("priority", "Priority", ["low", "normal", "urgent"]),
        ],
        rules: [],
      },
    ],
  },
  {
    group: "Services and support",
    name: "memberships",
    title: "Memberships",
    one_liner: "For gyms, clubs and subscription services.",
    examples: ["When does my membership end?"],
    lists: [
      {
        key: "memberships",
        name: "Memberships",
        settings: { title_field: "plan" },
        agent_read: true,
        fields: [
          f("member", "Member", "relation", { options: { to: "contact" }, required: true }),
          select("plan", "Plan", ["Monthly", "Quarterly", "Yearly"], { required: true }),
          f("starts_on", "Starts on", "date", { required: true }),
          f("ends_on", "Ends on", "date"),
        ],
        rules: [],
      },
    ],
  },
];

export const CATALOGUE = {
  groups: [...new Set(ITEMS.map(i => i.group))].map(name => ({
    name,
    items: ITEMS.filter(i => i.group === name).map(i => ({
      name: i.name,
      title: i.title,
      one_liner: i.one_liner,
      examples: i.examples,
      lists: i.lists.map(l => ({
        key: l.key,
        name: l.name,
        fields: l.fields.map(x => ({
          key: x.key,
          label: x.label,
          type: x.type,
          required: Boolean(x.required),
        })),
      })),
      needs_options: i.needs ? [i.needs] : [],
    })),
  })),
};

let ids = 0;
const uuid = (prefix: string) =>
  `${prefix}-${(++ids).toString(16).padStart(8, "0")}-4000-8000-000000000000`;

const viewOf = (def: Def, records: number, abilities?: Record<string, string>) => ({
  id: `list-${def.key}`,
  key: def.key,
  name: def.name,
  settings: def.settings,
  agent_read: def.agent_read,
  agent_write: Boolean(abilities && (abilities.create === "do_it" || abilities.update === "do_it")),
  deleted_at: null,
  record_count: records,
  fields: def.fields.map((x, position) => ({
    key: x.key,
    label: x.label,
    type: x.type,
    options: x.options ?? {},
    required: Boolean(x.required),
    default: x.default ?? null,
    privacy: x.privacy ?? {},
    agent_read: x.agent_read ?? true,
    agent_write: x.agent_write ?? false,
    position,
    archived_at: null,
  })),
  rules: def.rules.map((r, i) => ({ id: `${def.key}-rule-${i}`, ...r })),
  abilities: {
    find: def.agent_read ? "do_it" : "never",
    create: "never",
    update: "never",
    ...abilities,
  },
  time_zone: ZONE,
});

type Entry = {
  id: string;
  version: number;
  title: string;
  data: Record<string, unknown>;
  display: Record<string, string>;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: { kind: string; name?: string; conversation_id?: string } | null;
};

/** As ally-be's engine renders a date and time: "Mon 16 Nov 2026, 14:00". */
const slotTitle = (iso: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: ZONE,
    })
      .formatToParts(new Date(iso))
      .map(x => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
};

/** Mon 16 Nov 2026 to Fri 20 Nov, 10:00 to 16:00. */
const slotTimes = () => {
  const out: string[] = [];
  for (const day of [16, 17, 18, 19, 20]) {
    for (const hour of [10, 11, 12, 14, 15, 16])
      out.push(`2026-11-${day}T${String(hour).padStart(2, "0")}:00:00+05:30`);
  }
  return out;
};

export async function mockLists(
  page: Page,
  options: { start?: "empty" | "booked"; failEntries?: boolean; otherBots?: boolean } = {},
) {
  const defs: Def[] = [];
  const entries: Record<string, Entry[]> = {};
  const abilities: Record<string, Record<string, string>> = {};
  const now = "2026-11-14T09:00:00.000Z";

  const install = (name: string) => {
    const item = ITEMS.find(i => i.name === name)!;
    for (const def of item.lists) {
      defs.push(structuredClone(def));
      entries[def.key] = [];
    }
    return item.lists.map(l => l.key);
  };

  if (options.start === "booked") {
    install("appointments");
    const slots = slotTimes().map(iso => {
      const e: Entry = {
        id: uuid("slot"),
        version: 1,
        title: slotTitle(iso),
        data: {
          starts_at: iso,
          practitioner: iso.includes("T1") && /T1[01]/.test(iso) ? "Dr Mehta" : "Dr Rao",
          duration: 50,
          open: true,
        },
        display: {},
        contact_id: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        created_by: { kind: "user", name: "Shehbaz" },
      };
      e.display = {
        starts_at: e.title,
        practitioner: String(e.data.practitioner),
        duration: "50 min",
        open: "Yes",
      };
      return e;
    });
    entries.slots = slots;
    const people = ["Ananya Rao", "Visitor · 4821", "Kabir Shah", "Meera Iyer"];
    const statuses = ["booked", "confirmed", "booked", "cancelled"];
    entries.appointments = [3, 8, 13, 20].map((n, i) => ({
      id: uuid("appt"),
      version: 1,
      title: slots[n].title,
      data: {
        slot: slots[n].id,
        client: `contact-${i}`,
        service: i === 1 ? "Follow-up" : "Consultation",
        status: statuses[i],
      },
      display: {
        slot: slots[n].title,
        client: people[i],
        service: i === 1 ? "Follow-up" : "Consultation",
        status: statuses[i],
      },
      contact_id: `contact-${i}`,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      created_by:
        i === 1 ? { kind: "agent", conversation_id: "conv-1" } : { kind: "user", name: "" },
    }));
    abilities.appointments = { create: "do_it", update: "never" };
  }

  const view = (def: Def) =>
    viewOf(def, (entries[def.key] ?? []).filter(e => !e.deleted_at).length, abilities[def.key]);

  if (options.otherBots) {
    await page.route("**/api/v1/chatbots", route =>
      json(route, {
        chatbots: [
          {
            ...CHATBOT,
            connectors: [
              {
                id: "c1",
                type: "whatsapp",
                typeLabel: "WhatsApp",
                name: "+91 98200 12345",
                chatbotId: BOT_ID,
                chatbotName: CHATBOT.name,
                summary: null,
                createdAt: now,
              },
            ],
          },
          {
            ...CHATBOT,
            id: "7a0d2b63-2222-4b9f-8b1d-2c3d4e5f6071",
            name: "Glow Salon",
            connectors: [],
          },
          {
            ...CHATBOT,
            id: "8b1e3c74-3333-4cab-9c2e-3d4e5f607182",
            name: "Baner Homes",
            connectors: [
              {
                id: "c2",
                type: "website",
                typeLabel: "Website",
                name: "baner.example",
                chatbotId: null,
                chatbotName: null,
                summary: null,
                createdAt: now,
              },
            ],
          },
        ],
        canCreate: false,
      }),
    );
  }

  await page.route(`**/api/v1/chatbots/${BOT_ID}/lists**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/lists/, "");
    const method = request.method();
    const body = () => (request.postData() ? request.postDataJSON() : {}) as Record<string, any>;

    if (path === "" && method === "GET") return json(route, defs.map(view));
    if (path === "/ready-made" && method === "GET") return json(route, CATALOGUE);
    const ready = /^\/ready-made\/(\w+)$/.exec(path);
    if (ready && method === "POST") {
      const keys = install(ready[1]);
      return json(route, { lists: keys.map(k => view(defs.find(d => d.key === k)!)) }, 201);
    }
    if (path === "/contacts") {
      return json(route, {
        contacts: [
          { id: "contact-0", name: "Ananya Rao", hint: "WhatsApp" },
          { id: "contact-1", name: "Visitor · 4821", hint: "Bot page" },
          { id: "contact-2", name: "Kabir Shah", hint: "WhatsApp" },
        ],
      });
    }

    const m = /^\/(\w+)(\/.*)?$/.exec(path);
    if (!m) return json(route, { message: "Not found" }, 404);
    const def = defs.find(d => d.key === m[1]);
    if (!def) return json(route, { message: "Not found" }, 404);
    const rest = m[2] ?? "";
    const list = entries[def.key];

    if (rest === "/abilities" && method === "PUT") {
      abilities[def.key] = { ...abilities[def.key], ...body() };
      return json(route, view(def));
    }
    if (rest === "/fields" && method === "POST") {
      def.fields.push(body() as Field);
      return json(route, view(def));
    }
    const field = /^\/fields\/(\w+)$/.exec(rest);
    if (field) {
      const at = def.fields.findIndex(x => x.key === field[1]);
      if (method === "PATCH") {
        const change = body();
        if (typeof change.position === "number") {
          const [moved] = def.fields.splice(at, 1);
          def.fields.splice(change.position, 0, moved);
        } else Object.assign(def.fields[at], change);
      } else if (method === "DELETE") def.fields.splice(at, 1);
      return json(route, view(def));
    }
    if (rest === "/rules" && method === "POST") {
      const rule = body() as Rule;
      if (rule.kind === "unique" && def.key === "slots") {
        return json(
          route,
          {
            message: "The rule isn't valid: 2 entries already break it.",
            errorCode: "LIST_REFUSED",
            details: {
              code: "invalid_value",
              message: "The rule isn't valid: 2 entries already break it.",
              conflict: { records: list.slice(0, 2).map(e => ({ id: e.id, title: e.title })) },
            },
          },
          400,
        );
      }
      def.rules.push(rule);
      return json(route, view(def));
    }
    const rule = /^\/rules\/([\w-]+)$/.exec(rest);
    if (rule && method === "DELETE") {
      def.rules.splice(Number(rule[1].split("-rule-")[1]), 1);
      return json(route, view(def));
    }
    if (rest === "/records/repeat" && method === "POST") {
      const b = body();
      const [sh, sm] = String(b.start).split(":").map(Number);
      const [eh, em] = String(b.end).split(":").map(Number);
      const perDay = Math.max(
        0,
        Math.ceil((eh * 60 + em - (sh * 60 + sm)) / Number(b.every_minutes)),
      );
      let days = 0;
      for (
        let d = new Date(`${b.from}T00:00:00Z`);
        d <= new Date(`${b.until}T00:00:00Z`);
        d = new Date(d.getTime() + 86400000)
      ) {
        if ((b.days as number[]).includes(((d.getUTCDay() + 6) % 7) + 1)) days += 1;
      }
      const total = perDay * days;
      // As ally-be: a time is already there only for an entry with the same details.
      const skipped =
        def.key === "slots" && list.some(e => e.data.practitioner === b.values?.practitioner)
          ? Math.min(3, total)
          : 0;
      const count = total - skipped;
      const first = [
        "Mon 16 Nov 2026, 10:00",
        "Mon 16 Nov 2026, 11:00",
        "Mon 16 Nov 2026, 12:00",
        "Mon 16 Nov 2026, 13:00",
        "Mon 16 Nov 2026, 14:00",
      ].slice(0, count);
      return json(route, {
        count,
        skipped,
        first,
        dry_run: Boolean(b.dry_run),
      });
    }
    if (rest === "/records/query" && method === "POST") {
      if (options.failEntries) return json(route, { message: "Internal error" }, 500);
      const q = body();
      let rows = list.filter(e => !e.deleted_at);
      for (const filter of (q.filters ?? []) as { field: string; value: unknown }[]) {
        rows = rows.filter(e => e.data[filter.field] === filter.value);
      }
      if (q.search) {
        const s = String(q.search).toLowerCase();
        rows = rows.filter(e => Object.values(e.display).some(v => v.toLowerCase().includes(s)));
      }
      return json(route, {
        records: rows.slice(0, q.limit ?? 50),
        total: rows.length,
        next_cursor: rows.length > 50 ? "c2" : null,
      });
    }
    if (rest === "/records" && method === "POST") {
      const data = body().data as Record<string, unknown>;
      const taken =
        def.key === "appointments" &&
        list.some(e => !e.deleted_at && e.data.slot === data.slot && e.data.status !== "cancelled");
      if (taken) {
        return json(
          route,
          {
            message: "That slot is already taken.",
            errorCode: "LIST_REFUSED",
            details: {
              code: "unique_taken",
              field: "slot",
              message: "That slot is already taken.",
              conflict: {
                alternatives: entries.slots.slice(4, 7).map(e => ({ id: e.id, title: e.title })),
              },
            },
          },
          409,
        );
      }
      const e: Entry = {
        id: uuid("rec"),
        version: 1,
        title: String(Object.values(data)[0] ?? ""),
        data,
        display: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        contact_id: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        created_by: { kind: "user" },
      };
      list.unshift(e);
      return json(route, { record: e }, 201);
    }
    const one = /^\/records\/([\w-]+)(\/restore)?$/.exec(rest);
    if (one) {
      const e = list.find(x => x.id === one[1]);
      if (!e) return json(route, { message: "That entry doesn't exist any more." }, 404);
      if (one[2] && method === "POST") {
        e.deleted_at = null;
        return json(route, { record: e });
      }
      if (method === "GET") return json(route, e);
      if (method === "PATCH") {
        const b = body();
        if (b.version !== e.version) {
          return json(
            route,
            {
              message: "Someone changed this entry just now. Reload and try again.",
              errorCode: "LIST_REFUSED",
              details: {
                code: "version_conflict",
                message: "Someone changed this entry just now. Reload and try again.",
              },
            },
            409,
          );
        }
        Object.assign(e.data, b.data);
        e.version += 1;
        return json(route, { record: e });
      }
      if (method === "DELETE") {
        if (
          def.key === "slots" &&
          entries.appointments?.some(
            a => !a.deleted_at && a.data.slot === e.id && a.data.status !== "cancelled",
          )
        ) {
          const using = entries.appointments.filter(a => a.data.slot === e.id);
          return json(
            route,
            {
              message: `${using.length} entries in Appointments use this. Cancel or move them first.`,
              errorCode: "LIST_REFUSED",
              details: {
                code: "in_use",
                message: `${using.length === 1 ? "1 entry" : `${using.length} entries`} in Appointments use this. Cancel or move them first.`,
                conflict: { records: using.map(a => ({ id: a.id, title: a.display.client })) },
              },
            },
            409,
          );
        }
        e.deleted_at = now;
        return route.fulfill({ status: 204 });
      }
    }
    return json(route, { message: "Not handled" }, 404);
  });
}
