import React from "react";

import { render, screen } from "@testing-library/react";
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

const panels = await import("../AssistantDefaults");

describe("Defaults panels (staff only)", () => {
  it("each holds one of the screens that left the builder's home", () => {
    const { rerender } = render(
      <MemoryRouter>
        <panels.StartingSettingsPanel />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("defaults-settings")).toBeTruthy();
    expect(screen.getByText(DEFAULTS_COPY.intro)).toBeTruthy();

    rerender(
      <MemoryRouter>
        <panels.QuickRepliesPanel />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("replies")).toBeTruthy();
    expect(screen.getByText(DEFAULTS_COPY.repliesIntro)).toBeTruthy();

    rerender(
      <MemoryRouter>
        <panels.KnowledgeLibraryPanel />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("library")).toBeTruthy();

    rerender(
      <MemoryRouter>
        <panels.ChannelsPanel />
      </MemoryRouter>,
    );
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
