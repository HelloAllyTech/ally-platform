import { render, screen } from "@testing-library/react";
import React from "react";
import ReactMarkdown from "react-markdown";
import { MemoryRouter } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@components", () => ({ cellTypes: {} }));

import { CitedText, citationMarkdownComponents } from "../CitationChip";
import { linkCitations } from "../citations";

const renderMarkdown = (markdown: string) =>
  render(
    <MemoryRouter>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={citationMarkdownComponents}>
        {linkCitations(markdown)}
      </ReactMarkdown>
    </MemoryRouter>,
  );

describe("Context Library citation chips", () => {
  it("draws each cited code as a chip linking to its entry, in a new tab", () => {
    renderMarkdown("Keep the first screen calm [FP-0142, FP-0007].");
    const chips = screen.getAllByTestId("context-citation");
    expect(chips.map(chip => chip.textContent)).toEqual(["FP-0142", "FP-0007"]);
    expect(chips[0]).toHaveAttribute("href", "/context-library?chunk=FP-0142");
    expect(chips[0]).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("link", { name: "Open FP-0007 in the Context Library" }),
    ).toBeInTheDocument();
  });

  it("leaves ordinary links and code as they were", () => {
    renderMarkdown("See [the spec](https://example.org) and `[FP-0142]`.");
    expect(screen.queryByTestId("context-citation")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "the spec" })).toHaveAttribute(
      "href",
      "https://example.org",
    );
    expect(screen.getByText("[FP-0142]")).toBeInTheDocument();
  });

  it("chips codes in plain text too", () => {
    render(
      <MemoryRouter>
        <p data-testid="text">
          <CitedText text="Must pass [FP-0001] checks" />
        </p>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("text")).toHaveTextContent("Must pass FP-0001 checks");
    expect(screen.getByTestId("context-citation")).toHaveAttribute(
      "href",
      "/context-library?chunk=FP-0001",
    );
  });

  it("chips Course Copilot's Learning Design and catalogue codes the same way", () => {
    renderMarkdown("Practise first [LD-0004], then reuse [CC-0042].");
    const chips = screen.getAllByTestId("context-citation");
    expect(chips.map(chip => chip.getAttribute("href"))).toEqual([
      "/context-library?chunk=LD-0004",
      "/context-library?chunk=CC-0042",
    ]);
  });
});
