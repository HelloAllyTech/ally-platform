import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import "@constants";
import { DEFAULTS_COPY } from "../defaultsCopy";

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetChatbotsQuery: () => ({ data: { chatbots: [], canCreate: true } }),
}));
vi.mock("../BotSettingsTab", () => ({
  BotSettingsTab: () => <div data-testid="defaults-settings" />,
}));
vi.mock("../ConnectorsTab", () => ({
  AllConnectorsTab: () => <div data-testid="all-connectors" />,
}));
vi.mock("../CorpusTab", () => ({ CorpusTab: () => <div data-testid="library" /> }));
vi.mock("../TemplatesTab", () => ({ TemplatesTab: () => <div data-testid="replies" /> }));

const { AssistantDefaults } = await import("../AssistantDefaults");

describe("AssistantDefaults (staff only)", () => {
  it("holds the Defaults, Library and Connectors screens that left the builder's home", () => {
    render(
      <MemoryRouter>
        <AssistantDefaults />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("defaults-settings")).toBeTruthy();
    fireEvent.click(screen.getByTestId("staff-tab-library"));
    expect(screen.getByTestId("library")).toBeTruthy();
    fireEvent.click(screen.getByTestId("staff-tab-connectors"));
    expect(screen.getByTestId("all-connectors")).toBeTruthy();
  });
});

describe("Defaults wording", () => {
  it("describes per-chatbot copies, not live inheritance", () => {
    expect(DEFAULTS_COPY.intro).toMatch(/own copy/);
    expect(DEFAULTS_COPY.intro).not.toMatch(/picks it up on its next message/);
    expect(DEFAULTS_COPY.repliesIntro).toMatch(/pushed to every copy/);
  });
});
