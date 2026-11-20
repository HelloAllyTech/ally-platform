import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SummarySidebarWrapper from "../SummarySidebarWrapper";

vi.mock("@components", () => ({
  Drawer: ({ children, title }: any) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}));
vi.mock("@containers", () => ({ ShortSessionUI: () => null }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tabs: ({ items }: any) => (
    <div data-testid="tab-strip">{items.map((i: any) => i.label).join(",")}</div>
  ),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const tabList = [
  { id: 4, label: "Debrief", content: <div>debrief body</div> },
  { id: 3, label: "Transcript", content: <div>transcript body</div> },
];

describe("SummarySidebarWrapper side by side", () => {
  it("shows both tabs' content at once, with no tab strip", () => {
    render(<SummarySidebarWrapper tabList={tabList} title="Debrief" sideBySide />);
    expect(screen.getByTestId("summary-side-by-side")).toBeTruthy();
    expect(screen.getByText("debrief body")).toBeTruthy();
    expect(screen.getByText("transcript body")).toBeTruthy();
    expect(screen.queryByTestId("tab-strip")).toBeNull();
  });

  it("keeps the tabs when not side by side", () => {
    render(<SummarySidebarWrapper tabList={tabList} title="Debrief" />);
    expect(screen.getByTestId("tab-strip")).toBeTruthy();
    expect(screen.queryByText("transcript body")).toBeNull();
  });
});
