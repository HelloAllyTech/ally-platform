import { describe, expect, it } from "vitest";

// Raw source, via Vite's ?raw import. See the note below on why this is a source check.
import baseApiSource from "../baseApi.ts?raw";
import whatsappBotSource from "../whatsappBot.ts?raw";

/**
 * Every tag a slice uses must ALSO be declared in baseAPI's `tagTypes`.
 *
 * RTK Query silently ignores an unregistered tag — the invalidation simply never fires, so a save
 * appears to succeed while the list keeps showing stale data. baseApi.ts carries a comment about
 * four tags that shipped exactly that way once.
 *
 * Checked against the SOURCE rather than the runtime api object because RTK Query does not expose
 * `tagTypes` on the created api — there is no supported way to read the registered set back. A
 * source check encodes the real invariant ("these two lists agree") and cannot be fooled by an
 * internal shape change, which is more than can be said for poking at private fields.
 */
describe("whatsappBot API tag registration", () => {
  const usedTags = [...new Set(whatsappBotSource.match(/TAG_TYPES\.[A-Z0-9_]+/g) ?? [])];

  it("uses at least one tag (guards against the regex silently matching nothing)", () => {
    expect(usedTags.length).toBeGreaterThan(0);
  });

  it.each(usedTags)("registers %s in baseApi tagTypes", tag => {
    expect(
      baseApiSource.includes(tag),
      `${tag} is used by api/whatsappBot.ts but not registered in api/baseApi.ts tagTypes — ` +
        `RTK Query will ignore it and the cache invalidation will never fire`,
    ).toBe(true);
  });
});

/**
 * `@carbon/charts` stays out of AI Chatbots' pages.
 *
 * The AI Chatbots route loads eagerly, so one top-level chart import in any of its files pulls the
 * whole chart library into the eager bundle, and nothing about the page looks or behaves
 * differently, so nobody notices. The classic usage tab was its only user, behind a lazy boundary;
 * since CL1, All numbers on the Overview draws plain bars and nothing here imports it. This is that
 * regression test.
 */
describe("AI Chatbots stay free of the chart library", () => {
  const sources = {
    ...(import.meta.glob("../../pages/WhatsAppBot/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>),
    ...(import.meta.glob("../../pages/AssistantHome/**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>),
  };

  it("finds the sources (guards against the glob silently matching nothing)", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it("imports @carbon/charts nowhere", () => {
    const chartImporters = Object.entries(sources)
      .filter(([, source]) => /from "@carbon\/charts/.test(source))
      .map(([path]) => path);
    expect(chartImporters).toEqual([]);
  });
});
