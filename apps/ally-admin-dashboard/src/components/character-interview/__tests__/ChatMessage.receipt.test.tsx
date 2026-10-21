import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatMessage } from "../ChatMessage";

const receipt = (overrides: Record<string, unknown> = {}) => ({
  read: [],
  searched: [],
  changed: [],
  failed: [],
  warnings: [],
  ...overrides,
});

const row = (extra: Record<string, unknown>) => ({
  id: "a1",
  role: "assistant" as const,
  content: "What is her name?",
  ...extra,
});

describe("character interview ChatMessage — receipt", () => {
  it("draws what the turn did under the reply", () => {
    render(
      <ChatMessage
        message={row({ receipt: receipt({ changed: ["Character draft saved: Asha"] }) })}
        onAnswerQuestion={vi.fn()}
      />,
    );
    expect(screen.getByRole("group", { name: "What this turn did" })).toHaveTextContent("1 change");
  });

  it("draws nothing for a turn that only asked the next question", () => {
    render(<ChatMessage message={row({ receipt: receipt() })} onAnswerQuestion={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "What this turn did" })).toBeNull();
    expect(screen.getByText("What is her name?")).toBeInTheDocument();
  });

  it("still shows a failed lookup on a quiet turn", () => {
    render(
      <ChatMessage
        message={row({
          receipt: receipt({
            failed: ['Corpus search "burnout" — the reference corpus could not be reached'],
          }),
        })}
        onAnswerQuestion={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Corpus search "burnout" — the reference corpus could not be reached'),
    ).toBeInTheDocument();
  });
});
