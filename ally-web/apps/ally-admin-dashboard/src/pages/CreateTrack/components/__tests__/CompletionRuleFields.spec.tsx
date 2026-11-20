import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { CompletionCriteria, TrackFormValues, TrackItemType } from "@types";

import { serializeItem } from "../../trackFormUtils";
import { CompletionRuleFields, combineDuration, splitDuration } from "../CompletionRuleFields";

/** What the builder sends to the server for a roleplay with these criteria. */
const serializeTrackItemForTest = (completionCriteria: CompletionCriteria) =>
  serializeItem(
    {
      localId: "i1",
      type: TrackItemType.ROLEPLAY,
      title: "Roleplay",
      description: "",
      scenarioId: 1,
      completionCriteria,
    } as never,
    1,
  ).completionCriteria;

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const compatState: { data?: { comparable: boolean; onlyInPre: string[]; onlyInPost: string[] } } =
  {};
const compatSpy = vi.fn();
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetAssessmentPairCompatQuery: (args: unknown, opts: { skip?: boolean }) => {
    compatSpy(args, opts);
    return { data: opts?.skip ? undefined : compatState.data };
  },
}));

let latest: TrackFormValues | null = null;

const Harness = ({
  criteria,
  others = [],
  index = 0,
}: {
  criteria: CompletionCriteria;
  /** Extra roleplays in the same section (after the item under test unless index says otherwise). */
  others?: Array<{ title: string; scenarioId?: number | null; criteria: CompletionCriteria }>;
  index?: number;
}) => {
  const self = {
    localId: "i-self",
    type: TrackItemType.ROLEPLAY,
    title: "Try out a roleplay",
    description: "",
    scenarioId: 1,
    completionCriteria: criteria,
  };
  const rest = others.map((o, n) => ({
    localId: `i-${n}`,
    type: TrackItemType.ROLEPLAY,
    title: o.title,
    description: "",
    scenarioId: o.scenarioId ?? 2 + n,
    completionCriteria: o.criteria,
  }));
  const items = [...rest.slice(0, index), self, ...rest.slice(index)];
  const methods = useForm<TrackFormValues>({
    defaultValues: {
      sections: [{ localId: "s1", title: "Section", description: "", items }],
    } as unknown as TrackFormValues,
  });
  latest = methods.watch() as TrackFormValues;
  return (
    <FormProvider {...methods}>
      <CompletionRuleFields sectionIndex={0} itemIndex={index} type={TrackItemType.ROLEPLAY} />
    </FormProvider>
  );
};

const criteria = () => latest!.sections[0].items[0].completionCriteria!;
const criteriaAt = (i: number) => latest!.sections[0].items[i].completionCriteria!;
const select = () => screen.getByLabelText("Completion requirement") as HTMLSelectElement;
const choose = (value: string) => fireEvent.change(select(), { target: { value } });
const pickType = (label: string) => fireEvent.click(screen.getByRole("radio", { name: label }));
const minutes = () =>
  screen.queryByLabelText("Minimum duration minutes") as HTMLInputElement | null;
const seconds = () =>
  screen.queryByLabelText("Minimum duration seconds") as HTMLInputElement | null;
const score = () =>
  screen.queryByLabelText("Minimum score (0 or above, optional)") as HTMLInputElement | null;
