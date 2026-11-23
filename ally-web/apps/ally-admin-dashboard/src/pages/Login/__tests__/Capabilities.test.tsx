import React from "react";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { en } from "@constants";

import { Capabilities } from "../Capabilities";

const { heading, items } = en.assistantsShell.login.capabilities;

describe("Capabilities", () => {
  it("lists every capability in a grid under its heading", () => {
    render(<Capabilities />);
    const section = screen.getByRole("region", { name: heading });
    expect(within(section).getAllByRole("listitem")).toHaveLength(items.length);
    items.forEach(item => {
      expect(within(section).getByText(item.title)).toBeInTheDocument();
      expect(within(section).getByText(item.blurb)).toBeInTheDocument();
    });
  });

  it("has a title and a short blurb for each capability", () => {
    expect(items.length).toBeGreaterThanOrEqual(6);
    items.forEach(item => {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.blurb.length).toBeLessThan(110);
    });
  });
});
