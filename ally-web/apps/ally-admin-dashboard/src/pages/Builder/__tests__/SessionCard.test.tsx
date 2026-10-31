import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderSession } from "@types";

vi.mock("@icons", () => ({
  Settings: () => <svg />,
  MachineLearningModel: () => <svg data-testid="model-icon" />,
  BarChart3: () => <svg />,
  Book: () => <svg />,
  Timer: () => <svg />,
  Chemistry: () => <svg />,
  Notification: () => <svg />,
}));

vi.mock("@components/builder", () => ({
  BuilderNotificationBell: () => <div>NotificationBellStub</div>,
}));

vi.mock("@components", () => ({
  cellTypes: {},
  ListToolbar: () => null,
  FilterDropdown: () => null,
  ListPagination: () => null,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children }: any) => <button>{children}</button>,
  Checkbox: () => null,
  InlineNotification: () => null,
  SkeletonText: () => null,
  Tag: ({ children }: any) => <span>{children}</span>,
  Tile: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  AutoExpandableTextarea: () => null,
}));

const getSessionsSpy = vi.fn();
let sessions: BuilderSession[] = [];

vi.mock("@api", () => ({
  useGetBuilderSessionsQuery: (...args: unknown[]) => {
    getSessionsSpy(...args);
    return { data: sessions, isLoading: false, isError: false };
  },
  useGetArchivedBuilderSessionsQuery: () => ({
    data: { sessions: [], totalCount: 0 },
    isLoading: false,
  }),
  useCreateBuilderSessionMutation: () => [vi.fn(), { isLoading: false }],
  useArchiveBuilderSessionMutation: () => [vi.fn()],
  useUnarchiveBuilderSessionMutation: () => [vi.fn()],
}));

import { Builder } from "../Builder";

const mockSession = (overrides: Partial<BuilderSession> = {}): BuilderSession => ({
  id: "s1",
  title: "Test Session",
  slug: "test-session",
  status: "COMPLETED",
  currentStage: null,
  repos: ["repo-1"],
  model: "gpt-4o",
  lastMessageSeq: 0,
  budgetUsd: null,
  totalCostUsd: "0",
  runnerMinutes: 0,
  error: null,
  archivedAt: null,
  createdBy: 1,
  createdByName: "Test User",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("SessionCard (via Builder)", () => {
  beforeEach(() => {
    getSessionsSpy.mockClear();
    sessions = [];
  });

  it("renders the model name and icon when model is present", () => {
    sessions = [mockSession({ model: "gpt-4o" })];
    render(<Builder />, { wrapper: MemoryRouter });

    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByTestId("model-icon")).toBeInTheDocument();
  });

  it("does not render model information when model is null", () => {
    sessions = [mockSession({ model: null })];
    render(<Builder />, { wrapper: MemoryRouter });

    expect(screen.queryByText("gpt-4o")).toBeNull();
    expect(screen.queryByTestId("model-icon")).toBeNull();
  });
});
