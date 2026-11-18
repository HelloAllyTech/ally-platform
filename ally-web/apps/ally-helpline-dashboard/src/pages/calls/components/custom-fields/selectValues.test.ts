import { describe, expect, it } from "vitest";

import { optionLabel, resolveOptionId, resolveOptionIds } from "./selectValues";

const def = {
  options: [
    { id: "uuid-run", label: "Running away", order: 0 },
    { id: "uuid-harm", label: "Self harm", order: 1 },
  ],
};

describe("select values stored by either app", () => {
  it("resolves an id or a label (older mobile builds) to the option", () => {
    expect(resolveOptionId(def, "uuid-run")).toBe("uuid-run");
    expect(resolveOptionId(def, "running away ")).toBe("uuid-run");
    expect(resolveOptionId(def, "Retired option")).toBeNull();
    expect(resolveOptionId(def, null)).toBeNull();
  });

  it("shows the label, and an unmatched value as itself rather than —", () => {
    expect(optionLabel(def, "uuid-harm")).toBe("Self harm");
    expect(optionLabel(def, "Self harm")).toBe("Self harm");
    expect(optionLabel(def, "Retired option")).toBe("Retired option");
    expect(optionLabel(def, "")).toBeNull();
  });

  it("reads multi-select ids, labels, and a bare non-JSON value", () => {
    expect(resolveOptionIds(def, '["uuid-run","Self harm"]')).toEqual(["uuid-run", "uuid-harm"]);
    expect(resolveOptionIds(def, "Running away")).toEqual(["uuid-run"]);
    expect(resolveOptionIds(def, '["Gone"]')).toEqual(["Gone"]);
    expect(resolveOptionIds(def, null)).toEqual([]);
  });
});
