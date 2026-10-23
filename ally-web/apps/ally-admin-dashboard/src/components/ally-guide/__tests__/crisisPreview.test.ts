import { describe, expect, it } from "vitest";

import { AllyGuideSupportLine } from "@types";

import { hasTeleManas, PLATFORM_DEFAULT_CRISIS_LINES, resolvePreviewLines } from "../crisisPreview";

const line = (name: string, phone: string, isCrisis = false): AllyGuideSupportLine => ({
  name,
  phone,
  hours: null,
  url: null,
  isCrisis,
});

describe("resolvePreviewLines", () => {
  it("uses the organisation's lines for the learner's language first", () => {
    const { lines, source } = resolvePreviewLines(
      {
        hi: [line("Hindi line", "+91 11111 11111")],
        en: [line("English line", "+91 22222 22222")],
      },
      "hi",
    );

    expect(source).toBe("org");
    expect(lines.map(l => l.name)).toContain("Hindi line");
    expect(lines.map(l => l.name)).not.toContain("English line");
  });

  it("falls back to the organisation's English lines, then to the platform defaults", () => {
    expect(
      resolvePreviewLines({ en: [line("English line", "+91 22222 22222")] }, "ta").source,
    ).toBe("english");

    const none = resolvePreviewLines({}, "kn");
    expect(none.source).toBe("default");
    expect(none.lines.map(l => l.phone)).toEqual(PLATFORM_DEFAULT_CRISIS_LINES.map(l => l.phone));
    expect(resolvePreviewLines(undefined, "en").source).toBe("default");
  });

  it("lists crisis lines before the others, keeping the admin's order within each group", () => {
    const { lines } = resolvePreviewLines(
      { en: [line("Office", "100"), line("Crisis A", "200", true), line("Crisis B", "300", true)] },
      "en",
    );

    expect(lines.slice(0, 3).map(l => l.name)).toEqual(["Crisis A", "Crisis B", "Office"]);
  });

  it("always puts emergency services (112) on the card", () => {
    const { lines } = resolvePreviewLines({ en: [line("Counselling", "+91 99999 99999")] }, "en");

    expect(lines.some(l => l.phone.replace(/\D/g, "") === "112")).toBe(true);
  });

  it("does not add a second 112 when the organisation already lists it", () => {
    const { lines } = resolvePreviewLines({ en: [line("Police", "112", true)] }, "en");

    expect(lines.filter(l => l.phone === "112")).toHaveLength(1);
  });

  it("does not mutate the lists it was given", () => {
    const own = [line("Office", "100"), line("Crisis", "200", true)];
    resolvePreviewLines({ en: own }, "en");

    expect(own.map(l => l.name)).toEqual(["Office", "Crisis"]);
  });
});

describe("hasTeleManas", () => {
  it("recognises Tele-MANAS by its number, however it is formatted", () => {
    expect(hasTeleManas([line("Tele-MANAS", "14416")])).toBe(true);
    expect(hasTeleManas([line("Tele-MANAS", "1-4416")])).toBe(true);
    // The toll-free alternative is a different number, and the card's note names it separately.
    expect(hasTeleManas([line("Tele-MANAS toll-free", "1-800-891-4416")])).toBe(false);
    expect(hasTeleManas([line("Other", "112")])).toBe(false);
  });
});
