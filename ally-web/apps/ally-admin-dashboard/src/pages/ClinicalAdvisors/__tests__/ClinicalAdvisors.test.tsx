import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useListClinicalAdvisorsQuery: () => h.list(),
  useSearchClinicalAdvisorCandidatesQuery: (q: string, opts: { skip: boolean }) =>
    h.search(q, opts),
  useAddClinicalAdvisorMutation: () => [h.add],
  useRemoveClinicalAdvisorMutation: () => [h.remove],
}));
// Mocking @components (with cellTypes) sidesteps the @constants ↔ @components circular import
// that breaks under vitest, as SuperAdmins.test.tsx does.
vi.mock("@components", () => ({
  cellTypes: {
    editableText: "editableText",
    dropdown: "dropdown",
    dropdownSearchable: "dropdownSearchable",
    number: "number",
    select: "select",
    switch: "switch",
    emoji_select: "emoji_select",
    normalText: "normalText",
  },
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  EmptyState: ({ title, subtitle }: any) => (
    <div data-testid="empty-state">
      {title} {subtitle}
    </div>
  ),
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div data-testid="confirmation-popup">
        <div>{title}</div>
        <div data-testid="confirmation-description">{description}</div>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        {secondaryButton && (
          <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
        )}
      </div>
    ) : null,
}));

/* eslint-disable import/first */
import { ClinicalAdvisors } from "../ClinicalAdvisors";
/* eslint-enable import/first */

const resolves = (v: unknown = {}) => ({ unwrap: () => Promise.resolve(v) });
const rejects = (message?: string) => ({
  unwrap: () => Promise.reject(message ? { data: { message } } : new Error("")),
});

const person = (over: Record<string, unknown> = {}) => ({
  userId: 1,
  name: "Dr. Mehta",
  email: "mehta@example.org",
  organisation: "Sangath",
  roles: ["CLINICAL_ADVISOR", "ADMIN", "SIMULATION_REVIEWER", "SCRIBE_REVIEWER", "LEARNER"],
  advisor: true,
  signOff: true,
  ...over,
});

describe("User Management › Clinical advisors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.list.mockReturnValue({ data: [person()], isLoading: false, isError: false });
    h.search.mockReturnValue({ data: undefined, isError: false });
    h.add.mockReturnValue(resolves(person()));
    h.remove.mockReturnValue(resolves(person({ advisor: false })));
  });

  it("explains the access and lists the advisors with their other roles as two pills and +N", () => {
    render(<ClinicalAdvisors />);
    expect(screen.getByTestId("clinical-advisors")).toHaveTextContent(
      "Clinical advisors review debriefs from every organisation and receive escalations.",
    );
    const row = screen.getByTestId("advisor-row");
    expect(row).toHaveTextContent("Dr. Mehta");
    expect(row).toHaveTextContent("mehta@example.org");
    expect(row).toHaveTextContent("Sangath");
    const roles = within(row).getByTestId("advisor-roles");
    // The advisor role itself isn't an "other" role; the rest are plain words.
    expect(roles).not.toHaveTextContent("Clinical advisor");
    expect(roles).toHaveTextContent("Admin");
    expect(roles).toHaveTextContent("Simulation reviewer");
    expect(within(row).getByTestId("advisor-more-roles")).toHaveTextContent("+2");
    expect(within(row).getByTestId("advisor-more-roles")).toHaveAttribute(
      "title",
      "Scribe reviewer, Learner",
    );
    expect(within(row).queryByTestId("advisor-incomplete")).toBeNull();
  });

  it("says when there are no advisors yet", () => {
    h.list.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<ClinicalAdvisors />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent("No clinical advisors yet");
  });

  it("removes an advisor after confirming, and shows ally-be's reason when it can't", async () => {
    render(<ClinicalAdvisors />);
    const removeButton = () =>
      within(screen.getByTestId("advisor-row")).getByRole("button", { name: "Remove" });
    fireEvent.click(removeButton());
    expect(screen.getByTestId("confirmation-description")).toHaveTextContent(
      "Remove Dr. Mehta as a clinical advisor? They keep their other roles.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove advisor" }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Dr. Mehta is no longer a clinical advisor"),
    );

    h.remove.mockReturnValue(rejects("This person has no other role; give them one first"));
    fireEvent.click(removeButton());
    fireEvent.click(screen.getByRole("button", { name: "Remove advisor" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "This person has no other role; give them one first",
      ),
    );
  });

  it("searches after 3 letters, then adds a match after confirming with their current roles", async () => {
    const match = person({
      userId: 2,
      name: "Asha Rao",
      roles: ["ADMIN"],
      advisor: false,
      signOff: false,
    });
    h.search.mockImplementation((q: string, { skip }: { skip: boolean }) =>
      skip ? { data: undefined } : { data: q === "ash" ? [match] : [], isError: false },
    );
    render(<ClinicalAdvisors />);
    fireEvent.click(screen.getByRole("button", { name: "Add an advisor" }));
    const box = screen.getByRole("searchbox", { name: "Find a person by name or email" });
    fireEvent.change(box, { target: { value: "as" } });
    await new Promise(r => setTimeout(r, 350));
    expect(screen.queryByTestId("advisor-match")).toBeNull();
    expect(h.search).not.toHaveBeenCalledWith("as", { skip: false });

    fireEvent.change(box, { target: { value: "ash" } });
    const found = await screen.findByTestId("advisor-match");
    expect(found).toHaveTextContent("Asha Rao");
    expect(found).toHaveTextContent("Sangath");
    expect(found).toHaveTextContent("Admin");
    fireEvent.click(within(found).getByRole("button", { name: "Add" }));
    expect(screen.getByTestId("confirmation-description")).toHaveTextContent(
      "Make Asha Rao a clinical advisor? They keep their current roles: Admin.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Make advisor" }));
    await waitFor(() => expect(h.add).toHaveBeenCalledWith(2));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Asha Rao is now a clinical advisor"),
    );
    // The panel closes after adding.
    await waitFor(() => expect(screen.queryByTestId("advisor-add-panel")).toBeNull());
  });

  it("marks a match who is already a full advisor instead of offering Add", async () => {
    h.search.mockImplementation((_q: string, { skip }: { skip: boolean }) =>
      skip ? { data: undefined } : { data: [person()], isError: false },
    );
    render(<ClinicalAdvisors />);
    fireEvent.click(screen.getByRole("button", { name: "Add an advisor" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "meh" } });
    const found = await screen.findByTestId("advisor-match");
    expect(found).toHaveTextContent("Already an advisor");
    expect(within(found).queryByRole("button", { name: "Add" })).toBeNull();
  });

  it.each([
    [{ advisor: true, signOff: false }, "Needs the advisor's console access"],
    [{ advisor: false, signOff: true }, "Has console access but not the advisor role"],
  ])("tags incomplete access (%o) and Fix access adds the missing half", async (over, words) => {
    h.list.mockReturnValue({ data: [person(over)], isLoading: false, isError: false });
    render(<ClinicalAdvisors />);
    const row = screen.getByTestId("advisor-row");
    expect(within(row).getByTestId("advisor-incomplete")).toHaveTextContent(words);
    fireEvent.click(within(row).getByRole("button", { name: "Fix access" }));
    fireEvent.click(screen.getByRole("button", { name: "Make advisor" }));
    await waitFor(() => expect(h.add).toHaveBeenCalledWith(1));
  });
});
