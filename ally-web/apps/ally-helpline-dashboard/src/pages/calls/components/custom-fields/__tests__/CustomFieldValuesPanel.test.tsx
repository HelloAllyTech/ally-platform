import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import "@testing-library/jest-dom";

import {
  CustomFieldEditPermission,
  CustomFieldFillMode,
  CustomFieldType,
  CustomFieldValue,
} from "@types";

import CustomFieldValuesPanel from "../CustomFieldValuesPanel";

vi.mock("react-redux", () => ({
  useSelector: vi.fn(selector => selector({ user: { permissions: [] } })),
}));

vi.mock("@api", () => ({
  useGetCustomFieldValuesQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@hooks", () => ({
  useCustomFieldsEnabled: () => ({ data: true, isLoading: false }),
}));

const booleanField = (value: string | null): CustomFieldValue => ({
  fieldDefinitionId: "cf-bool-1",
  name: "Risk assessed",
  fieldType: CustomFieldType.BOOLEAN,
  sectionKey: "section",
  sectionLabel: "Section",
  editPermission: CustomFieldEditPermission.BOTH,
  fillMode: CustomFieldFillMode.MANUAL,
  displayOrder: 0,
  value,
});

describe("CustomFieldValuesPanel — BOOLEAN field default", () => {
  it("shows no selection for an unanswered Yes/No field, not 'No'", () => {
    // A BOOLEAN custom field with no value at all (never answered) used to
    // render as if "No" had already been chosen — the ternary fell through
    // to "No" for anything that wasn't the literal string "true".
    render(
      <CustomFieldValuesPanel
        chatId={1}
        canEdit
        isCounsellor
        externalFieldValues={[booleanField(null)]}
        externalLocalValues={{}}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.queryByText("No")).not.toBeInTheDocument();
    expect(screen.queryByText("Yes")).not.toBeInTheDocument();
  });

  it("still shows 'No' once the counsellor has actually answered No", () => {
    render(
      <CustomFieldValuesPanel
        chatId={1}
        canEdit
        isCounsellor
        externalFieldValues={[booleanField(null)]}
        externalLocalValues={{ "cf-bool-1": "false" }}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("still shows 'Yes' once the counsellor has actually answered Yes", () => {
    render(
      <CustomFieldValuesPanel
        chatId={1}
        canEdit
        isCounsellor
        externalFieldValues={[booleanField(null)]}
        externalLocalValues={{ "cf-bool-1": "true" }}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("lets a counsellor pick Yes from the unanswered state", () => {
    const onValueChange = vi.fn();
    render(
      <CustomFieldValuesPanel
        chatId={1}
        canEdit
        isCounsellor
        externalFieldValues={[booleanField(null)]}
        externalLocalValues={{}}
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /toggle/i }));
    fireEvent.click(screen.getByText("Yes"));

    expect(onValueChange).toHaveBeenCalledWith("cf-bool-1", "true");
  });
});

describe("CustomFieldValuesPanel — carbon (New note drawer) values", () => {
  const field = (over: Partial<CustomFieldValue>): CustomFieldValue => ({
    fieldDefinitionId: "cf-1",
    name: "Field",
    fieldType: CustomFieldType.TEXT,
    sectionKey: "section",
    sectionLabel: "Section",
    editPermission: CustomFieldEditPermission.BOTH,
    fillMode: CustomFieldFillMode.MANUAL,
    displayOrder: 0,
    value: null,
    ...over,
  });

  it("shows what was typed in a text field", () => {
    render(
      <CustomFieldValuesPanel
        chatId={0}
        canEdit
        isCounsellor
        variant="carbon"
        externalFieldValues={[field({ name: "Theme" })]}
        externalLocalValues={{ "cf-1": "Exam stress" }}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Exam stress")).toBeInTheDocument();
  });

  it("selects the option for a value stored as its label (older mobile builds)", () => {
    render(
      <CustomFieldValuesPanel
        chatId={0}
        canEdit
        isCounsellor
        variant="carbon"
        externalFieldValues={[
          field({
            name: "Ongoing risks",
            fieldType: CustomFieldType.SINGLE_SELECT,
            options: [
              { id: "uuid-run", label: "Running away", order: 0 },
              { id: "uuid-harm", label: "Self harm", order: 1 },
            ],
          }),
        ]}
        externalLocalValues={{ "cf-1": "Running away" }}
        onValueChange={vi.fn()}
      />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("uuid-run");
  });
});
