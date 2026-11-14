import { describe, expect, it } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import type { ListEntry, ReadyMadeCatalogue, UserList } from "@types";

import { examplesFor } from "../userLists/AssistantBlock";
import { keyFor } from "../userLists/DetailsBlock";
import { exampleOptions } from "../userLists/examples";
import {
  bookedList,
  fillable,
  formatDate,
  formatDateTime,
  isoOf,
  nextValues,
  noYear,
  purposeLimit,
  ruleSentence,
  showValue,
  titleOf,
  toneOf,
  wallOf,
} from "../userLists/format";
import { otherDetails } from "../userLists/RepeatWeekly";
import { APPOINTMENTS, SLOTS, field } from "./listsFixtures";

/**
 * Lists' pure helpers (chunk 5b): dates in the business's zone and never ISO, statuses and the
 * moves they allow, rules as sentences, what the assistant might say, and the purpose's line.
 */
const NOW = new Date("2026-11-14T06:00:00Z");

describe("dates and times, in the business's zone", () => {
  it("reads like Thu 19 Nov, 11:00, with the year only when it isn't this year", () => {
    expect(formatDateTime("2026-11-19T11:00:00+05:30", "Asia/Kolkata", NOW)).toBe(
      "Thu 19 Nov, 11:00",
    );
    expect(formatDateTime("2026-11-19T05:30:00Z", "Asia/Kolkata", NOW)).toBe("Thu 19 Nov, 11:00");
    expect(formatDateTime("2027-01-04T09:00:00+05:30", "Asia/Kolkata", NOW)).toBe(
      "Mon 4 Jan 2027, 09:00",
    );
    expect(formatDate("2026-11-19", NOW)).toBe("Thu 19 Nov");
  });

  it("goes back and forth between the wall time and the engine's form", () => {
    expect(wallOf("2026-11-19T05:30:00Z", "Asia/Kolkata")).toEqual(["2026-11-19", "11:00"]);
    expect(isoOf("2026-11-19", "11:00", "Asia/Kolkata")).toBe("2026-11-19T11:00:00+05:30");
  });

  it("drops the year from an alternative's title", () => {
    expect(noYear("Mon 16 Nov 2026, 15:00")).toBe("Mon 16 Nov, 15:00");
    expect(noYear("Spin")).toBe("Spin");
  });
});

describe("entries as people read them", () => {
  const entry = {
    id: "e1",
    version: 1,
    title: "Thu 19 Nov 2026, 11:00",
    data: { slot: "s1", status: "no_show", client: "c1" },
    display: { slot: "Thu 19 Nov 2026, 11:00", status: "no_show", client: "Ananya Rao" },
  } as unknown as ListEntry;

  it("shows a linked entry's title and a choice in words", () => {
    const [slot, , , status] = APPOINTMENTS.fields;
    expect(showValue(APPOINTMENTS, slot, entry)).toContain("Thu 19 Nov");
    expect(showValue(APPOINTMENTS, status, entry)).toBe("No show");
    expect(titleOf(APPOINTMENTS, entry)).toContain("Thu 19 Nov");
  });

  it("colours a status by where it sits, and offers only the moves the rule allows", () => {
    expect(toneOf(APPOINTMENTS, "status", "booked")).toBe("new");
    expect(toneOf(APPOINTMENTS, "status", "confirmed")).toBe("active");
    expect(toneOf(APPOINTMENTS, "status", "completed")).toBe("done");
    expect(toneOf(APPOINTMENTS, "status", "cancelled")).toBe("stopped");
    expect(nextValues(APPOINTMENTS, "status", null)).toEqual(["booked"]);
    expect(nextValues(APPOINTMENTS, "status", "booked")).toEqual([
      "booked",
      "confirmed",
      "cancelled",
    ]);
    expect(nextValues(APPOINTMENTS, "service", "Consultation")).toBeNull();
  });
});

