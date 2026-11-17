import { fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { riskCue } from "./fixtures";

const h = vi.hoisted(() => ({
  frameworks: [] as unknown[],
  options: [] as unknown[],
  enabled: true,
  availabilityArgs: [] as unknown[],
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () => (await import("../../ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefOptionsAvailabilityQuery: (arg: unknown) => {
    h.availabilityArgs.push(arg);
    return { data: { enabled: h.enabled } };
  },
  useGetDebriefSkillFrameworksQuery: () => ({
    isLoading: false,
    isError: false,
    data: h.frameworks,
  }),
  useGetRiskCueOptionsQuery: () => ({ isLoading: false, isError: false, data: h.options }),
  useCreateRiskCueOptionMutation: () => [vi.fn(), { isLoading: false }],
  useUpdateRiskCueOptionMutation: () => [vi.fn(), { isLoading: false }],
  useTestRiskCueOptionMutation: () => [vi.fn(), { isLoading: false }],
  useSubmitRiskCueOptionMutation: () => [vi.fn(), { isLoading: false }],
}));

/* eslint-disable import/first */
import { formatSimulationResponseData } from "../../../utils/createSimulation";
import { DebriefRiskCueField } from "../DebriefRiskCueField";
import { DebriefSkillFrameworkField } from "../DebriefSkillFrameworkField";
/* eslint-enable import/first */

let form: ReturnType<typeof useForm> | null = null;
const Host: React.FC<{
  initial?: Record<string, unknown>;
  which: "framework" | "risk" | "both";
}> = ({ initial, which }) => {
  form = useForm({ defaultValues: initial ?? {} });
  return (
    <>
      {which !== "risk" && <DebriefSkillFrameworkField formMethods={form} />}
      {which !== "framework" && <DebriefRiskCueField formMethods={form} />}
    </>
  );
};

describe("Simulation editor › Debrief skill framework", () => {
  beforeEach(() => {
    h.frameworks = [
      { id: "none", name: "None", isDefault: false },
      { id: "advanced", name: "Advanced skills", skills: [], isDefault: false },
      { id: "foundational", name: "Foundational helping skills", skills: [], isDefault: true },
    ];
  });

  it("lists the default first and None last, and the unset value shows the default", () => {
    render(<Host which="framework" />);
    const options = Array.from(screen.getByRole("combobox").querySelectorAll("option")).map(
      o => o.textContent,
    );
    expect(options).toEqual(["Foundational helping skills (default)", "Advanced skills", "None"]);
    expect(screen.getByRole("combobox")).toHaveValue("Foundational helping skills (default)");
  });

  it("saves null for the default, 'none' for None and the id for the others", () => {
    render(<Host which="framework" initial={{ debriefSkillFramework: "advanced" }} />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("Advanced skills");
    fireEvent.change(select, { target: { value: "None" } });
    expect(form?.getValues("debriefSkillFramework")).toBe("none");
    fireEvent.change(select, { target: { value: "Foundational helping skills (default)" } });
    expect(form?.getValues("debriefSkillFramework")).toBeNull();
    fireEvent.change(select, { target: { value: "Advanced skills" } });
    expect(form?.getValues("debriefSkillFramework")).toBe("advanced");
  });

  it("explains itself in a tooltip", () => {
    render(<Host which="framework" />);
    expect(document.querySelector("[data-tooltip]")?.getAttribute("data-tooltip")).toMatch(
      /beyond this roleplay's own competencies/,
    );
  });
});

describe("Simulation editor › Risk cues in this roleplay", () => {
  beforeEach(() => {
    h.options = [
      riskCue({ id: "a", key: "peer", name: "Peer rule", description: "A peer's wording." }),
      riskCue(),
      riskCue({ id: "d", key: "mine-draft", name: "My draft", status: "draft", mine: true }),
      riskCue({
        id: "w",
        key: "mine-wait",
        name: "My waiting",
        status: "awaiting_approval",
        mine: true,
      }),
      riskCue({ id: "x", key: "theirs", name: "Their draft", status: "draft", mine: false }),
    ];
  });

  it("lists Standard first; own drafts are disabled with their status in words; others' drafts are hidden", () => {
    render(<Host which="risk" />);
    const options = Array.from(screen.getByRole("combobox").querySelectorAll("option"));
    expect(options.map(o => o.textContent)).toEqual([
      "Standard",
      "Peer rule",
      "My draft — Draft, only you can see it",
      "My waiting — Waiting for a clinical advisor",
    ]);
    expect(options.map(o => (o as HTMLOptionElement).disabled)).toEqual([false, false, true, true]);
    expect(screen.getByRole("combobox")).toHaveValue("Standard");
    expect(screen.getByText("The usual definition of a risk cue.")).toBeInTheDocument();
  });

  it("saves null for Standard and the key for another approved option; a non-approved one is not selectable", () => {
    render(<Host which="risk" initial={{ debriefRiskCueOption: "peer" }} />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("Peer rule");
    expect(screen.getByText("A peer's wording.")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "Standard" } });
    expect(form?.getValues("debriefRiskCueOption")).toBeNull();
    fireEvent.change(select, { target: { value: "Peer rule" } });
    expect(form?.getValues("debriefRiskCueOption")).toBe("peer");
    fireEvent.change(select, { target: { value: "My draft — Draft, only you can see it" } });
    expect(form?.getValues("debriefRiskCueOption")).toBe("peer");
  });

  it("falls back to the handling in words when an option has no description", () => {
    h.options = [
      riskCue({ description: "" }),
      riskCue({
        id: "z",
        key: "z",
        name: "Z",
        description: "",
        handling: "assessed",
      }),
    ];
    render(<Host which="risk" initial={{ debriefRiskCueOption: "z" }} />);
    expect(
      screen.getByText(
        "The reader decides, cue by cue, which risk cues are the skill being practised. Those are assessed in the coaching cards; any other cue is still an alarm.",
      ),
    ).toBeInTheDocument();
  });

  it("offers to create one and to open your own drafts", () => {
    render(<Host which="risk" />);
    expect(screen.getByRole("button", { name: "Create a risk-cue option" })).toBeInTheDocument();
    expect(screen.getByTestId("risk-cue-mine-mine-draft")).toHaveTextContent("My draft");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getByTestId("risk-cue-dialog")).toBeInTheDocument();
  });
});

describe("Where the Debrief choices show", () => {
  beforeEach(() => {
    h.enabled = true;
    h.availabilityArgs = [];
    h.frameworks = [{ id: "f", name: "Foundational", skills: [], isDefault: true }];
    h.options = [riskCue()];
  });

  it("shows both, with the defaults pre-selected, where the new Debrief is on", () => {
    render(<Host which="both" />);
    const [framework, risk] = screen.getAllByRole("combobox");
    expect(framework).toHaveValue("Foundational (default)");
    expect(risk).toHaveValue("Standard");
    expect(screen.getByRole("button", { name: "Create a risk-cue option" })).toBeInTheDocument();
  });

  it("renders nothing at all where it is not on", () => {
    h.enabled = false;
    const { container } = render(<Host which="both" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still shows a saved non-default choice where it is not on", () => {
    h.enabled = false;
    render(<Host which="both" initial={{ debriefRiskCueOption: "peer" }} />);
    expect(screen.getByTestId("debrief-framework-field")).toBeInTheDocument();
    expect(screen.getByTestId("debrief-risk-cue-field")).toBeInTheDocument();
  });

  it("asks about the roleplay being edited (and none for one not saved yet)", () => {
    render(
      <MemoryRouter initialEntries={["/simulations/abc"]}>
        <Routes>
          <Route path="/simulations/:id" element={<Host which="framework" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(h.availabilityArgs).toContainEqual({ scenarioId: "abc" });
    h.availabilityArgs = [];
    render(<Host which="framework" />);
    expect(h.availabilityArgs).toContainEqual({ scenarioId: undefined });
  });
});

describe("Saved choices reach the form", () => {
  it("hydrates the two metadata fields, unset as null", () => {
    const withValues = formatSimulationResponseData({
      metadata: { debriefSkillFramework: "none", debriefRiskCueOption: "peer" },
    } as never);
    expect(withValues.debriefSkillFramework).toBe("none");
    expect(withValues.debriefRiskCueOption).toBe("peer");
    const unset = formatSimulationResponseData({ metadata: {} } as never);
    expect(unset.debriefSkillFramework).toBeNull();
    expect(unset.debriefRiskCueOption).toBeNull();
  });
});
