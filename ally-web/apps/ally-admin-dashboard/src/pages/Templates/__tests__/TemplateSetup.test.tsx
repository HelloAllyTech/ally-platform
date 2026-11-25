import "@constants";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TemplateCatalogue, TemplateInstallResult } from "@types";

import { TemplateResult, TemplateSetup } from "../TemplateSetup";

const card = (id: string, group: "organisations" | "businesses", extra = {}) => ({
  id,
  group,
  name: `Name ${id}`,
  one_liner: `Line ${id}`,
  for: "Anyone",
  icon: group === "organisations" ? id : "🩺",
  purpose: "answer",
  pack: null,
  hand_over: true,
  memory: false,
  lists: [{ key: "callback_requests", name: "Callback requests", optional: false, has: false }],
  setup: [
    { key: "helpline", ask: "What’s your helpline number?", kind: "phone" as const },
    { key: "benefits", ask: "Benefits?", kind: "yes_no" as const },
    {
      key: "languages",
      ask: "Which languages?",
      kind: "choices" as const,
      choices: ["English", "Hindi"],
    },
  ],
  checkups: 7,
  suggested: false,
  ...extra,
});

const CATALOGUE: TemplateCatalogue = {
  suggested: "clinic",
  groups: [
    {
      id: "organisations",
      name: "For organisations",
      templates: [card("helpline", "organisations")],
    },
    {
      id: "businesses",
      name: "For businesses",
      templates: [card("clinic", "businesses", { suggested: true, pack: "Medical safety" })],
    },
  ],
};

describe("TemplateSetup", () => {
  it("shows For organisations, then For businesses, with the suggested badge", () => {
    render(<TemplateSetup catalogue={CATALOGUE} onSubmit={vi.fn()} />);
    const groups = screen.getAllByRole("region");
    expect(groups.map(g => g.getAttribute("aria-label"))).toEqual([
      "For organisations",
      "For businesses",
    ]);
    const clinic = screen.getByTestId("template-card-clinic");
    expect(within(clinic).getByText("Suggested for you")).toBeTruthy();
    expect(within(clinic).getByText("Safety: Medical safety")).toBeTruthy();
    expect(within(clinic).getByText("Sets up: Callback requests")).toBeTruthy();
    expect(within(clinic).getByText("Asks you 3 questions")).toBeTruthy();
  });

  it("draws a motif for a business template it knows, and falls back to the emoji otherwise", () => {
    const catalogue: TemplateCatalogue = {
      ...CATALOGUE,
      groups: [
        CATALOGUE.groups[0],
        {
          id: "businesses",
          name: "For businesses",
          templates: [card("clinic", "businesses"), card("brand_new", "businesses")],
        },
      ],
    };
    render(<TemplateSetup catalogue={catalogue} onSubmit={vi.fn()} />);
    const clinic = screen.getByTestId("template-card-clinic");
    expect(clinic.querySelector("svg.ally-templates__motif")).toBeTruthy();
    expect(within(clinic).queryByText("🩺")).toBeNull();
    const unknown = screen.getByTestId("template-card-brand_new");
    expect(unknown.querySelector("svg")).toBeNull();
    expect(within(unknown).getByText("🩺")).toBeTruthy();
  });

  it("asks the setup questions, each skippable, and sends only what was answered", () => {
    const onSubmit = vi.fn();
    render(<TemplateSetup catalogue={CATALOGUE} askName onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("template-card-helpline"));
    expect(screen.getByText("A few questions to make it yours")).toBeTruthy();
    expect(screen.getAllByText("We'll add examples you can replace later.")).toHaveLength(3);

    fireEvent.change(screen.getByRole("textbox", { name: "What's it called?" }), {
      target: { value: "Hope Line" },
    });
    // TF1 round 2, S-1: the helpline is a phone field of its own.
    const phone = screen.getByRole("textbox", { name: "What’s your helpline number?" });
    expect(phone.getAttribute("type")).toBe("tel");
    fireEvent.change(phone, { target: { value: "1800-123-4567" } });
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Hindi" }));
    fireEvent.click(screen.getByTestId("template-set-up"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "helpline" }),
      { helpline: "1800-123-4567", benefits: true, languages: ["Hindi"] },
      "Hope Line",
    );
  });

  it("says when the templates didn't load, with Try again", () => {
    const onRetry = vi.fn();
    render(<TemplateSetup catalogue={undefined} failed onRetry={onRetry} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("TemplateResult", () => {
  const result = (pack: TemplateInstallResult["pack"]): TemplateInstallResult => ({
    template: { id: "clinic", name: "Clinic or doctor" },
    added: ["Slots", "Appointments"],
    skipped: ["Callback requests"],
    pack,
    checkups: 7,
    examples: 0,
    channels: null,
  });

  it("names what was added, what was kept, and the checkup", () => {
    render(
      <TemplateResult
        result={result({ outcome: "none" })}
        onDone={vi.fn()}
        onRunCheckup={vi.fn()}
      />,
    );
    expect(screen.getByText("Added: Slots, Appointments.")).toBeTruthy();
    expect(
      screen.getByText("You already have Callback requests, so we left it as it is."),
    ).toBeTruthy();
    expect(screen.getByText("7 checkup questions added.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run the checkup" })).toBeTruthy();
  });

  it("tells the owner when a stricter pack was kept", () => {
    render(
      <TemplateResult
        result={result({ outcome: "kept", pack: "Mental health safety", asked: "Medical safety" })}
        onDone={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Your assistant already uses Mental health safety, which is stricter. We kept it.",
      ),
    ).toBeTruthy();
  });
});
