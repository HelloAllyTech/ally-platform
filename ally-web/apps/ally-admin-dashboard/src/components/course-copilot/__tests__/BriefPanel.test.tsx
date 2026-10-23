import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CourseBrief } from "@types";

// @constants reads off the @components barrel at module-eval time (see the Builder
// tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

// eslint-disable-next-line import/first
import { BriefPanel } from "../BriefPanel";

const fullBrief = (): CourseBrief => ({
  seed: "I want volunteers to stop jumping to advice.",
  audience: {
    who: "Volunteer listeners in their first month",
    priorExperience: "None",
    applicationContext: "A text helpline",
    groupNote: "Cohort of 12",
  },
  outcomes: {
    terminal: "Respond to a distressed caller without giving advice",
    enabling: ["Reflect feelings back", "Ask open questions"],
  },
  competencyNames: ["Active listening", "Empathy"],
  behaviours: { helpful: ["Reflects feeling"], unhelpful: ["Jumps to solutions"] },
  assessment: { kind: "roleplay", note: "One capstone call", threshold: 70 },
  shape: {
    durationMinutes: 60,
    sections: 3,
    practiceWeight: "practice-heavy",
    components: ["article", "quiz", "annotated_artifact"],
    tone: "Warm, plain",
    readingLevel: "Grade 8",
    languageIds: ["1", "2"],
  },
  practice: [
    {
      slot: 1,
      source: "new",
      taskClass: "Cooperative caller, one issue",
      personaBrief: "A caller worried about exams",
      minScore: 60,
      saveCharacter: true,
    },
    { slot: 2, source: "library", scenarioId: 9, taskClass: "Ambivalent caller" },
  ],
  look: { cover: "generate", articleImages: "cover-only" },
  videoUrls: [{ title: "A real call", url: "https://youtu.be/abc", source: "youtube", durationSeconds: 180 }],
  notes: ["Avoid crisis-line jargon"],
});

