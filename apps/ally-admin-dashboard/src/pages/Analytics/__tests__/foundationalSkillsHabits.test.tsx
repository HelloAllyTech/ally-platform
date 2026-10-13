import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FhsAdvancedTier,
  FhsBehaviourRate,
  FoundationalSkillsAdvancedBehavioursResponse,
  FoundationalSkillsBehavioursResponse,
  advancedTakeaway,
  advancedTierRows,
  behaviourShort,
  countRate,
  countText,
  habitRows,
  habitsTakeaway,
  rateCellStyle,
  trackabilityLabel,
} from "../foundationalSkillsHabits";
import { HabitGrid } from "../HabitGrid";

const rate = (
  code: string,
  extra: Partial<FhsBehaviourRate> = {},
  change: Partial<FhsBehaviourRate["change"]> = {},
): FhsBehaviourRate => ({
  code,
  skill: code.split(".")[0],
  kind: code.includes(".u") ? "unhelpful" : code.includes(".a") ? "advanced" : "basic",
  text: `text of ${code}`,
  learnersWithChance: 74,
  ratePct: 40,
  icc: 0.2,
  trackable: true,
  change: {
    n: 26,
    startPct: 40,
    nowPct: 45,
    changePts: 5,
    ciPts: [-5, 15],
    up: 10,
    down: 8,
    signP: 0.8,
    q: 1,
    credible: false,
    learnersAdopted: 0,
    learnersDropped: 0,
    ...change,
  },
  ...extra,
});

const data = (
  behaviours: FhsBehaviourRate[],
  over: Partial<FoundationalSkillsBehavioursResponse> = {},
): FoundationalSkillsBehavioursResponse => ({
  rubricVersion: "fhs-text-v1",
  minSampleSize: 20,
  thresholds: { minCuts: 4, trackableIcc: 0.1, groupQ: 0.05, learnerP: 0.05, gridBehaviours: 10 },
  measuredLearners: 74,
  comparableLearners: 26,
  behaviours,
  gridCodes: ["rapport.b1", "hope.b2"],
  learners: [],
  provenance: { derivation: "", note: "" },
  computedAt: "2026-10-04T00:00:00Z",
  ...over,
});

describe("habit helpers", () => {
  it("filters habit rows by kind and trackability, biggest move first, dropping withheld ones", () => {
    const bs = [
      rate("rapport.b1", {}, { changePts: -2 }),
      rate("hope.b2", {}, { changePts: 9 }),
      rate("verbal.b1", { trackable: false, icc: 0.01 }, { changePts: 12 }),
      rate("verbal.u1", {}, { changePts: -20 }),
      rate("coping.b1", {}, { changePts: null }),
    ];
    expect(habitRows(bs, "trackable").map(b => b.code)).toEqual(["hope.b2", "rapport.b1"]);
    expect(habitRows(bs, "helpful").map(b => b.code)).toEqual([
      "verbal.b1",
      "hope.b2",
      "rapport.b1",
    ]);
    expect(habitRows(bs, "unhelpful").map(b => b.code)).toEqual(["verbal.u1"]);
    expect(habitRows(bs, "all")).toHaveLength(4);
  });

  it("says whether a behaviour is a personal habit", () => {
    expect(trackabilityLabel({ icc: 0.464, trackable: true })).toBe("ICC 0.46 · a personal habit");
    expect(trackabilityLabel({ icc: 0.03, trackable: false })).toBe(
      "ICC 0.03 · not person-specific",
    );
    expect(trackabilityLabel({ icc: null, trackable: false })).toBe(
      "too few repeat chances to tell",
    );
  });

  it("shortens column headers and shades rates on one hue", () => {
    expect(behaviourShort("rapport.b1", "Introduces self and explains their role")).toBe(
      "Introduces self",
    );
    expect(behaviourShort("x.b9", "A very long behaviour description indeed")).toBe(
      "A very long behaviour…",
    );
    expect(rateCellStyle(null).background).toBe("transparent");
    expect(rateCellStyle(0.9).color).toBe("#ffffff");
    expect(countText({ hits: 3, chances: 7 })).toBe("3/7");
    expect(countText({ hits: 0, chances: 0 })).toBe("—");
    expect(countRate({ hits: 3, chances: 6 })).toBe(0.5);
  });

  it("writes an honest takeaway when nothing clears the correction", () => {
    expect(habitsTakeaway(data([rate("rapport.b1"), rate("hope.b2", { trackable: false })]))).toBe(
      "No behaviour changed beyond chance across 26 learners (2 tested, corrected). 1 behaviours are personal habits worth tracking.",
    );
    expect(
      habitsTakeaway(
        data([rate("rapport.b1", {}, { credible: true, changePts: 20 }), rate("hope.b2")]),
      ),
    ).toBe("1 behaviour(s) changed beyond chance (1 up, 0 down) across 26 learners.");
  });
});

// A tier that cleared the floor (29 learners, no clear change) unless overridden.
const tier = (minSlices: number, extra: Partial<FhsAdvancedTier> = {}): FhsAdvancedTier => ({
  minSlices,
  learners: 29,
  startPct: 12.4,
  nowPct: 17.2,
  startPerSlice: 3.14,
  nowPerSlice: 4.2,
  rawChangePts: 4.8,
  changePts: 0.9,
  ciPts: [-2.1, 3.8],
  up: 18,
  down: 11,
  tied: 0,
  signP: 0.26,
  detectable: false,
  ...extra,
});

