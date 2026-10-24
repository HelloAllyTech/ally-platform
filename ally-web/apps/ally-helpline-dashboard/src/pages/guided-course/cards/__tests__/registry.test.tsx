import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrackItemType } from "@types";

import { GUIDE_CARD_KIND_VALUES, GUIDE_ITEM_TYPE_VALUES } from "../../contract/wire";
import { CardFrame } from "../CardFrame";
import { CARD_KIND_RENDERER, ITEM_CARD_REGISTRY, itemCardFor } from "../registry";

describe("card registry", () => {
  it("covers every Track 2.0 item type, and the contract mirrors them exactly", () => {
    const classic = Object.values(TrackItemType).sort();
    expect([...GUIDE_ITEM_TYPE_VALUES].sort()).toEqual(classic);
    for (const type of classic) {
      const entry = ITEM_CARD_REGISTRY[type as keyof typeof ITEM_CARD_REGISTRY];
      expect(entry, type).toBeDefined();
      expect(entry.Adapter, type).toBeDefined();
      expect(entry.typeWordKey.startsWith("tracks2.meta."), type).toBe(true);
    }
  });

  it("fixes each type's presentation (decision 13)", () => {
    const by = (presentation: string) =>
      Object.entries(ITEM_CARD_REGISTRY)
        .filter(([, entry]) => entry.presentation === presentation)
        .map(([type]) => type)
        .sort();
    expect(by("inline")).toEqual(["BRANCHING_SCENARIO", "JOURNAL", "QUIZ"]);
    expect(by("shelf")).toEqual(["ARTICLE", "BUCKET_SORT", "VIDEO"]);
    expect(by("theatre")).toEqual(["ANNOTATED_ARTIFACT", "CASE", "GAME", "ROLEPLAY"]);
    expect(ITEM_CARD_REGISTRY.BUCKET_SORT.shelfWidth).toBe("utility");
    expect(ITEM_CARD_REGISTRY.ARTICLE.shelfWidth).toBe("reading");
  });

  it("marks roleplay and case as the chapter's high-stakes practice", () => {
    expect(ITEM_CARD_REGISTRY.ROLEPLAY).toMatchObject({ boss: true, tension: "high" });
    expect(ITEM_CARD_REGISTRY.CASE).toMatchObject({ boss: true, tension: "high" });
    expect(ITEM_CARD_REGISTRY.ARTICLE.boss).toBe(false);
  });

  it("has a renderer for every card kind, with the crisis card pinned out of the flow", () => {
    for (const kind of GUIDE_CARD_KIND_VALUES) {
      expect(CARD_KIND_RENDERER[kind], kind).toBeDefined();
    }
    expect(CARD_KIND_RENDERER.crisis_resources.pinned).toBe(true);
    expect(CARD_KIND_RENDERER.course_item.renderer).toBe("item");
  });

  it("returns null for an unknown type instead of throwing", () => {
    expect(itemCardFor("HOLOGRAM")).toBeNull();
    expect(itemCardFor(undefined)).toBeNull();
  });
});

describe("CardFrame lifecycle", () => {
  const base = {
    surface: "course" as const,
    glyph: "page" as const,
    typeWord: "Article",
    meta: "4 min",
    title: "Opening a call",
    framing: "The first ninety seconds decide whether a caller stays.",
  };

  it("announced: a skeleton with the real type row and no button", () => {
    render(<CardFrame {...base} state="announced" primary={{ label: "Read", onClick: vi.fn() }} />);
    const card = screen.getByRole("article");
    expect(card).toHaveAttribute("aria-busy", "true");
    expect(card).toHaveTextContent("Article");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Opening a call")).not.toBeInTheDocument();
  });

  it("ready: glyph and type word, a state word, one verb, where it opens", () => {
    const onClick = vi.fn();
    render(
      <CardFrame
        {...base}
        state="ready"
        primary={{ label: "Read", onClick, hint: "Opens on the right" }}
      />,
    );
    expect(screen.getByRole("article", { name: "Opening a call" })).toBeInTheDocument();
    expect(screen.getByTestId("card-state-word")).toHaveTextContent("Ready");
    expect(screen.getByText("Opens on the right")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Read/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("active: shows the player and a mini-status", () => {
    render(
      <CardFrame {...base} state="active" stateLabel="Open on the right">
        <div data-testid="player" />
      </CardFrame>,
    );
    expect(screen.getByTestId("player")).toBeInTheDocument();
    expect(screen.getByTestId("card-state-word")).toHaveTextContent("Open on the right");
  });

  it("done: collapses to a receipt with a check, never colour alone, and offers Open again", () => {
    const reopen = vi.fn();
    render(
      <CardFrame
        {...base}
        state="done"
        receipt="Read · Stayed with silence"
        secondary={{ label: "Open again", onClick: reopen }}
      />,
    );
    expect(screen.getByText("Read · Stayed with silence")).toBeInTheDocument();
    expect(screen.queryByText(base.framing)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open again" }));
    expect(reopen).toHaveBeenCalled();
  });

  it("failed: says what happened, offers Try again and the classic view, never a code", () => {
    const retry = vi.fn();
    render(
      <CardFrame
        {...base}
        state="failed"
        primary={{ label: "Read", onClick: vi.fn() }}
        failure={{
          message: "This article didn't load.",
          onRetry: retry,
          classicHref: "/track/t/item/i",
        }}
      />,
    );
    expect(screen.getByText("This article didn't load.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open the classic view" })).toHaveAttribute(
      "href",
      "/track/t/item/i",
    );
    expect(screen.queryByRole("button", { name: /Read/ })).not.toBeInTheDocument();
  });

  it("Ally's own cards wear the clay wash and the Ally type row", () => {
    render(<CardFrame {...base} surface="ally" typeWord="Optional practice" state="ready" />);
    expect(screen.getByRole("article")).toHaveClass("bg-[var(--g-ally-wash)]");
  });
});
