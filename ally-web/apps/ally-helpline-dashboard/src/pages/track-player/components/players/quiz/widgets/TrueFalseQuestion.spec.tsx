import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrueFalseQuestion } from "./TrueFalseQuestion";

// Echo the key, suffixed with the `lng` override when one is passed, so a
// test can tell "resolved in the app language" from "resolved in the
// course language" without loading real locale bundles.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { lng?: string }) => (options?.lng ? `${key}@${options.lng}` : key),
  }),
}));

describe("TrueFalseQuestion", () => {
  it("labels the answers in the course language when one is given", () => {
    render(<TrueFalseQuestion state={{}} onChange={vi.fn()} languageCode="mr" />);

    expect(
      screen.getByRole("radio", { name: "tracks2.quiz.question.true@mr" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "tracks2.quiz.question.false@mr" }),
    ).toBeInTheDocument();
  });

  it("falls back to the app language when no course language is known", () => {
    render(<TrueFalseQuestion state={{}} onChange={vi.fn()} languageCode={null} />);

    expect(screen.getByRole("radio", { name: "tracks2.quiz.question.true" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "tracks2.quiz.question.false" })).toBeInTheDocument();
  });
});
