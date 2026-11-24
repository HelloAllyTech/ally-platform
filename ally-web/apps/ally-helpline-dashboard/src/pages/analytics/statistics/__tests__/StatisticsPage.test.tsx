import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StatisticsChartLibrary } from "@types";

import { StatisticsPage } from "../StatisticsPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", exists: () => false },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@ally-ui-mono/ui-shared", () => ({ SkeletonText: () => null, logger: { info: vi.fn() } }));

const prefs = { data: undefined as Record<string, unknown> | undefined, isLoading: false };
const update = vi.fn();
vi.mock("@api", () => ({
  useGetUserPreferencesQuery: () => ({ data: { data: prefs.data }, isLoading: prefs.isLoading }),
  useUpdateUserPreferencesMutation: () => [update],
}));

vi.mock("../renderers", () => ({
  CHART_RENDERERS: { "TSQ-001": { kind: "data", pin: () => null }, "TSQ-041": { kind: "data" } },
}));
vi.mock("../ForYouView", () => ({
  ForYouView: (props: {
    pinKeys: string[];
    onPinsChange: (k: string[]) => void;
    onOpen: (i: unknown) => void;
    onOpenInsight: (i: unknown) => void;
  }) => (
    <div data-testid="for-you">
      {JSON.stringify(props.pinKeys)}
      <button type="button" onClick={() => props.onPinsChange(["TSQ-001"])}>
        save-pins
      </button>
      <button
        type="button"
        onClick={() =>
          props.onOpen({ key: "TSQ-041?course=c9", id: "TSQ-041", filters: { course: "c9" } })
        }
      >
        open-pin
      </button>
      <button
        type="button"
        onClick={() =>
          props.onOpenInsight({
            chartId: "TSQ-041",
            view: "course",
            filters: { course: "c7" },
          })
        }
      >
        open-insight
      </button>
    </div>
  ),
}));
vi.mock("../StatisticsView", () => ({
  StatisticsView: (props: {
    view: { id: string };
    layoutKeys: string[];
    subjectId?: string;
    focusChart?: string;
    onLayoutChange: (k: string[]) => void;
    onSubjectChange: (id: string) => void;
    onTogglePin: (id: string, key: string) => void;
  }) => (
    <div data-testid={`view-${props.view.id}`}>
      <span data-testid="layout">{JSON.stringify(props.layoutKeys)}</span>
      <span data-testid="subject">{props.subjectId ?? "none"}</span>
      <span data-testid="focus">{props.focusChart ?? "none"}</span>
      <button type="button" onClick={() => props.onLayoutChange(["TSQ-001"])}>
        save-layout
      </button>
      <button type="button" onClick={() => props.onSubjectChange("c2")}>
        pick-subject
      </button>
      <button type="button" onClick={() => props.onTogglePin("TSQ-001", "TSQ-001")}>
        toggle-pin
      </button>
    </div>
  ),
}));

const chart = (id: string) => ({
  id,
  title: id,
  question: id,
  group: "activity",
  shape: "x",
  chart: "x",
  size: "m",
  state: "available",
  reason: null,
  scopes: ["organisation"],
  filters: [],
});

const library = {
  enabled: true,
  charts: [chart("TSQ-001"), chart("TSQ-041")],
  views: [
    {
      id: "organisation",
      subject: null,
      sections: [{ key: "learners", subject: false, charts: ["TSQ-001"] }],
      defaultLayout: ["TSQ-001"],
    },
    {
      id: "course",
      subject: "course",
      sections: [{ key: "courseFacts", subject: true, charts: ["TSQ-041"] }],
      defaultLayout: ["TSQ-041"],
    },
  ],
} as unknown as StatisticsChartLibrary;

const Where = () => <span data-testid="where">{useLocation().search}</span>;
const renderPage = (url = "/") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <StatisticsPage library={library} />
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  prefs.data = undefined;
  prefs.isLoading = false;
  update.mockReset();
  update.mockReturnValue({ unwrap: () => Promise.resolve() });
});

