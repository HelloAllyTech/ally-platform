import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { COPY } from "../copy";
import type { BotDraftView } from "../types";
import { withFinding } from "../findings";
import {
  BuildingScreen,
  DesignScreen,
  LearnedScreen,
  LiveScreen,
  SafetyScreen,
  ShareScreen,
} from "../Screens";
import { defaultsConfirmation } from "../purposes";
import { reached } from "../steps";

/**
 * The onboarding screens (chunk 20d). Ported from Canvas.test.tsx (chunk 20a-1) when the canvas
 * cards became one screen each: every case asserts the same behaviour against the new screens.
 */
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,x" } }));

const view = (over: Partial<BotDraftView> = {}): BotDraftView =>
  ({
    id: "d1",
    status: "active",
    step: "learned",
    version: 3,
    chatbotId: "b1",
    source: { website: "https://sunrise.example/", description: null },
    crawl: {
      status: "done",
      domain: "sunrise.example",
      startedAt: null,
      finishedAt: null,
      pagesRead: 4,
      pages: [],
      findings: [],
      brand: null,
      problem: null,
    },
    learned: {
      facts: [
        {
          id: "f1",
          section: "hours",
          text: "Open 9 to 5.",
          sourceUrl: "https://sunrise.example/contact",
          sourceTitle: "Contact",
        },
        { id: "f2", section: "team", text: "Dr Rao.", sourceUrl: "owner", byOwner: true },
      ],
      dropped: 0,
    },
    industry: "mental_health",
    safety: {
      id: "mental_health",
      name: "Mental health safety",
      industryLabel: "mental health practices",
      always: ["Shares crisis contacts straight away if someone may be at risk."],
      never: ["Diagnoses."],
      atRisk: ["Your team is alerted."],
      on: true,
    },
    conversation: { pending: "", gaps: null, questionsLeft: null },
    designs: null,
    draft: {
      name: "Sunrise Mind",
      assistantName: "Sunrise assistant",
      introduction: "",
      instructions: "",
      tone: "warm",
      languages: ["en"],
      topics: [],
      suggestedQuestions: [],
      prechat: [],
      declineText: "",
      safetyPackId: "mental_health",
      extraNever: [],
      branding: {
        logoUrl: null,
        accentColour: "#264D8E",
        title: "Sunrise Mind",
        disclaimer: "",
        assistantName: "Sunrise assistant",
      },
      access: { mode: "invite", emails: [] },
      design: null,
    },
    transcript: [],
    changes: [],
    ...over,
  }) as BotDraftView;

