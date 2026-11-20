import React from "react";

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { isNoAccess, NoAccess } from "../NoAccess";

describe("An assistant you're not on (A1)", () => {
  it("treats 404 (how ally-be hides a bot from a non-member) and 403 as no access", () => {
    expect(isNoAccess({ status: 404 })).toBe(true);
    expect(isNoAccess({ status: 403 })).toBe(true);
    expect(isNoAccess({ status: 500 })).toBe(false);
    expect(isNoAccess({ status: "FETCH_ERROR" })).toBe(false);
    expect(isNoAccess(undefined)).toBe(false);
  });

  it("says so, with the way back to their own assistants", () => {
    render(
      <MemoryRouter>
        <NoAccess />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("assistant-no-access").textContent).toContain(
      "You don't have access to this assistant. Ask its owner to add you.",
    );
    expect(screen.getByRole("link", { name: "Go to your assistants" }).getAttribute("href")).toBe(
      "/assistants",
    );
  });
});