describe("rules as sentences", () => {
  it("says each kind in plain words, with what it's for", () => {
    const [unique, limit, moves] = APPOINTMENTS.rules.map(r =>
      ruleSentence(APPOINTMENTS, r, [SLOTS, APPOINTMENTS]),
    );
    expect(unique).toEqual({
      text: "Only one entry per slot.",
      lines: ["Not counting entries whose status is cancelled."],
      example: "So two people can't book the same slot.",
    });
    expect(limit.text).toBe("At most 2 per person.");
    expect(limit.lines).toEqual([
      "Not counting entries whose status is completed, cancelled or no show.",
    ]);
    expect(moves.text).toBe("Status can only move like this:");
    expect(moves.lines).toEqual([
      "Booked can move to confirmed or cancelled.",
      "Confirmed can move to completed, cancelled or no show.",
      "New entries start as booked.",
    ]);
  });

  it("reads a capacity from the linked list's own number", () => {
    const classes = {
      ...SLOTS,
      key: "classes",
      fields: [field("seats", "Seats", "number")],
    } as unknown as UserList;
    const bookings = {
      ...APPOINTMENTS,
      key: "bookings",
      fields: [field("class", "Class", "relation", { options: { to: "classes" } })],
      rules: [],
    } as unknown as UserList;
    const sentence = ruleSentence(
      bookings,
      { id: "c", kind: "capacity", config: { field: "class", max_from: "seats" } },
      [classes, bookings],
    );
    expect(sentence.text).toBe("As many entries per class as its seats.");
    expect(sentence.example).toBe("So a class stops taking entries once it's full.");
  });
});

describe("what the assistant can do", () => {
  it("knows which details it can fill, and which list a booking goes into", () => {
    expect(fillable(APPOINTMENTS).map(f => f.key)).toEqual(["slot", "service", "status"]);
    expect(fillable(SLOTS)).toEqual([]);
    expect(bookedList(APPOINTMENTS, [SLOTS, APPOINTMENTS])?.key).toBe("slots");
  });

  it("gives an example of what it might say, from the list", () => {
    const said = examplesFor(APPOINTMENTS, [SLOTS, APPOINTMENTS], "Thu 19 Nov 2026, 11:00");
    expect(said.create).toBe("“Done: you're booked for Thu 19 Nov, 11:00.”");
    expect(said.find).toBe("“Here's what I found in Appointments.”");
    expect(examplesFor(SLOTS, [SLOTS]).find).toContain("is free. Shall I book it?");
  });
});

describe("the purpose's honest limit", () => {
  it("says it books into the list once Add is on, and the onboarding line before", () => {
    expect(purposeLimit("enquiries", ["Appointments"])).toBe(
      "It books into your Appointments list. It can't take payments yet.",
    );
    expect(purposeLimit("enquiries", [])).toBe(
      "It can't book or take payments yet. It sends you each new enquiry by email.",
    );
    expect(purposeLimit("training")).toBe("It doesn't keep track of each person's progress yet.");
    expect(purposeLimit("answer", ["Appointments"])).toBeNull();
  });
});

describe("ready-made lists and repeats", () => {
  const catalogue = {
    groups: [
      {
        name: "Appointments and visits",
        items: [
          {
            name: "appointments",
            needs_options: [
              {
                list: "appointments",
                field: "service",
                label: "Service",
                examples: ["Consultation", "Follow-up"],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ReadyMadeCatalogue;

  it("asks for the owner's own choices only while the examples are still there", () => {
    expect(exampleOptions(APPOINTMENTS, catalogue)).toEqual({ field: "service", label: "Service" });
    const changed = {
      ...APPOINTMENTS,
      fields: APPOINTMENTS.fields.map(f =>
        f.key === "service" ? { ...f, options: { values: ["Therapy"] } } : f,
      ),
    } as UserList;
    expect(exampleOptions(changed, catalogue)).toBeNull();
  });

  it("gives every repeated time the list's other details, not the time or whose it is", () => {
    expect(otherDetails(SLOTS, SLOTS.fields[0]).map(f => f.key)).toEqual([
      "practitioner",
      "duration",
      "open",
    ]);
    expect(otherDetails(APPOINTMENTS, APPOINTMENTS.fields[0]).map(f => f.key)).not.toContain(
      "client",
    );
  });

  it("makes a key from a name, by the slug rule, never reusing one", () => {
    expect(keyFor("Waiting list", [])).toBe("waiting_list");
    expect(keyFor("Waiting list", ["waiting_list"])).toBe("waiting_list_2");
    expect(keyFor("Café orders!", [])).toBe("cafe_orders");
  });
});
