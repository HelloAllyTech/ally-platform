import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, href }: any) =>
    href ? <a href={href}>{children}</a> : <button onClick={onClick}>{children}</button>,
  Checkbox: ({ id, labelText, checked, onChange }: any) => (
    <label>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event, { checked: event.target.checked })}
      />
      {labelText}
    </label>
  ),
  InlineLoading: ({ description }: any) => <div>{description}</div>,
  InlineNotification: ({ title, subtitle }: any) => (
    <div role="alert">
      {title} {subtitle}
    </div>
  ),
  Select: ({ id, labelText, value, onChange, children }: any) => (
    <label>
      {labelText}
      <select id={id} value={value} onChange={onChange}>
        {children}
      </select>
    </label>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  SkeletonText: () => <div>loading</div>,
  TextArea: ({ id, labelText, value, onChange }: any) => (
    <label>
      {labelText}
      <textarea id={id} value={value} onChange={onChange} />
    </label>
  ),
  TextInput: ({ id, labelText, value, onChange }: any) => (
    <label>
      {labelText}
      <input id={id} value={value} onChange={onChange} />
    </label>
  ),
}));

vi.mock("@components/course-copilot", () => ({
  RoleplayCard: ({ card }: any) => <div data-testid="card">{card.mode}</div>,
}));

let startFn: any;
let runResult: any;
vi.mock("@api", () => ({
  useGetRoleplayAgentOptionsQuery: () => ({
    isLoading: false,
    isError: false,
    data: {
      modes: ["learning", "practice", "performance"],
      competencies: [{ id: "c1", name: "Suicide risk" }],
      languages: [{ id: "1", name: "English", code: "en", voiceCount: 2 }],
      triggerWarnings: [],
      limits: { languages: 4 },
    },
  }),
  useStartRoleplayAgentRunMutation: () => [startFn, { isLoading: false }],
  useGetRoleplayAgentRunQuery: (id: string, opts: any) =>
    opts.skip ? { data: undefined } : runResult,
}));

// eslint-disable-next-line import/first
import { RoleplayAgentPage } from "../RoleplayAgentPage";

const strings = en.roleplayAgent;
const renderAt = (url = "/roleplay-agent") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <RoleplayAgentPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  startFn = vi.fn(() => ({ unwrap: () => Promise.resolve({ id: "run-1" }) }));
  runResult = { isLoading: false, isError: false, data: undefined };
});

describe("RoleplayAgentPage", () => {
  it("asks for learners, goal and competency before starting", () => {
    renderAt();
    fireEvent.click(screen.getByText(strings.start));
    expect(screen.getByRole("alert").textContent).toContain(strings.required);
    expect(startFn).not.toHaveBeenCalled();
  });

  it("sends the request with the chosen mode and explains the mode", async () => {
    renderAt();
    fireEvent.change(screen.getByLabelText(strings.learners), {
      target: { value: "Teachers" },
    });
    fireEvent.change(screen.getByLabelText(strings.goal), {
      target: { value: "Ask about suicide" },
    });
    fireEvent.change(screen.getByLabelText(strings.competency), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText(strings.mode), { target: { value: "learning" } });
    expect(screen.getByTestId("mode-help").textContent).toBe(strings.modeHelp.learning);

    fireEvent.click(screen.getByText(strings.start));
    await waitFor(() => expect(startFn).toHaveBeenCalled());
    expect(startFn.mock.calls[0][0]).toMatchObject({
      learners: "Teachers",
      goal: "Ask about suicide",
      competencyIds: ["c1"],
      mode: "learning",
      minScore: 60,
      lengthMinutes: 6,
    });
  });

  it("shows the steps while a run builds", () => {
    runResult = {
      isLoading: false,
      isError: false,
      data: { id: "run-1", status: "running", step: "building", request: {} },
    };
    renderAt("/roleplay-agent?run=run-1");
    expect(screen.getByTestId("roleplay-agent-running")).toBeTruthy();
    expect(screen.getByText(strings.steps.building)).toBeTruthy();
  });

  it("shows the card and a link to Studio when done, and the error when failed", () => {
    runResult = {
      isLoading: false,
      isError: false,
      data: {
        id: "run-1",
        status: "done",
        step: "done",
        request: {},
        result: { scenarioId: 77, summary: "", card: { title: "Aarav", mode: "learning" } },
      },
    };
    const { unmount } = renderAt("/roleplay-agent?run=run-1");
    expect(screen.getByTestId("card").textContent).toBe("learning");
    expect(screen.getByText(strings.openRoleplay).getAttribute("href")).toContain("77");
    unmount();

    runResult = {
      isLoading: false,
      isError: false,
      data: { id: "run-1", status: "failed", step: "brief", request: {}, error: "model down" },
    };
    renderAt("/roleplay-agent?run=run-1");
    expect(screen.getByRole("alert").textContent).toContain("model down");
  });
});