const useAs = () => screen.getByLabelText("Use as") as HTMLSelectElement;
const pairedWith = () => screen.getByLabelText("Paired with") as HTMLSelectElement;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("CompletionRuleFields — roleplay completion requirement", () => {
  it("offers the three practice gates, and no participation option", () => {
    render(<Harness criteria={{ completionLogic: "SCORE_AND_DURATION" }} />);
    expect(Array.from(select().options).map(option => option.textContent)).toEqual([
      "Minimum score",
      "Minimum duration",
      "Minimum score AND duration",
    ]);
  });

  it("shows only the inputs the chosen option reads", () => {
    render(<Harness criteria={{ completionLogic: "SCORE_AND_DURATION" }} />);
    expect(score()).not.toBeNull();
    expect(minutes()).not.toBeNull();
    expect(seconds()).not.toBeNull();

    choose("SCORE");
    expect(score()).not.toBeNull();
    expect(minutes()).toBeNull();

    choose("DURATION");
    expect(score()).toBeNull();
    expect(minutes()).not.toBeNull();
    expect(seconds()).not.toBeNull();
  });

  it("reads an item with no logic as score AND duration", () => {
    render(<Harness criteria={{}} />);
    expect(select().value).toBe("SCORE_AND_DURATION");
  });

  it("starts the duration fields empty and stores minutes + seconds as total seconds", () => {
    render(<Harness criteria={{ completionLogic: "DURATION" }} />);
    expect(minutes()!.value).toBe("");
    expect(seconds()!.value).toBe("");

    fireEvent.change(minutes()!, { target: { value: "1" } });
    fireEvent.change(seconds()!, { target: { value: "30" } });
    expect(criteria().minDurationSeconds).toBe(90);
  });

  it("shows a stored total back as minutes and seconds", () => {
    render(<Harness criteria={{ completionLogic: "DURATION", minDurationSeconds: 150 }} />);
    expect(minutes()!.value).toBe("2");
    expect(seconds()!.value).toBe("30");
  });

  it("sends the duration as total seconds, and only the gates the logic reads", () => {
    expect(
      serializeTrackItemForTest({
        completionLogic: "DURATION",
        minScore: 60,
        minDurationSeconds: 90,
      }),
    ).toEqual({ completionLogic: "DURATION", minDurationSeconds: 90 });
    expect(
      serializeTrackItemForTest({ completionLogic: "SCORE", minScore: 60, minDurationSeconds: 90 }),
    ).toEqual({ completionLogic: "SCORE", minScore: 60 });
    expect(
      serializeTrackItemForTest({
        completionLogic: "PARTICIPATION",
        minScore: 60,
        minDurationSeconds: 90,
        showResultsToLearner: false,
        assessmentPhase: "PRE",
      }),
    ).toEqual({ completionLogic: "PARTICIPATION" });
    expect(
      serializeTrackItemForTest({
        completionLogic: "SCORE_AND_DURATION",
        minScore: 60,
        minDurationSeconds: 90,
      }),
    ).toEqual({ completionLogic: "SCORE_AND_DURATION", minScore: 60, minDurationSeconds: 90 });
  });
});

