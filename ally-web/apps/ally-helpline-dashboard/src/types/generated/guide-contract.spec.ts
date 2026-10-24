import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GUIDE_CARD_KIND_VALUES,
  GUIDE_CONTRACT_VERSION,
  GUIDE_EVENT_TYPES,
  type GuideEvent,
} from "./guide-contract";

/**
 * Contract test for the Ally guide wire format. The schema and fixtures live in
 * ally-be (src/guide/contract/); ally-be's own contract test fails when this
 * generated file is stale. Here we check that what ally-be sends is something
 * this app's generated types and constants know about.
 */
const fixtures = resolve(__dirname, "../../../../../../ally-be/src/guide/contract/fixtures");

const valid = <T>(file: string): T[] =>
  JSON.parse(readFileSync(resolve(fixtures, file), "utf8")).valid as T[];

describe("guide wire contract (learner app copy)", () => {
  const events = valid<GuideEvent>("events.json");

  it("is version 1", () => {
    expect(GUIDE_CONTRACT_VERSION).toBe(1);
  });

  it("knows every event type ally-be emits", () => {
    for (const event of events) {
      expect(GUIDE_EVENT_TYPES).toContain(event.type);
    }
  });

  it("knows every card kind ally-be presents", () => {
    for (const event of events) {
      if (event.type === "card.presented") {
        expect(GUIDE_CARD_KIND_VALUES).toContain(event.data.card.kind);
      }
    }
  });

  it("has a fixture for every event type, so none is untested", () => {
    const seen = new Set(events.map(event => event.type));
    expect([...GUIDE_EVENT_TYPES].filter(type => !seen.has(type))).toEqual([]);
  });
});
