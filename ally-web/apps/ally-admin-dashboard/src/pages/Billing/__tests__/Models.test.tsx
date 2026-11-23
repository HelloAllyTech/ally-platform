import React from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { BillingModel } from "@api";

const { mockModels, mockUnknown, mockAdd } = vi.hoisted(() => ({
  mockModels: vi.fn(),
  mockUnknown: vi.fn(),
  mockAdd: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@api", () => ({
  useGetBillingModelsQuery: () => mockModels(),
  useGetUnknownBillingModelsQuery: () => mockUnknown(),
  useGetBillingModelHistoryQuery: () => ({ data: { versions: [], history: [] }, isLoading: false }),
  useAddBillingModelMutation: () => [mockAdd],
  useUpdateBillingModelPriceMutation: () => [vi.fn()],
  useEditBillingModelMutation: () => [vi.fn()],
  useSetBillingModelStatusMutation: () => [vi.fn()],
  useDeleteBillingModelMutation: () => [vi.fn()],
}));

vi.mock("@assets", () => ({ DoubleArrowRight: () => <svg /> }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <span data-tooltip={label}>{children}</span>
  ),
}));

// The table draws each row's cells as text; the popup its title, children and buttons.
vi.mock("@components", () => ({
  cellTypes: { wrapText: "wrapText" },
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid={rest["data-testid"]}>
      {children}
    </button>
  ),
  ListToolbar: ({ action }: any) => <button onClick={action.onClick}>{action.label}</button>,
  NotionTable: ({ tableData, onRowClick }: any) => (
    <div>
      {tableData.data.map((row: Record<string, string>, i: number) => (
        <div key={row.id} data-testid={`row-${i}`} onClick={() => onRowClick(i)}>
          {tableData.columns.map((c: { id: string }) => (
            <span key={c.id}>{row[c.id]}</span>
          ))}
        </div>
      ))}
    </div>
  ),
  ActionConfirmationPopup: ({ isOpen, title, children, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div role="dialog">
        <p>{title}</p>
        {children}
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
        <button onClick={primaryButton.onClick} disabled={primaryButton.disabled}>
          {`confirm:${primaryButton.label}`}
        </button>
      </div>
    ) : null,
}));

import { AddModelPanel, ModelDetailPanel } from "../Models/ModelPanels";
import { ModelsTab } from "../Models/ModelsTab";

const MODEL: BillingModel = {
  id: "m1",
  provider: "openai",
  model: "gpt-4.1-mini",
  label: "GPT-4.1 mini",
  type: "chat",
  status: "active",
  notes: "new default for customer replies",
  versions: 1,
  usageCount: 1204,
  unpricedCount: 0,
  current: {
    id: "p1",
    modelId: "m1",
    version: 1,
    inputPer1MMicros: 400_000,
    cachedInputPer1MMicros: 100_000,
    outputPer1MMicros: 1_600_000,
    unitPriceMicros: null,
    unit: null,
    effectiveFrom: "2026-11-01",
    note: "Starting list",
    createdBy: 1,
    createdAt: "2026-11-01T00:00:00Z",
  },
};

const noop = () => Promise.resolve();
const detailProps = {
  onClose: vi.fn(),
  onUpdatePrice: noop,
  onEdit: noop,
  onSetStatus: noop,
  onDelete: noop,
};

describe("Ally admin → Models", () => {
  beforeEach(() => {
    mockModels.mockReturnValue({ data: [MODEL], isFetching: false });
    mockUnknown.mockReturnValue({ data: [] });
  });

  it("shows each model's prices per million tokens in dollars", () => {
    render(<ModelsTab />);
    const row = screen.getByTestId("row-0");
    expect(within(row).getByText("gpt-4.1-mini")).toBeInTheDocument();
    expect(within(row).getByText("$0.400")).toBeInTheDocument();
    expect(within(row).getByText("$0.100")).toBeInTheDocument();
    expect(within(row).getByText("$1.600")).toBeInTheDocument();
    expect(within(row).getByText("2026-11-01")).toBeInTheDocument();
    expect(within(row).getByText("1,204")).toBeInTheDocument();
  });

  it("warns about unpriced usage and opens Add model prefilled", () => {
    mockUnknown.mockReturnValue({
      data: [{ provider: "openai", model: "gpt-6-luna", events: 42, since: "2026-11-18" }],
    });
    render(<ModelsTab />);
    expect(screen.getByText("Usage was recorded for models that aren't priced yet")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));
    expect(screen.getByLabelText("Model id")).toHaveValue("gpt-6-luna");
    expect(screen.getByLabelText("Provider")).toHaveValue("openai");
  });

  it("disables Delete, with the reason, once usage was recorded", () => {
    render(<ModelDetailPanel model={MODEL} {...detailProps} />);
    expect(screen.getByTestId("billing-model-delete")).toBeDisabled();
    expect(screen.getByTestId("billing-model-delete-wrap").parentElement).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("Retire it instead"),
    );
  });

  it("allows Delete for a model with no usage", () => {
    render(<ModelDetailPanel model={{ ...MODEL, usageCount: 0 }} {...detailProps} />);
    expect(screen.getByTestId("billing-model-delete")).toBeEnabled();
  });

  it("asks for a note before saving, and sends it with the change", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AddModelPanel onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("Model id"), { target: { value: "gpt-6-luna" } });
    fireEvent.change(screen.getByLabelText("Input $ per 1M tokens"), {
      target: { value: "0.4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const confirm = screen.getByRole("button", { name: "confirm:Save" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("billing-note"), {
      target: { value: "OpenAI launched it" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openai",
          model: "gpt-6-luna",
          inputPerMillionUsd: 0.4,
          note: "OpenAI launched it",
        }),
      ),
    );
  });

  it("won't ask for a note while no price is given", () => {
    const onSave = vi.fn();
    render(<AddModelPanel onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("Model id"), { target: { value: "gpt-6-luna" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give at least one price.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
