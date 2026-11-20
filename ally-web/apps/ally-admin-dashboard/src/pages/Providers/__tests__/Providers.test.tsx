import React from "react";

import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../SttConfigs/SttConfigs", () => ({ SttConfigs: () => <div>SttPane</div> }));
vi.mock("../../LlmModelCatalog/LlmModelCatalog", () => ({
  LlmModelCatalog: () => <div>LlmPane</div>,
}));
vi.mock("../../ScenarioVoices/ScenarioVoices", () => ({
  ScenarioVoices: () => <div>VoicesPane</div>,
}));

import { Providers } from "../Providers";

const renderAt = (url: string, features: string[]) => {
  const store = configureStore({ reducer: { user: (s = { features }) => s } as any });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[url]}>
        <Providers />
      </MemoryRouter>
    </Provider>,
  );
};

const ALL = ["manage_stt_configs", "manage_llm_model_catalog", "scenario_voices"];

describe("Providers", () => {
  it("opens the tab named in the URL", () => {
    renderAt("/x?tab=voices", ALL);
    expect(screen.getByText("VoicesPane")).toBeInTheDocument();
  });
  it("infers the tab from a legacy path", () => {
    renderAt("/manage-llm-model-catalog", ALL);
    expect(screen.getByText("LlmPane")).toBeInTheDocument();
  });
  it("hides tabs the admin has no feature for", () => {
    renderAt("/x?tab=voices", ["manage_stt_configs"]);
    expect(screen.getByText("SttPane")).toBeInTheDocument();
    expect(screen.queryByText("VoicesPane")).toBeNull();
  });
  it("shows the precedence explainer", () => {
    renderAt("/x", ALL);
    expect(screen.getByTestId("precedence-explainer")).toBeInTheDocument();
  });
});
