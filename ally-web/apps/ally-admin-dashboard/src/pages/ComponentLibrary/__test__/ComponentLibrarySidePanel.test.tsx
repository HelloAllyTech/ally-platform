import { fireEvent, render, screen } from "@testing-library/react";
import { useFormContext } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { ComponentLibrarySidePanel } from "../ComponentLibrarySidePanel";

vi.mock("@api", () => ({
  useCreateComponentTemplateMutation: () => [vi.fn(), { isLoading: false }],
  useUpdateComponentTemplateMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock("@assets", () => ({ DoubleArrowRight: () => <span /> }));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary", DESTRUCTIVE: "destructive" },
}));
vi.mock("@components", () => ({
  Button: ({ children, variant: _v, ...props }: any) => <button {...props}>{children}</button>,
  ActionConfirmationPopup: ({ isOpen, title, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
}));
vi.mock("@constants", () => ({
  DEFAULT_TRACK_FORM_VALUES: { title: "", sections: [] },
  en: {
    common: { save: "Save", cancel: "Cancel", delete: "Delete" },
    errors: { titleIsRequired: "Title is required" },
    componentLibrary: {
      createTemplatePanelTitle: "Create template",
      editTemplatePanelTitle: "Edit template",
      deleteTemplate: "Delete template",
      deleteTemplateConfirmation: "Sure?",
      unsavedChanges: "Unsaved changes",
      unsavedChangesDescription: "Lose them?",
      closeAnyway: "Close without saving",
      keepEditing: "Keep editing",
    },
  },
}));
vi.mock("../../CreateTrack/trackFormUtils", () => ({
  createItemOfType: () => ({ title: "", type: "QUIZ" }),
  createItemFormValueFromTemplate: vi.fn(),
  serializeItem: vi.fn(),
}));
vi.mock("../../CreateTrack/components/ItemEditorCanvas", () => ({
  ItemEditorCanvas: () => {
    const { register } = useFormContext();
    return <input aria-label="Item title" {...register("sections.0.items.0.title")} />;
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const renderPanel = () => {
  const onClose = vi.fn();
  const utils = render(
    <ComponentLibrarySidePanel
      isOpen
      type={"QUIZ" as any}
      template={null}
      onClose={onClose}
      onDelete={vi.fn()}
    />,
  );
  const backdrop = utils.container.querySelector(".bg-black") as HTMLElement;
  return { onClose, backdrop };
};

describe("ComponentLibrarySidePanel — closing with unsaved work", () => {
  it("closes straight away when nothing was edited", () => {
    const { onClose, backdrop } = renderPanel();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding edits on a backdrop click, and Keep editing keeps them", () => {
    const { onClose, backdrop } = renderPanel();
    fireEvent.input(screen.getByLabelText("Item title"), { target: { value: "My quiz" } });

    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Keep editing"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Item title")).toHaveValue("My quiz");

    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Close without saving"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
