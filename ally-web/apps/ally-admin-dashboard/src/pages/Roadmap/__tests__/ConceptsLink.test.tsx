import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CONCEPTS_WIKI_URL, ConceptsButton } from "../components/ConceptsLink";

describe("ConceptsButton", () => {
  it("opens the live wiki page in a new tab", () => {
    render(<ConceptsButton />);
    const link = screen.getByRole("link", { name: /^Core concepts/ });
    expect(link).toHaveAttribute("href", CONCEPTS_WIKI_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(CONCEPTS_WIKI_URL).toBe("https://tech.helloally.ai/#/wiki/platform/concepts.md");
  });
});
