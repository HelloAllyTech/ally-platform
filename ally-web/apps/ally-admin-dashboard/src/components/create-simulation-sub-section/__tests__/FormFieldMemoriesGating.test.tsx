// The Stage Director prompt swaps Knowledge Sources for Memories, driven by
// whether the selected prompt body uses `{memories}` — not by a prompt code.
import React from "react";

import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookup } = vi.hoisted(() => ({
  // placeholder → lookup result; anything not listed is "no_selection".
  lookup: { current: {} as Record<string, { isUsed: boolean; kind: string }> },
}));

vi.mock("@hooks", async importOriginal => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useIsPlaceholderUsed: (_code: string | undefined, placeholder: string | undefined) =>
    (placeholder && lookup.current[placeholder]) || { isUsed: false, kind: "no_selection" },
}));

vi.mock("@api/baseApi", () => ({
  baseAPI: {
    injectEndpoints: vi.fn(() => ({})),
    reducerPath: "baseAPI",
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
  },
}));

vi.mock("../../knowledge-source", () => ({
  KnowledgeSource: () => <div data-testid="knowledge-source-editor" />,
}));
vi.mock("../../memories", () => ({
  MemoriesEditor: () => <div data-testid="memories-editor" />,
  MemoriesAutoMap: () => null,
}));

import { SIMULATION_CREATOR_FIELD_GROUPS } from "@constants";
import type { FormFieldConfig } from "@types";

import { FormField } from "../FormField";

const fieldConfig = (id: string): FormFieldConfig =>
  SIMULATION_CREATOR_FIELD_GROUPS.flatMap(group => group.fields).find(
    field => field.id === id,
  ) as FormFieldConfig;

const Both: React.FC = () => {
  const formMethods = useForm({ defaultValues: { selectedMainPromptCode: "any" } });
  return (
    <>
      <FormField config={fieldConfig("knowledgeSources")} formMethods={formMethods} />
      <FormField config={fieldConfig("memories")} formMethods={formMethods} />
    </>
  );
};

describe("Knowledge Sources vs Memories gating", () => {
  beforeEach(() => {
    lookup.current = {};
  });

  it("configures Memories off the {memories} placeholder, not a prompt code", () => {
    expect(fieldConfig("memories")).toMatchObject({
      promptVariable: "memories",
      showOnlyWhenUsed: true,
    });
    expect(fieldConfig("knowledgeSources")).toMatchObject({ hideWhenPromptUses: "memories" });
  });

  it("shows Memories and hides Knowledge Sources when the prompt uses {memories}", () => {
    lookup.current = { memories: { isUsed: true, kind: "loaded" } };
    render(<Both />);
    expect(screen.getByTestId("memories-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("knowledge-source-editor")).not.toBeInTheDocument();
  });

  it("shows today's Knowledge Sources and hides Memories when the prompt doesn't use it", () => {
    lookup.current = { memories: { isUsed: false, kind: "loaded" } };
    render(<Both />);
    expect(screen.getByTestId("knowledge-source-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("memories-editor")).not.toBeInTheDocument();
  });

  it("keeps Knowledge Sources and hides Memories while the prompt list is unknown", () => {
    render(<Both />);
    expect(screen.getByTestId("knowledge-source-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("memories-editor")).not.toBeInTheDocument();
  });
});
