import { fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  enabled: true,
  availabilityArgs: [] as unknown[],
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () => (await import("../../ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefOptionsAvailabilityQuery: (arg: unknown) => {
    h.availabilityArgs.push(arg);
    return { data: { enabled: h.enabled } };
  },
}));

/* eslint-disable import/first */
import { formatSimulationResponseData } from "../../../utils/createSimulation";
import { DebriefRiskCueField } from "../DebriefRiskCueField";
/* eslint-enable import/first */

let form: ReturnType<typeof useForm> | null = null;
const Host: React.FC<{ initial?: Record<string, unknown>; readOnly?: boolean }> = ({
  initial,
  readOnly,
}) => {
  form = useForm({ defaultValues: initial ?? {} });
  return <DebriefRiskCueField formMethods={form} readOnly={readOnly} />;
};

describe("Simulation editor › Is handling a risk conversation the skill practised here?", () => {
  beforeEach(() => {
    h.enabled = true;
    h.availabilityArgs = [];
  });

  it("starts on No", () => {
    render(<Host />);
    expect(screen.getByTestId("risk-cue-no")).toBeChecked();
    expect(screen.getByTestId("risk-cue-yes")).not.toBeChecked();
  });

  it("choosing Yes saves the practised key", () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("risk-cue-yes"));
    expect(form?.getValues("debriefRiskCueOption")).toBe("part_of_practice");
    expect(screen.getByTestId("risk-cue-yes")).toBeChecked();
  });

  it("choosing No puts the roleplay back on the default", () => {
    render(<Host initial={{ debriefRiskCueOption: "part_of_practice" }} />);
    expect(screen.getByTestId("risk-cue-yes")).toBeChecked();
    fireEvent.click(screen.getByTestId("risk-cue-no"));
    expect(form?.getValues("debriefRiskCueOption")).toBeNull();
  });

  it("reads any saved key other than the practised one as No", () => {
    render(<Host initial={{ debriefRiskCueOption: "peer" }} />);
    expect(screen.getByTestId("risk-cue-no")).toBeChecked();
  });

  it("is read-only when the editor is", () => {
    render(<Host readOnly initial={{ debriefRiskCueOption: "part_of_practice" }} />);
    expect(screen.getByTestId("risk-cue-no")).toBeDisabled();
    expect(screen.getByTestId("risk-cue-yes")).toBeDisabled();
  });
});

describe("Where the Debrief choice shows", () => {
  beforeEach(() => {
    h.enabled = true;
    h.availabilityArgs = [];
  });

  it("renders nothing at all where the new Debrief is not on", () => {
    h.enabled = false;
    const { container } = render(<Host />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still shows a saved choice where it is not on", () => {
    h.enabled = false;
    render(<Host initial={{ debriefRiskCueOption: "part_of_practice" }} />);
    expect(screen.getByTestId("debrief-risk-cue-field")).toBeInTheDocument();
  });

  it("asks about the roleplay being edited (and none for one not saved yet)", () => {
    render(
      <MemoryRouter initialEntries={["/simulations/abc"]}>
        <Routes>
          <Route path="/simulations/:id" element={<Host />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(h.availabilityArgs).toContainEqual({ scenarioId: "abc" });
    h.availabilityArgs = [];
    render(<Host />);
    expect(h.availabilityArgs).toContainEqual({ scenarioId: undefined });
  });
});

describe("Saved choices reach the form", () => {
  it("hydrates the metadata fields, unset as null", () => {
    const withValues = formatSimulationResponseData({
      metadata: { debriefRiskCueOption: "part_of_practice" },
    } as never);
    expect(withValues.debriefRiskCueOption).toBe("part_of_practice");
    const unset = formatSimulationResponseData({ metadata: {} } as never);
    expect(unset.debriefRiskCueOption).toBeNull();
  });
});