describe("the Statistics page", () => {
  it("offers For you, then the tabs the backend sends views for", () => {
    renderPage();
    expect(
      ["foryou", "organisation", "course"].every(id =>
        screen.queryByTestId(`statistics-tab-${id}`),
      ),
    ).toBe(true);
    expect(screen.queryByTestId("statistics-tab-learner")).toBeNull();
  });

  it("opens on Organisation when nothing is pinned, and on For you when something is", () => {
    renderPage();
    expect(screen.getByTestId("view-organisation")).toBeTruthy();
  });

  it("opens on For you with the default pins until the person pins their own", () => {
    const withDefaults = { ...library, defaultPins: ["TSQ-001"] } as StatisticsChartLibrary;
    render(
      <MemoryRouter initialEntries={["/"]}>
        <StatisticsPage library={withDefaults} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("for-you").textContent).toContain("TSQ-001");
  });

  it("does not bring the defaults back after the person removed every pin", () => {
    prefs.data = { statistics_layouts: { pins: [] } };
    const withDefaults = { ...library, defaultPins: ["TSQ-001"] } as StatisticsChartLibrary;
    render(
      <MemoryRouter initialEntries={["/"]}>
        <StatisticsPage library={withDefaults} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("for-you")).toBeNull();
  });

  it("opens on For you for a person with pins", () => {
    prefs.data = { statistics_layouts: { pins: ["TSQ-001"] } };
    renderPage();
    expect(screen.getByTestId("for-you").textContent).toContain("TSQ-001");
  });

  it("opens the tab the address names, and changes the address when a tab is chosen", () => {
    renderPage("/?tab=course");
    expect(screen.getByTestId("view-course")).toBeTruthy();
    fireEvent.click(screen.getByTestId("statistics-tab-organisation"));
    expect(screen.getByTestId("where").textContent).toContain("tab=organisation");
    expect(screen.getByTestId("view-organisation")).toBeTruthy();
  });

  it("does not carry one tab's course into the address of another", () => {
    renderPage("/?tab=course&course=c1");
    fireEvent.click(screen.getByTestId("statistics-tab-organisation"));
    expect(screen.getByTestId("where").textContent).not.toContain("course=");
  });

  it("ignores a tab it does not have", () => {
    renderPage("/?tab=learner");
    expect(screen.getByTestId("view-organisation")).toBeTruthy();
  });

  it("uses the default layout until the person saves one, then the saved one", () => {
    renderPage();
    expect(screen.getByTestId("layout").textContent).toBe('["TSQ-001"]');
  });

  it("reads the older single list as the Organisation layout", () => {
    prefs.data = { statistics_dashboard: ["TSQ-001"] };
    renderPage();
    expect(screen.getByTestId("layout").textContent).toBe('["TSQ-001"]');
  });

  it("puts the older single list into section order the first time it is read", () => {
    prefs.data = { statistics_dashboard: ["TSQ-041", "TSQ-001"] };
    renderPage("/?tab=organisation");
    expect(screen.getByTestId("layout").textContent).toBe('["TSQ-001"]');
  });

  it("saves a layout with every tab's layout in one object, since preferences merge keys, not what is inside them", async () => {
    prefs.data = { statistics_layouts: { course: ["TSQ-041"] } };
    renderPage("/?tab=organisation");
    fireEvent.click(screen.getByText("save-layout"));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith({
      statistics_layouts: { course: ["TSQ-041"], organisation: ["TSQ-001"] },
    });
  });

  it("remembers the subject in the address and in preferences", async () => {
    prefs.data = { statistics_subjects: { learner: "7" } };
    renderPage("/?tab=course");
    fireEvent.click(screen.getByText("pick-subject"));
    expect(screen.getByTestId("where").textContent).toContain("course=c2");
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith({ statistics_subjects: { learner: "7", course: "c2" } });
  });

  it("takes the subject from the address before the saved one", () => {
    prefs.data = { statistics_subjects: { course: "saved" } };
    renderPage("/?tab=course&course=fromUrl");
    expect(screen.getByTestId("subject").textContent).toBe("fromUrl");
  });

  it("falls back to the saved subject", () => {
    prefs.data = { statistics_subjects: { course: "saved" } };
    renderPage("/?tab=course");
    expect(screen.getByTestId("subject").textContent).toBe("saved");
  });

  it("pins a chart, and unpins it again", async () => {
    renderPage("/?tab=organisation");
    fireEvent.click(screen.getByText("toggle-pin"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ statistics_layouts: { pins: ["TSQ-001"] } }),
    );
  });

  it("opens a pinned card on its own tab, for the course it was pinned for", () => {
    prefs.data = { statistics_layouts: { pins: ["TSQ-001"] } };
    renderPage("/?tab=foryou");
    fireEvent.click(screen.getByText("open-pin"));
    expect(screen.getByTestId("where").textContent).toContain("tab=course");
    expect(screen.getByTestId("where").textContent).toContain("course=c9");
  });

  it("opens a finding on its tab and chart, for the course it is about", () => {
    prefs.data = { statistics_layouts: { pins: ["TSQ-001"] } };
    renderPage("/?tab=foryou&learner=9");
    fireEvent.click(screen.getByText("open-insight"));
    const where = screen.getByTestId("where").textContent ?? "";
    expect(where).toContain("tab=course");
    expect(where).toContain("course=c7");
    expect(where).toContain("chart=TSQ-041");
    expect(where).not.toContain("learner=");
    expect(screen.getByTestId("focus").textContent).toBe("TSQ-041");
  });

  it("forgets the chart to look at when another tab is chosen", () => {
    renderPage("/?tab=course&chart=TSQ-041");
    fireEvent.click(screen.getByTestId("statistics-tab-organisation"));
    expect(screen.getByTestId("where").textContent).not.toContain("chart=");
  });
});
