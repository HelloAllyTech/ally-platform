import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useForm, FormProvider } from "react-hook-form";
import { CompletionRuleFields } from "../CompletionRuleFields";
import { TrackItemType, TrackItemCompletionLogic } from "@types";

vi.mock("@constants", () => ({
  DEFAULT_VIDEO_WATCH_PCT: 90,
  MAX_VIDEO_WATCH_PCT: 100,
  MIN_VIDEO_WATCH_PCT: 1,
}));

vi.mock("@components", () => ({
  ToggleSwitch: ({ enabled, onChange, label, id }: any) => (
    <label htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={enabled}
        onChange={e => onChange(e.target.checked)}
        aria-label={label}
      />
      {label}
    </label>
  ),
  cellTypes: {
    normalText: "normalText",
  },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@assets", () => ({
  TooltipIcon: () => <div data-testid="tooltip-icon" />,
}));

const Wrapper = ({ children, defaultValues }: any) => {
  const methods = useForm({ defaultValues });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

describe("CompletionRuleFields", () => {
  it("renders all four completion logic options for ROLEPLAY", () => {
    render(
      <Wrapper defaultValues={{ sections: [{ items: [{ completionCriteria: {} }] }] }}>
        <CompletionRuleFields sectionIndex={0} itemIndex={0} type={TrackItemType.ROLEPLAY} />
      </Wrapper>,
    );

    const select = screen.getByLabelText(/Completion logic/);
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options.map(o => o.textContent?.trim())).toEqual([
      "Minimum score",
      "Minimum duration",
      "Minimum score AND duration",
      "Participation only",
    ]);
  });

  it("shows/hides inputs based on selected logic", async () => {
    render(
      <Wrapper
        defaultValues={{
          sections: [
            {
              items: [
                {
                  completionCriteria: {
                    completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
                  },
                },
              ],
            },
          ],
        }}
      >
        <CompletionRuleFields sectionIndex={0} itemIndex={0} type={TrackItemType.ROLEPLAY} />
      </Wrapper>,
    );

    expect(screen.getByLabelText(/Minimum score/)).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum duration")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Completion logic/), {
      target: { value: TrackItemCompletionLogic.PARTICIPATION },
    });

    expect(screen.queryByLabelText(/Minimum score/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Minimum duration")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Learners complete this item just by launching it/),
    ).toBeInTheDocument();
  });

  it("handles duration input correctly", () => {
    render(
      <Wrapper
        defaultValues={{
          sections: [
            {
              items: [
                {
                  completionCriteria: {
                    completionLogic: TrackItemCompletionLogic.DURATION,
                    minDurationSeconds: 65,
                  },
                },
              ],
            },
          ],
        }}
      >
        <CompletionRuleFields sectionIndex={0} itemIndex={0} type={TrackItemType.ROLEPLAY} />
      </Wrapper>,
    );

    const minutesInput = screen.getByPlaceholderText("Min") as HTMLInputElement;
    const secondsInput = screen.getByPlaceholderText("Sec") as HTMLInputElement;

    expect(minutesInput.value).toBe("1");
    expect(secondsInput.value).toBe("5");

    fireEvent.change(minutesInput, { target: { value: "2" } });
    // minDurationSeconds should now be 125 (2*60 + 5)
  });
});
