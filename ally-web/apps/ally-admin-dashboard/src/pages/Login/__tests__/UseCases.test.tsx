import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";

import { UseCases } from "../UseCases";

// Exit animations would keep a closed drawer in the page; render motion elements plainly.
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, initial, animate, exit, transition, ...props }: any) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const cases = en.assistantsShell.login.useCases;

describe("UseCases", () => {
  it("lists every use case as a card in a swipeable track", () => {
    render(<UseCases />);
    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId("use-cases-track")).toBeInTheDocument();
    cases.forEach(c => {
      expect(screen.getByRole("button", { name: new RegExp(c.title) })).toBeInTheDocument();
    });
  });

  it("opens a card as a side panel with its detail and an example conversation", () => {
    render(<UseCases />);
    expect(screen.queryByTestId("use-case-drawer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(cases[0].title) }));
    expect(screen.getByRole("dialog", { name: cases[0].title })).toBeInTheDocument();
    expect(screen.getByText(cases[0].detail.intro)).toBeInTheDocument();
    expect(screen.getByText(cases[0].detail.example.question)).toBeInTheDocument();
    expect(screen.getByText(cases[0].detail.example.answer)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("use-case-drawer")).toBeNull();
  });

  it("closes the panel and hands over to the email field from its last button", () => {
    const onStart = vi.fn();
    render(<UseCases onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(cases[1].title) }));
    fireEvent.click(screen.getByText(en.assistantsShell.login.startBuilding));
    expect(screen.queryByTestId("use-case-drawer")).toBeNull();
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