describe("What we learned", () => {
  it("lists details by section, sourced, with the deck's empty line for the rest", () => {
    render(<LearnedScreen view={view()} busy={false} onPatch={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText("Open 9 to 5.")).toBeTruthy();
    expect(screen.getByText("Contact")).toBeTruthy();
    expect(screen.getByText(COPY.learned.fromYou)).toBeTruthy();
    // Six sections have nothing.
    expect(screen.getAllByText(COPY.learned.empty)).toHaveLength(6);
    // A page source links out; the owner's own detail has nowhere to link.
    expect(screen.getAllByText(COPY.learned.viewSource)).toHaveLength(1);
  });

  it("turns an edit and a removal into patches", async () => {
    const onPatch = vi.fn().mockResolvedValue(true);
    render(<LearnedScreen view={view()} busy={false} onPatch={onPatch} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getAllByText(COPY.learned.remove)[0]);
    expect(onPatch).toHaveBeenCalledWith("learned", [{ op: "remove", path: "/facts/0" }]);
  });

  it("offers Looks right only on its own step", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <LearnedScreen view={view()} busy={false} onPatch={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByText(COPY.learned.confirm));
    expect(onConfirm).toHaveBeenCalled();
    rerender(
      <LearnedScreen
        view={view({ step: "gaps" })}
        busy={false}
        onPatch={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByText(COPY.learned.confirm)).toBeNull();
  });
});

describe("What we learned, when the website gave nothing (chunk 20a-2)", () => {
  afterEach(() => vi.useRealTimers());
  const N = COPY.learned.nothing;
  const empty = (problem: string | null = "little_found", transcript: unknown[] = []) =>
    view({
      learned: { facts: [], dropped: 0 },
      crawl: { ...view().crawl, problem },
      transcript: transcript as BotDraftView["transcript"],
    });
  const actions = () => ({
    onDescribe: vi.fn().mockResolvedValue(true),
    onUpload: vi.fn().mockResolvedValue(true),
    onStartOver: vi.fn(),
  });
  /** Options tick, then fire after AUTO_ADVANCE_MS. */
  const pick = (label: string) => {
    fireEvent.click(screen.getByText(label));
    act(() => void vi.advanceTimersByTime(500));
  };

  it("says why and offers ways on, instead of eight empty sections and Looks right", () => {
    render(
      <LearnedScreen
        view={empty("blocked")}
        busy={false}
        onPatch={vi.fn()}
        onConfirm={vi.fn()}
        {...actions()}
      />,
    );
    expect(screen.getByText("We couldn't find much on sunrise.example")).toBeTruthy();
    expect(screen.getByText(N.why.blocked)).toBeTruthy();
    for (const label of [N.describe, N.upload, N.otherSite, N.skip]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText(COPY.learned.empty)).toBeNull();
    expect(screen.queryByText(COPY.learned.confirm)).toBeNull();
  });

  it("reads a description, then says so if it still had no details", async () => {
    vi.useFakeTimers();
    const a = actions();
    const { rerender } = render(
      <LearnedScreen view={empty()} busy={false} onPatch={vi.fn()} onConfirm={vi.fn()} {...a} />,
    );
    pick(N.describe);
    fireEvent.change(screen.getByLabelText(N.describe), {
      target: { value: "We run a diagnostic lab in Mumbai with home sample collection." },
    });
    await act(async () => {
      fireEvent.click(screen.getByText(N.read));
    });
    expect(a.onDescribe).toHaveBeenCalledWith(
      "We run a diagnostic lab in Mumbai with home sample collection.",
    );
    expect(screen.getByText(N.reading)).toBeTruthy();
    // The builder replied, and there are still no details.
    rerender(
      <LearnedScreen
        view={empty("little_found", [{ role: "builder", text: "Done" }])}
        busy={false}
        onPatch={vi.fn()}
        onConfirm={vi.fn()}
        {...a}
      />,
    );
    expect(screen.getByText(N.stillNothing)).toBeTruthy();
  });

  it("starts again with another website, or skips on to the questions", () => {
    vi.useFakeTimers();
    const a = actions();
    const onConfirm = vi.fn();
    render(
      <LearnedScreen view={empty()} busy={false} onPatch={vi.fn()} onConfirm={onConfirm} {...a} />,
    );
    pick(N.otherSite);
    expect(a.onStartOver).toHaveBeenCalled();
    pick(N.skip);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("offers no other website to a setup that didn't start from one", () => {
    render(
      <LearnedScreen
        view={{ ...empty(), source: { website: null, description: "x" } }}
        busy={false}
        onPatch={vi.fn()}
        onConfirm={vi.fn()}
        {...actions()}
      />,
    );
    expect(screen.getByText(N.titleNoSite)).toBeTruthy();
    expect(screen.queryByText(N.otherSite)).toBeNull();
  });
});

describe("Safety", () => {
  it("names the pack and opens what it covers", () => {
    render(<SafetyScreen view={view()} />);
    expect(screen.getByText("Mental health safety is on")).toBeTruthy();
    expect(screen.queryByText("Diagnoses.")).toBeNull();
    fireEvent.click(screen.getByText(COPY.safety.link));
    expect(screen.getByText(COPY.safety.always)).toBeTruthy();
    expect(screen.getByText("Diagnoses.")).toBeTruthy();
    expect(screen.getByText(COPY.safety.atRisk)).toBeTruthy();
  });
});

describe("Designs", () => {
  const designs = [
    {
      id: "guide",
      title: "Client guide",
      best_for: "Everyday questions",
      will: ["Answer questions from your information"],
      wont: ["Book, take orders or take payments"],
      sample: [{ from: "visitor", text: "Hours?" }],
    },
    {
      id: "coming_soon",
      title: "Booking and payments",
      best_for: COPY.designs.comingSoonBody,
      will: [],
      wont: [],
      sample: [],
      coming_soon: true,
    },
  ];

  it("chooses a real design; booking is only ever coming soon", () => {
    const onChoose = vi.fn();
    render(<DesignScreen designs={designs} chosen={null} canChoose onChoose={onChoose} />);
    expect(screen.getByText(COPY.designs.comingSoonBadge)).toBeTruthy();
    const buttons = screen.getAllByText(COPY.designs.choose);
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onChoose).toHaveBeenCalledWith("guide");
  });
});

describe("What should your assistant do?", () => {
  const purposes = [
    {
      id: "enquiries",
      title: "Bring in customers",
      best_for: "New clients",
      will: ["Recommend the service that fits"],
      wont: ["Book, take orders or take payments"],
      sample: [],
      recommended: true,
      limit: "It can't book or take payments yet. It sends you each new enquiry by email.",
    },
    {
      id: "answer",
      title: "Answer questions",
      best_for: "Questions",
      will: [],
      wont: [],
      sample: [],
    },
    { id: "custom", title: "Something else", best_for: "x", will: [], wont: [], sample: [] },
  ];

  it("shows the recommended purpose first, badged, with its honest limit", () => {
    const onChoose = vi.fn();
    render(<DesignScreen designs={purposes} chosen={null} canChoose onChoose={onChoose} />);
    expect(screen.getByRole("heading", { name: COPY.purposes.title })).toBeTruthy();
    expect(screen.getAllByText(COPY.purposes.recommended)).toHaveLength(1);
    expect(screen.getByText(purposes[0].limit!)).toBeTruthy();
    const buttons = screen.getAllByText(COPY.designs.choose);
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]);
    expect(onChoose).toHaveBeenCalledWith("enquiries");
  });

  it("asks for a sentence once Something else is chosen", () => {
    const onDescribe = vi.fn();
    render(
      <DesignScreen
        designs={purposes}
        chosen="custom"
        canChoose
        onChoose={vi.fn()}
        onDescribe={onDescribe}
      />,
    );
    const box = screen.getByLabelText(COPY.purposes.customPrompt);
    fireEvent.change(box, { target: { value: " Help parents choose a class " } });
    fireEvent.click(screen.getByText(COPY.gaps.ok));
    expect(onDescribe).toHaveBeenCalledWith("Help parents choose a class");
  });

  it("confirms the defaults the purpose set, once built", () => {
    const built = view({
      designs: purposes,
      draft: {
        ...view().draft,
        purpose: "enquiries",
        prechat: [
          { id: "q1", label: "Name", type: "text", required: true },
          { id: "q2", label: "Phone", type: "phone", required: true },
        ],
        access: { mode: "invite", emails: [] },
      },
    } as Partial<BotDraftView>);
    const line = defaultsConfirmation(built)!;
    expect(line).toBe(
      "I've set it up for Bring in customers: Pre-chat: name, phone · Access: anyone you choose. You can change any of this on the next screen.",
    );
    render(<BuildingScreen done confirmation={line} />);
    expect(screen.getByText(line)).toBeTruthy();

    const team = view({
      designs: [{ ...purposes[1], id: "training", title: "Train my team" }],
      draft: {
        ...view().draft,
        purpose: "training",
        prechat: [],
        access: { mode: "organisation", emails: [] },
      },
    } as Partial<BotDraftView>);
    expect(defaultsConfirmation(team)).toContain(
      "Pre-chat: nothing before the chat · Access: people in your organisation",
    );
    expect(defaultsConfirmation(view())).toBeNull();
  });
});

