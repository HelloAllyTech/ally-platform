import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PmAgentIdeaRow } from "@types";

import { Handoff } from "../pm/Handoff";

describe("a PM agent guidance proposal (route D)", () => {
  it("shows the draft for the clinical advisor and says nothing was written", () => {
    const idea = {
      id: "i1",
      evidence: {
        handoff: {
          kind: "guidance",
          status: "waiting",
          action: "change",
          scope: "platform",
          existingCode: "DG-0012",
          existingTitle: "Asking about suicide",
          title: "Ask about hopelessness first",
          situation: "A client hints there is no point",
          guidance: "Pause and ask directly before practical help.",
          why: "Missed in 14 debriefs",
          runIds: ["11111111-1111-1111-1111-111111111111"],
          learners: 12,
          tenants: 4,
          for: "clinical_advisor",
        },
      },
    } as unknown as PmAgentIdeaRow;
    render(
      <MemoryRouter>
        <Handoff idea={idea} />
      </MemoryRouter>,
    );
    const box = screen.getByTestId("handoff-guidance");
    expect(box).toHaveTextContent("A change to DG-0012 · Asking about suicide");
    expect(box).toHaveTextContent("From 12 learners in 4 organisations");
    expect(box).toHaveTextContent("has not written anything to the Context Library");
    expect(screen.getByText("For the clinical advisor")).toBeInTheDocument();
  });
});
