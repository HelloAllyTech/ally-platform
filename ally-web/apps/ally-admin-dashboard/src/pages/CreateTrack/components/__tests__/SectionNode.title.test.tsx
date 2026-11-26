import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrackSectionFormValue } from "@types";

import { SectionNode } from "../SectionNode";

vi.mock("@assets", () => ({
  ArrowDown: () => <span />,
  DragIndicator: () => <span />,
  Plus: () => <span />,
  Trash: () => <span />,
  WarningAlt: () => <span />,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../ComponentTypePicker", () => ({ ComponentTypePicker: () => null }));
vi.mock("../ItemNode", () => ({ ItemNode: () => null }));

const section = (title: string): TrackSectionFormValue => ({
  localId: "s1",
  title,
  description: "",
  items: [],
});

const renderNode = (title: string, onRenameSection = vi.fn(), sectionIndex = 2) =>
  render(
    <DndContext>
      <SortableContext items={["s1"]}>
        <SectionNode
          section={section(title)}
          sectionIndex={sectionIndex}
          selection="settings"
          errorKeys={new Set()}
          onSelectItem={vi.fn()}
          onAddItem={vi.fn()}
          onAddItemFromTemplate={vi.fn()}
          onDeleteSection={vi.fn()}
          onDuplicateSection={vi.fn()}
          onRenameSection={onRenameSection}
          onReorderItems={vi.fn()}
        />
      </SortableContext>
    </DndContext>,
  );

describe("SectionNode - inline title", () => {
  it("shows the section's title in an editable field", () => {
    renderNode("Pre-assessment");
    expect(screen.getByRole("textbox", { name: "Section 3 title" })).toHaveValue("Pre-assessment");
  });

  it("reports what the trainer types, for that section", () => {
    const onRenameSection = vi.fn();
    renderNode("Section 3", onRenameSection);
    fireEvent.change(screen.getByRole("textbox", { name: "Section 3 title" }), {
      target: { value: "Pre-assessment" },
    });
    expect(onRenameSection).toHaveBeenCalledWith(2, "Pre-assessment");
  });

  it("offers the section's position as the placeholder when the title is empty", () => {
    renderNode("");
    expect(screen.getByRole("textbox", { name: "Section 3 title" })).toHaveAttribute(
      "placeholder",
      "Section 3",
    );
  });
});
