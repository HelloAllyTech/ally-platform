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

let latest: TrackFormValues | null = null;

const Harness = ({ criteria }: { criteria: CompletionCriteria }) => {
  const methods = useForm<TrackFormValues>({
    defaultValues: {
      sections: [
        {
          localId: "s1",
          title: "Section",
          description: "",
          items: [
            {
              localId: "i1",
              type: TrackItemType.ROLEPLAY,
              title: "Try out a roleplay",
              description: "",
              scenarioId: 1,
              completionCriteria: criteria,
            },
          ],
        },
      ],
    } as unknown as TrackFormValues,
  });
  latest = methods.watch() as TrackFormValues;
  return (
    <FormProvider {...methods}>
      <CompletionRuleFields sectionIndex={0} itemIndex={0} type={TrackItemType.ROLEPLAY} />
    </FormProvider>
  );
};

const criteria = () => latest!.sections[0].items[0].completionCriteria!;
const select = () => screen.getByLabelText("Completion requirement") as HTMLSelectElement;
const choose = (value: string) => fireEvent.change(select(), { target: { value } });
const minutes = () =>
  screen.queryByLabelText("Minimum duration minutes") as HTMLInputElement | null;
const seconds = () =>
  screen.queryByLabelText("Minimum duration seconds") as HTMLInputElement | null;
const score = () =>
  screen.queryByLabelText("Minimum score (0 or above, optional)") as HTMLInputElement | null;

describe("CompletionRuleFields — roleplay completion requirement", () => {
  it("offers exactly the four completion options", () => {
    render(<Harness criteria={{ completionLogic: "SCORE_AND_DURATION" }} />);
    expect(Array.from(select().options).map(option => option.textContent)).toEqual([
      "Minimum score",
      "Minimum duration",
      "Minimum score AND duration",
      "Participation only",
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

    choose("PARTICIPATION");
    expect(score()).toBeNull();
    expect(minutes()).toBeNull();
    expect(seconds()).toBeNull();
    expect(criteria().completionLogic).toBe("PARTICIPATION");
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
        assessmentMode: true,
      }),
    ).toEqual({ completionLogic: "PARTICIPATION", assessmentMode: true });
    expect(
      serializeTrackItemForTest({
        completionLogic: "SCORE_AND_DURATION",
        minScore: 60,
        minDurationSeconds: 90,
      }),
    ).toEqual({ completionLogic: "SCORE_AND_DURATION", minScore: 60, minDurationSeconds: 90 });
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
