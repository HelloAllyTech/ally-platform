import { describe, expect, it, vi } from "vitest";

import { BUILD_COPY } from "../create/copy";
import { FieldQueue, outcomeOf } from "../create/fieldQueue";
import {
  crawlFailureText,
  defaultMode,
  looksLikeAddress,
  modeAfterStart,
  showsStart,
  suggestionsFor,
} from "../create/logic";

const ok = (field: string, value: unknown, version: string) => ({
  field,
  value,
  version,
  settingsHash: `h-${version}`,
  staged: false,
});

describe("per-field queue", () => {
  it("sends rapid edits one at a time, each on the version the last one returned", async () => {
    const sent: { value: unknown; version: string }[] = [];
    let release: () => void = () => undefined;
    const send = vi.fn((field: string, value: unknown, version: string) => {
      sent.push({ value, version });
      const next = `v${sent.length}`;
      return sent.length === 1
        ? new Promise<ReturnType<typeof ok>>(resolve => {
            release = () => resolve(ok(field, value, next));
          })
        : Promise.resolve(ok(field, value, next));
    });
    const outcomes: string[] = [];
    const q = new FieldQueue({
      send,
      onSaved: () => undefined,
      onOutcome: (_f, o) => outcomes.push(o.status),
    });
    q.setBase("name", "v0");
    const first = q.submit("name", "A");
    // Two more while the first is in flight: only the newest is sent after it.
    void q.submit("name", "AB");
    const third = q.submit("name", "ABC");
    expect(q.busy("name")).toBe(true);
    release();
    await first;
    await third;
    expect(sent).toEqual([
      { value: "A", version: "v0" },
      { value: "ABC", version: "v1" },
    ]);
    expect(q.version("name")).toBe("v2");
    expect(outcomes[outcomes.length - 1]).toBe("saved");
  });

  it("never makes one field wait for another", async () => {
    const send = vi.fn((field: string, value: unknown, _version: string) =>
      Promise.resolve(ok(field, value, "x")),
    );
    const q = new FieldQueue({ send, onSaved: () => undefined, onOutcome: () => undefined });
    q.setBase("name", "a");
    q.setBase("tone", "b");
    await Promise.all([q.submit("name", "N"), q.submit("tone", "warm")]);
    expect(send.mock.calls.map(c => [c[0], c[2]])).toEqual([
      ["name", "a"],
      ["tone", "b"],
    ]);
  });

  it("stops on a 409 and hands back what the server says now (the typed text is the caller's)", async () => {
    const send = vi.fn().mockRejectedValue({
      status: 409,
      data: {
        errorCode: "stale_field",
        details: { field: "instructions", value: "Theirs", version: "v9" },
      },
    });
    const outcomes: unknown[] = [];
    const q = new FieldQueue({ send, onSaved: vi.fn(), onOutcome: (_f, o) => outcomes.push(o) });
    q.setBase("instructions", "v1");
    await q.submit("instructions", "Mine");
    expect(outcomes[outcomes.length - 1]).toEqual({
      status: "stale",
      current: { value: "Theirs", version: "v9" },
    });
    // A fresh read doesn't move a field that's waiting on Reload/Overwrite… but Overwrite rebases.
    q.rebase("instructions", "v9");
    send.mockResolvedValueOnce(ok("instructions", "Mine", "v10"));
    await q.submit("instructions", "Mine");
    expect(send.mock.calls[1]).toEqual(["instructions", "Mine", "v9"]);
  });

  it("reads refusals, $0 and network failures apart", () => {
    expect(
      outcomeOf({
        status: 400,
        data: { errorCode: "safety_locked", message: "Locked by the pack." },
      }),
    ).toEqual({ status: "refused", reason: "Locked by the pack." });
    expect(outcomeOf({ status: 402, data: { errorCode: "credits_required" } })).toEqual({
      status: "credits",
    });
    expect(outcomeOf({ status: "FETCH_ERROR" })).toEqual({ status: "failed" });
  });
});

