import React from "react";

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import "@constants";

import { CreateGate } from "../CreateGate";

const setWidth = (px: number) => {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min ? px >= Number(min[1]) : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  }) as unknown as typeof window.matchMedia;
};

const show = () =>
  render(
    <MemoryRouter>
      <CreateGate>
        <div data-testid="create-screen" />
      </CreateGate>
    </MemoryRouter>,
  );

describe("CreateGate", () => {
  afterEach(() => {
    // @ts-expect-error jsdom has no matchMedia by default
    delete window.matchMedia;
  });

  it("mounts the create screen at 1280px and wider", () => {
    setWidth(1280);
    show();
    expect(screen.getByTestId("create-screen")).toBeTruthy();
  });

  it("mounts nothing below 1280px, so no blank is created, and says to open it on a laptop", () => {
    setWidth(1279);
    show();
    expect(screen.queryByTestId("create-screen")).toBeNull();
    expect(screen.getByTestId("create-narrow").textContent).toContain("laptop");
  });
});