describe("Building", () => {
  it("ticks every step once it's done", () => {
    render(<BuildingScreen done />);
    expect(screen.getAllByText("✓")).toHaveLength(COPY.building.steps.length);
  });
});

describe("Share", () => {
  it("asks before going live when an owner's Must pass question failed (chunk 20d-2)", () => {
    const onConfirm = vi.fn();
    render(
      <ShareScreen
        view={view({ step: "share" })}
        publicAllowed={false}
        publishing={false}
        onPublish={vi.fn()}
        mustPass={{
          message: "This question you marked Must pass failed. Go live anyway?",
          questions: ["Do you see couples?"],
          onConfirm,
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Do you see couples?");
    fireEvent.click(screen.getByText(COPY.share.goLiveAnyway));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("keeps public off with the deck's note while the platform has it off", () => {
    const onPublish = vi.fn();
    render(
      <ShareScreen
        view={view({ step: "share" })}
        publicAllowed={false}
        publishing={false}
        onPublish={onPublish}
      />,
    );
    expect(screen.getByText(COPY.share.publicDisabled)).toBeTruthy();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0].disabled).toBe(true);
    // Invite needs at least one email.
    expect((screen.getByText(COPY.share.publish) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(COPY.share.emailsPlaceholder), {
      target: { value: "Asha@Example.com,\nravi@example.com" },
    });
    fireEvent.click(screen.getByText(COPY.share.publish));
    expect(onPublish).toHaveBeenCalledWith("invite", ["asha@example.com", "ravi@example.com"]);
  });

  it("shows the live link with its ways to share", () => {
    render(
      <LiveScreen
        view={view({ step: "published" })}
        published={{
          chatbotId: "b1",
          slug: "sunrise",
          link: "https://ally.example/b/sunrise",
          access: "invite",
        }}
        onConnectWhatsApp={vi.fn()}
      />,
    );
    expect(screen.getByText(COPY.share.liveTitle)).toBeTruthy();
    for (const label of [
      COPY.share.copyLink,
      COPY.share.downloadQr,
      COPY.share.shareWhatsApp,
      COPY.share.openPage,
      COPY.share.nextButton,
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});

describe("helpers", () => {
  it("knows which steps a draft has reached", () => {
    expect(reached("gaps", "learned")).toBe(true);
    expect(reached("learned", "share")).toBe(false);
  });

  it("replaces a finding's count rather than piling up lines", () => {
    let lines = withFinding([], "Found 3 team members");
    lines = withFinding(lines, "Found your opening hours");
    lines = withFinding(lines, "Found 8 team members");
    expect(lines).toEqual(["Found 8 team members", "Found your opening hours"]);
  });
});
