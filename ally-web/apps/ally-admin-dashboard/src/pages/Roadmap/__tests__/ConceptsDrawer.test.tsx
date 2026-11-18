import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONCEPTS_RAW_URL,
  ConceptsDrawer,
  headingId,
  prepareConceptsMarkdown,
  resolveConceptsHref,
} from "../components/ConceptsDrawer";

const PAGE = `---
title: Core Concepts
tags: [platform]
summary: x
last_reconciled: 2026-11-18
---

# Core Concepts

See [Overloaded terms](#overloaded-terms) and [Architecture](architecture.md).

## Overloaded terms

| Term | Meanings |
|---|---|
| **Skill** | a prompt in the [Skills Store](#skills-store) |

## AI platform

### Skills Store
<!-- concept: skills-store -->
**Is:** ally-be's versioned store of every prompt.
`;

describe("prepareConceptsMarkdown", () => {
  it("drops the frontmatter and lifts each card's slug off the page", () => {
    const { markdown, slugByHeading } = prepareConceptsMarkdown(PAGE);
    expect(markdown.startsWith("\n# Core Concepts")).toBe(true);
    expect(markdown).not.toContain("<!-- concept:");
    expect(slugByHeading).toEqual({ "Skills Store": "skills-store" });
  });

  it("puts each card field on its own line", () => {
    const { markdown } = prepareConceptsMarkdown(
      "### X\n<!-- concept: x -->\n**Is:** a\n**Status:** Live — gate: none\n",
    );
    expect(markdown).toContain("**Is:** a  \n**Status:** Live");
  });
});

describe("headingId", () => {
  it("matches the page's own section anchors", () => {
    expect(headingId("Overloaded terms")).toBe("overloaded-terms");
    expect(headingId("Counselling & public product")).toBe("counselling--public-product");
  });
});

describe("resolveConceptsHref", () => {
  it("keeps #anchors in the panel, absolute URLs as they are, and maps wiki paths to the viewer", () => {
    expect(resolveConceptsHref("#plumbing")).toEqual({ inPanel: true, url: "plumbing" });
    expect(resolveConceptsHref("https://github.com/x")).toEqual({
      inPanel: false,
      url: "https://github.com/x",
    });
    expect(resolveConceptsHref("../repos/ally-be.md")).toEqual({
      inPanel: false,
      url: "https://tech.helloally.ai/#/wiki/repos/ally-be.md",
    });
    expect(resolveConceptsHref("architecture.md#deployment").url).toBe(
      "https://tech.helloally.ai/#/wiki/platform/architecture.md#deployment",
    );
  });
});

describe("ConceptsDrawer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the published page fresh on open and renders it view-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(PAGE) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ConceptsDrawer open onClose={() => undefined} />);

    expect(await screen.findByRole("heading", { name: "Skills Store" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      CONCEPTS_RAW_URL,
      expect.objectContaining({ cache: "no-cache" }),
    );
    expect(screen.getByRole("heading", { name: "Skills Store" })).toHaveAttribute(
      "id",
      "skills-store",
    );
    expect(screen.getByRole("link", { name: "Architecture" })).toHaveAttribute(
      "href",
      "https://tech.helloally.ai/#/wiki/platform/architecture.md",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows a failure with a retry that fetches again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve("") })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(PAGE) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ConceptsDrawer open onClose={() => undefined} />);

    expect(await screen.findByText("Couldn't load the core concepts page.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "Skills Store" })).toBeInTheDocument();
  });

  it("does not fetch while closed", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ConceptsDrawer open={false} onClose={() => undefined} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