describe("BriefPanel — empty and partial", () => {
  it("says the brief fills in as the trainer answers, and nothing else, when it is empty", () => {
    render(
      <BriefPanel brief={{}} readiness={{ ready: false, missing: ["audience", "outcomes", "shape"] }} />,
    );

    expect(screen.getByText("The brief fills in as you answer.")).toBeInTheDocument();
    // An early brief is mostly empty; a wall of "still needed" chips would only say so again.
    expect(screen.queryByText("Still needed:")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Audience" })).toBeNull();
  });

  it("treats a missing brief like an empty one", () => {
    render(<BriefPanel brief={null} readiness={null} />);
    expect(screen.getByText("The brief fills in as you answer.")).toBeInTheDocument();
  });

  it("renders only the sections that have something in them, with no placeholder rows", () => {
    render(
      <BriefPanel
        brief={{ audience: { who: "New volunteers" } }}
        readiness={{ ready: false, missing: ["outcomes", "shape"] }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Audience" })).toBeInTheDocument();
    expect(screen.getByText("New volunteers")).toBeInTheDocument();
    for (const heading of ["Outcomes", "Competencies", "Shape", "Practice ladder", "Look", "Videos", "Notes"]) {
      expect(screen.queryByRole("heading", { name: heading })).toBeNull();
    }
    expect(screen.queryByText("—")).toBeNull();
    // Prior experience was not given, so there is no row for it.
    expect(screen.queryByText("Prior experience")).toBeNull();
  });

  it("lists what is still needed as a compact list", () => {
    render(
      <BriefPanel
        brief={{ audience: { who: "New volunteers" } }}
        readiness={{ ready: false, missing: ["outcomes", "course length"] }}
      />,
    );

    const list = screen.getByRole("list", { name: "Still needed:" });
    expect(within(list).getAllByRole("listitem").map(entry => entry.textContent)).toEqual([
      "outcomes",
      "course length",
    ]);
    expect(screen.queryByText("Ready for a blueprint")).toBeNull();
  });

  it("says 'Ready for a blueprint' instead of a list once it is", () => {
    render(
      <BriefPanel brief={{ audience: { who: "New volunteers" } }} readiness={{ ready: true, missing: [] }} />,
    );

    expect(screen.getByText("Ready for a blueprint")).toBeInTheDocument();
    expect(screen.queryByText("Still needed:")).toBeNull();
  });
});

describe("BriefPanel — a full brief", () => {
  it("shows every section", () => {
    render(<BriefPanel brief={fullBrief()} readiness={{ ready: true, missing: [] }} />);

    // Where it started
    expect(screen.getByText("I want volunteers to stop jumping to advice.")).toBeInTheDocument();
    // Audience
    expect(screen.getByText("Volunteer listeners in their first month")).toBeInTheDocument();
    expect(screen.getByText("Cohort of 12")).toBeInTheDocument();
    // Outcomes, numbered the way blueprint objective tags refer to them
    expect(screen.getByText("Respond to a distressed caller without giving advice")).toBeInTheDocument();
    expect(screen.getByText("O1")).toBeInTheDocument();
    expect(screen.getByText("Ask open questions")).toBeInTheDocument();
    expect(screen.getByText("O2")).toBeInTheDocument();
    // Competencies, behaviours
    expect(screen.getByText("Active listening")).toBeInTheDocument();
    expect(screen.getByText("Reflects feeling")).toBeInTheDocument();
    expect(screen.getByText("Jumps to solutions")).toBeInTheDocument();
    // Assessment
    expect(screen.getByText("Capstone roleplay")).toBeInTheDocument();
    expect(screen.getByText("70 to pass")).toBeInTheDocument();
    // Shape
    expect(screen.getByText("1 h")).toBeInTheDocument();
    expect(screen.getByText("Practice-heavy")).toBeInTheDocument();
    expect(screen.getByText("Annotated transcripts")).toBeInTheDocument();
    expect(screen.getByText("Grade 8")).toBeInTheDocument();
    expect(screen.getByText("2 languages")).toBeInTheDocument();
    // Practice ladder
    expect(screen.getByText("Practice 1")).toBeInTheDocument();
    expect(screen.getByText("New roleplay")).toBeInTheDocument();
    expect(screen.getByText("From library")).toBeInTheDocument();
    expect(screen.getByText("Min score 60")).toBeInTheDocument();
    expect(screen.getByText("A caller worried about exams")).toBeInTheDocument();
    // Look, videos, notes
    expect(screen.getByText("Generate one")).toBeInTheDocument();
    expect(screen.getByText("Cover only")).toBeInTheDocument();
    expect(screen.getByText("A real call")).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    expect(screen.getByText("3m 0s")).toBeInTheDocument();
    expect(screen.getByText("Avoid crisis-line jargon")).toBeInTheDocument();
  });
});

describe("BriefPanel — agent-authored values that are not what the type says", () => {
  it("does not crash on strings where arrays belong, or objects where text belongs", () => {
    const mangled = {
      seed: { text: "From an object" },
      outcomes: { terminal: ["Two", "lines"], enabling: "not a list" },
      competencyNames: "Empathy",
      behaviours: { helpful: "Reflects", unhelpful: { id: 1, text: "Advises" } },
      shape: { components: 7, languageIds: "en", durationMinutes: "an hour" },
      practice: { slot: 1 },
      videoUrls: "https://youtu.be/abc",
      notes: "one note",
    } as never;

    render(<BriefPanel brief={mangled} readiness={{ ready: false, missing: "audience" as never }} />);

    expect(screen.getByText("From an object")).toBeInTheDocument();
    expect(screen.getByText(/Two\s*Lines|Two\nlines/i)).toBeInTheDocument();
    expect(screen.getByText("Empathy")).toBeInTheDocument();
    // The one-element "lists" read as one entry each.
    expect(screen.getByText("one note")).toBeInTheDocument();
    // A mistyped duration is ignored rather than rendered as "NaN min".
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