describe("crawl failures in plain words", () => {
  it.each([
    "crawl_daily_limit",
    "crawl_unreachable",
    "crawl_needs_javascript",
    "crawl_turned_away",
    "crawl_blocked",
    "crawl_little_found",
    "crawl_failed",
  ])("explains %s without showing the code", code => {
    const text = crawlFailureText(code);
    expect(text).toBe(BUILD_COPY.crawlFailure[code]);
    expect(text).not.toContain(code);
  });

  it("falls back to the server's message, then a generic line", () => {
    expect(crawlFailureText("crawl_new_thing", "Server words")).toBe("Server words");
    expect(crawlFailureText(undefined)).toBe(BUILD_COPY.crawlFailure.crawl_failed);
  });
});

describe("start, modes and suggestions", () => {
  it("offers the start options only on a blank with nothing chosen (a test message doesn't count)", () => {
    expect(showsStart({ blank: true, template: null, buildMode: null })).toBe(true);
    expect(
      showsStart({ blank: true, template: { id: "t", version: 1, name: "T" }, buildMode: null }),
    ).toBe(false);
    expect(showsStart({ blank: true, template: null, buildMode: "copilot" })).toBe(false);
    expect(showsStart({ blank: false, template: null, buildMode: null })).toBe(false);
  });

  it("opens Copilot after a start path, the form after a template or for an existing chatbot", () => {
    expect(modeAfterStart("website")).toBe("copilot");
    expect(modeAfterStart("documents")).toBe("copilot");
    expect(modeAfterStart("interview")).toBe("copilot");
    expect(modeAfterStart("template")).toBe("form");
    expect(defaultMode({ buildMode: null })).toBe("form");
    expect(defaultMode({ buildMode: "copilot" })).toBe("copilot");
  });

  it("tells a web address from a sentence", () => {
    expect(looksLikeAddress("sunrise.org")).toBe(true);
    expect(looksLikeAddress("https://x.com/a")).toBe(true);
    expect(looksLikeAddress("make it warmer")).toBe(false);
  });

  it("suggests what is still missing, and drops an item once it's done", () => {
    expect(suggestionsFor({}, false)).toEqual([
      "sources",
      "greeting",
      "instructions",
      "questions",
      "contact",
      "tone",
    ]);
    expect(
      suggestionsFor(
        {
          introduction: "Hi",
          instructions: "Be brief",
          suggestedQuestions: ["Fees?"],
          declineText: "Call 98450 12345",
          tone: "warm",
        },
        true,
      ),
    ).toEqual([]);
  });
});

describe("paused out of credits", () => {
  it("recognises the paused document message", async () => {
    const { isPausedMessage } = await import("../create/copy");
    expect(
      isPausedMessage("Paused: out of credits. It will be read once you have credits again."),
    ).toBe(true);
    expect(isPausedMessage("Couldn't read")).toBe(false);
    expect(isPausedMessage(null)).toBe(false);
  });

  it("tells each backend reason apart (ally-be KB_PAUSED_MESSAGES)", async () => {
    const { pausedKindOf, isPausedMessage } = await import("../create/copy");
    expect(
      pausedKindOf(
        "Paused: usage tracking is temporarily unavailable. It will be read automatically once it is back.",
      ),
    ).toBe("feed_off");
    expect(
      pausedKindOf(
        "Paused: this chatbot has no billing account yet. It will be read once one is set up.",
      ),
    ).toBe("no_payer");
    expect(
      pausedKindOf("Paused: credits could not be checked just now. It will be read automatically."),
    ).toBe("ledger_unavailable");
    expect(
      pausedKindOf("Paused: out of credits. It will be read once you have credits again."),
    ).toBe("out_of_credits");
    expect(isPausedMessage("Paused: usage tracking is temporarily unavailable.")).toBe(true);
  });

  it("a stopped usage feed never asks the builder to contact Ally for credits", async () => {
    const { PAUSED_REASON_COPY } = await import("../create/copy");
    const feed = PAUSED_REASON_COPY.feed_off;
    for (const text of [feed.site, feed.document, feed.note ?? ""]) {
      expect(text).not.toMatch(/contact ally|credits/i);
    }
    expect(feed.document).toMatch(/usage tracking/i);
    expect(PAUSED_REASON_COPY.out_of_credits.note).toMatch(/contact ally/i);
    expect(PAUSED_REASON_COPY.no_payer.document).toMatch(/no billing account/i);
  });
});
