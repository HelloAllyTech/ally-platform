import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enhance: vi.fn(), plan: vi.fn() }));
// Neither barrel is loaded for real: both reach `@store` at module load.
vi.mock("@api", () => ({
  useEnhanceFieldMutation: () => [mocks.enhance],
  useGetAvailableLanguageVoicesQuery: () => ({ data: [] }),
  useRevisePlanMutation: () => [mocks.plan],
}));
vi.mock("@constants", () => ({
  en: {
    agentBuilderRevision: {
      characterDetails: "Character details",
      settings: "Settings",
      noSettingChanged: "no setting needed changing",
    },
  },
}));

// eslint-disable-next-line import/first
import { useAgentBuilderRevision } from "../useAgentBuilderRevision";

const formWith = (values: Record<string, unknown>) =>
  ({
    getValues: (key: string) => values[key],
    setValue: vi.fn((key: string, value: unknown) => {
      values[key] = value;
    }),
  }) as any;

const answer = (content: string) => ({ unwrap: () => Promise.resolve({ content }) });

describe("a settings change from the chat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changes the settings asked for and says which, from what to what", async () => {
    const values = {
      prompt: "Be Arjun.",
      difficultyLevel: "MEDIUM",
      showScoreMeter: true,
      timerMode: true,
      maxTimeValue: "00:10:00",
    };
    const form = formWith(values);
    mocks.plan.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          fields: [{ id: "settings", change: "hard, no meter, 15 min" }],
          reply: "",
        }),
    });
    mocks.enhance.mockReturnValue(
      answer(
        '{"difficultyLevel":"HARD","showScoreMeter":false,"timerMode":true,"maxTimeValue":"00:15:00","temperature":1}',
      ),
    );
    const { result } = renderHook(() => useAgentBuilderRevision(form));
    await act(async () => {
      await result.current.revise("Make it hard, hide the score meter and give a 15 minute limit");
    });

    expect(values).toMatchObject({
      difficultyLevel: "HARD",
      showScoreMeter: false,
      maxTimeValue: "00:15:00",
    });
    // Only settings it was offered: the model's stray `temperature` is not written.
    expect(form.setValue.mock.calls.map(([key]: string[]) => key)).toEqual([
      "difficultyLevel",
      "showScoreMeter",
      "maxTimeValue",
    ]);
    const row = result.current.revisions[0].rows[0];
    expect(row).toMatchObject({ id: "settings", status: "done" });
    expect(row.detail).toContain("Show the score meter during the session: on → off");
    expect(row.detail).toContain("Session time limit: 00:10:00 → 00:15:00");
  });

  it("says so when nothing needed changing", async () => {
    const form = formWith({ prompt: "Be Arjun.", showScoreMeter: true });
    mocks.plan.mockReturnValue({
      unwrap: () => Promise.resolve({ fields: [{ id: "settings", change: "x" }], reply: "" }),
    });
    mocks.enhance.mockReturnValue(answer('{"showScoreMeter":true}'));
    const { result } = renderHook(() => useAgentBuilderRevision(form));
    await act(async () => {
      await result.current.revise("keep the score meter");
    });
    expect(result.current.revisions[0].rows[0].detail).toBe("no setting needed changing");
    expect(form.setValue).not.toHaveBeenCalled();
  });
});