describe("CompletionRuleFields — roleplay type", () => {
  it("derives the type from the criteria", () => {
    render(<Harness criteria={{ completionLogic: "PARTICIPATION" }} />);
    expect(screen.getByRole("radio", { name: "Trial" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByLabelText("Completion requirement")).toBeNull();
  });

  it("Trial writes participation only", () => {
    render(<Harness criteria={{ completionLogic: "SCORE", minScore: 60 }} />);
    pickType("Trial");
    expect(criteria()).toEqual({ completionLogic: "PARTICIPATION" });
  });

  it("Practice keeps a gate dropdown and its fields", () => {
    render(<Harness criteria={{ completionLogic: "PARTICIPATION" }} />);
    pickType("Practice");
    expect(criteria().completionLogic).toBe("SCORE_AND_DURATION");
    expect(select().value).toBe("SCORE_AND_DURATION");
    expect(score()).not.toBeNull();
    expect(minutes()).not.toBeNull();
  });

  it("Assessment writes the turn default, results on, SCORE logic, and hides duration", () => {
    render(
      <Harness criteria={{ completionLogic: "SCORE_AND_DURATION", minDurationSeconds: 90 }} />,
    );
    pickType("Assessment");
    expect(criteria()).toEqual({
      assessmentMode: true,
      completionLogic: "SCORE",
      minLearnerTurns: 10,
      showResultsToLearner: true,
    });
    expect(minutes()).toBeNull();
    expect((screen.getByLabelText("Minimum learner turns") as HTMLInputElement).value).toBe("10");
    expect(screen.queryByText(/Can't be changed once learners are enrolled/)).toBeNull();
  });

  it("writes turns, pass mark and the results toggle", () => {
    render(
      <Harness
        criteria={{ assessmentMode: true, completionLogic: "SCORE", minLearnerTurns: 10 }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Minimum learner turns"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Pass mark (0 or above, optional)"), {
      target: { value: "70" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show results to learner" }));
    expect(criteria()).toMatchObject({
      minLearnerTurns: 14,
      minScore: 70,
      showResultsToLearner: false,
    });
  });

  it("pairing writes one uuid and opposite phases on both items, with the results defaults", () => {
    render(
      <Harness
        criteria={{ assessmentMode: true, completionLogic: "SCORE", minLearnerTurns: 10 }}
        others={[
          {
            title: "Baseline roleplay",
            criteria: { assessmentMode: true, completionLogic: "SCORE", minLearnerTurns: 10 },
          },
        ]}
      />,
    );
    fireEvent.change(pairedWith(), { target: { value: "0:1" } });
    const own = criteriaAt(0);
    const partner = criteriaAt(1);
    expect(own.assessmentPairKey).toMatch(UUID);
    expect(partner.assessmentPairKey).toBe(own.assessmentPairKey);
    // The item that comes first in the course is the pre.
    expect(own.assessmentPhase).toBe("PRE");
    expect(partner.assessmentPhase).toBe("POST");
    expect(own.showResultsToLearner).toBe(false);
    expect(partner.showResultsToLearner).toBe(true);
    expect(useAs().value).toBe("PRE");

    // Flip roles from this item: the partner follows.
    fireEvent.change(useAs(), { target: { value: "POST" } });
    expect(criteriaAt(0).assessmentPhase).toBe("POST");
    expect(criteriaAt(1).assessmentPhase).toBe("PRE");
    expect(criteriaAt(0).showResultsToLearner).toBe(true);
    expect(criteriaAt(1).showResultsToLearner).toBe(false);
  });

  it("only offers other assessments that are not already paired elsewhere", () => {
    render(
      <Harness
        criteria={{ assessmentMode: true, completionLogic: "SCORE" }}
        others={[
          { title: "Free assessment", criteria: { assessmentMode: true } },
          {
            title: "Taken assessment",
            criteria: { assessmentMode: true, assessmentPhase: "PRE", assessmentPairKey: "other" },
          },
          { title: "A practice one", criteria: { completionLogic: "SCORE" } },
        ]}
      />,
    );
    expect(Array.from(pairedWith().options).map(o => o.textContent)).toEqual([
      "None",
      "Free assessment (Section)",
    ]);
  });

  it("switching to Standalone clears phase and key on both items", () => {
    render(
      <Harness
        criteria={{
          assessmentMode: true,
          completionLogic: "SCORE",
          assessmentPhase: "PRE",
          assessmentPairKey: "k1",
        }}
        others={[
          {
            title: "Endline",
            criteria: {
              assessmentMode: true,
              completionLogic: "SCORE",
              assessmentPhase: "POST",
              assessmentPairKey: "k1",
            },
          },
        ]}
      />,
    );
    fireEvent.change(useAs(), { target: { value: "STANDALONE" } });
    for (const c of [criteriaAt(0), criteriaAt(1)]) {
      expect(c.assessmentPhase).toBeUndefined();
      expect(c.assessmentPairKey).toBeUndefined();
      expect(c.assessmentMode).toBe(true);
    }
  });

  it("leaving Assessment unpairs the partner too", () => {
    render(
      <Harness
        criteria={{
          assessmentMode: true,
          completionLogic: "SCORE",
          assessmentPhase: "PRE",
          assessmentPairKey: "k1",
        }}
        others={[
          {
            title: "Endline",
            criteria: {
              assessmentMode: true,
              completionLogic: "SCORE",
              assessmentPhase: "POST",
              assessmentPairKey: "k1",
            },
          },
        ]}
      />,
    );
    pickType("Practice");
    expect(criteriaAt(0).assessmentMode).toBeUndefined();
    expect(criteriaAt(1).assessmentPairKey).toBeUndefined();
    expect(criteriaAt(1).assessmentPhase).toBeUndefined();
  });

  it("warns softly about a pass mark on a pre-assessment", () => {
    render(
      <Harness
        criteria={{
          assessmentMode: true,
          completionLogic: "SCORE",
          minScore: 50,
          assessmentPhase: "PRE",
          assessmentPairKey: "k1",
        }}
      />,
    );
    expect(
      screen.getByText(
        "A pass mark on a pre-assessment pauses the course for learners who miss it.",
      ),
    ).toBeTruthy();
  });

  it("shows the comparability warning with both behaviour lists", () => {
    compatState.data = { comparable: false, onlyInPre: ["Empathy"], onlyInPost: ["Closing"] };
    render(
      <Harness
        criteria={{
          assessmentMode: true,
          completionLogic: "SCORE",
          assessmentPhase: "PRE",
          assessmentPairKey: "k1",
        }}
        others={[
          {
            title: "Endline",
            scenarioId: 9,
            criteria: {
              assessmentMode: true,
              completionLogic: "SCORE",
              assessmentPhase: "POST",
              assessmentPairKey: "k1",
            },
          },
        ]}
      />,
    );
    expect(
      screen.getByText(
        "These scenarios score different behaviours, so the pre→post gain may not be comparable.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Empathy/)).toBeTruthy();
    expect(screen.getByText(/Closing/)).toBeTruthy();
    expect(compatSpy).toHaveBeenLastCalledWith(
      { preScenarioId: 1, postScenarioId: 9 },
      { skip: false },
    );
    compatState.data = undefined;
  });
});

describe("duration helpers", () => {
  it("treats both blank as the platform default and one blank as 0", () => {
    expect(combineDuration(undefined, undefined)).toBeUndefined();
    expect(combineDuration(2, undefined)).toBe(120);
    expect(combineDuration(undefined, 45)).toBe(45);
    expect(combineDuration(0, 0)).toBe(0);
  });

  it("splits a total back out", () => {
    expect(splitDuration(undefined)).toEqual({ minutes: undefined, seconds: undefined });
    expect(splitDuration(90)).toEqual({ minutes: 1, seconds: 30 });
    expect(splitDuration(0)).toEqual({ minutes: 0, seconds: 0 });
  });
});