// A tier under the 20-learner floor: counts travel, every average is null.
const withheld = (minSlices: number, learners: number, up: number, down: number) =>
  tier(minSlices, {
    learners,
    startPct: null,
    nowPct: null,
    startPerSlice: null,
    nowPerSlice: null,
    rawChangePts: null,
    changePts: null,
    ciPts: null,
    up,
    down,
    signP: null,
    detectable: false,
  });

const advancedData = (tiers: FhsAdvancedTier[]): FoundationalSkillsAdvancedBehavioursResponse => ({
  rubricVersion: "fhs-text-v1",
  minSampleSize: 20,
  minCohortSize: 5,
  baselineFrom: 2,
  thresholds: { depths: [4, 6, 8, 10], minComparedSlices: 2, minOtherLearnersPerScenario: 2 },
  measuredLearners: 74,
  tiers,
  provenance: { derivation: "", note: "" },
  computedAt: "2026-10-12T00:00:00Z",
});

describe("advanced behaviours by depth", () => {
  it("words a tier that has an average in plain terms", () => {
    const [row] = advancedTierRows(advancedData([tier(4)]));
    expect(row).toEqual({
      key: "tier-4",
      label: "4+ slices",
      sublabel: "29 learners · 12% → 17% of chances · 3.1 → 4.2 per slice · 18 rose, 11 fell",
      change: 0.9,
      ci: [-2.1, 3.8],
      n: 29,
      detectable: false,
    });
  });

  it("keeps a withheld tier's counts and says why there is no average", () => {
    const [row] = advancedTierRows(advancedData([withheld(6, 19, 15, 4)]));
    expect(row.sublabel).toBe("19 learners · 15 rose, 4 fell · average withheld below 20 learners");
    expect(row).toMatchObject({ key: "tier-6", label: "6+ slices", change: null, ci: null, n: 19 });
    expect(row.detectable).toBe(false);
  });

  it("has no rows and no takeaway when no tier is returned", () => {
    const empty = advancedData([]);
    expect(advancedTierRows(empty)).toEqual([]);
    expect(advancedTakeaway(empty)).toBeUndefined();
  });

  it("calls a change inside the interval no clear change, and points at deeper withheld tiers without quoting one", () => {
    const d = advancedData([
      tier(4),
      withheld(6, 19, 15, 4),
      withheld(8, 13, 9, 4),
      withheld(10, 11, 8, 3),
    ]);
    expect(advancedTakeaway(d)).toBe(
      "No clear change in how often advanced behaviours showed up across the 29 learners with 4+ scored slices (+0.9 pts, 95% CI −2.1 to +3.8). Deeper tiers have under 20 learners: only who rose and who fell is shown, a hint only.",
    );
  });

  it("says more often when the interval excludes zero upward, less often downward", () => {
    const up = advancedData([tier(4, { changePts: 2.5, ciPts: [0.6, 4.4], detectable: true })]);
    expect(advancedTakeaway(up)).toBe(
      "Advanced behaviours showed up more often in later practice across the 29 learners with 4+ scored slices (+2.5 pts, 95% CI +0.6 to +4.4).",
    );
    const down = advancedData([
      tier(4, { changePts: -2.5, ciPts: [-4.4, -0.6], detectable: true }),
    ]);
    expect(advancedTakeaway(down)).toContain("showed up less often in later practice");
  });

  it("with no average anywhere, states the floor and points at the counts", () => {
    const d = advancedData([withheld(6, 19, 15, 4), withheld(10, 11, 8, 3)]);
    expect(advancedTakeaway(d)).toBe(
      "Averages need 20 learners and no depth tier has that yet; only who rose and who fell is shown, a hint only.",
    );
  });

  it("never claims improvement, proof or impact", () => {
    const sentences = [
      advancedTakeaway(
        advancedData([tier(4, { changePts: 2.5, ciPts: [0.6, 4.4], detectable: true })]),
      ),
      advancedTakeaway(advancedData([tier(4), withheld(10, 11, 8, 3)])),
      advancedTakeaway(advancedData([withheld(10, 11, 8, 3)])),
    ];
    for (const sentence of sentences) expect(sentence).not.toMatch(/improv|prove|proof|impact/i);
  });
});

describe("HabitGrid", () => {
  it("renders counts as text, marks clear changes, and opens a learner", () => {
    const onOpen = vi.fn();
    const d = data(
      [rate("rapport.b1", { text: "Introduces self and explains their role" }), rate("hope.b2")],
      {
        learners: [
          {
            id: 7,
            name: "Asha",
            tenantId: null,
            cuts: 8,
            comparable: true,
            behaviours: [
              {
                code: "rapport.b1",
                all: { hits: 5, chances: 8 },
                start: { hits: 0, chances: 4 },
                now: { hits: 4, chances: 4 },
                p: 0.029,
                clear: "adopted",
              },
            ],
          },
        ],
      },
    );
    const { getByText, getAllByText } = render(
      <HabitGrid data={d} learners={d.learners} onOpen={onOpen} />,
    );
    expect(getByText("Introduces self")).toBeTruthy();
    expect(getByText("5/8")).toBeTruthy();
    expect(getByText("▲")).toBeTruthy();
    expect(getAllByText("—").length).toBeGreaterThan(0); // hope.b2: no chance yet
    fireEvent.click(getByText("Asha"));
    expect(onOpen).toHaveBeenCalledWith(7);
  });
});
