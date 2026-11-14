import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
  addAdvisor: vi.fn(),
  removeAdvisor: vi.fn(),
  addOwner: vi.fn(),
  removeOwner: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useListClinicalAdvisorsQuery: () => h.list(),
  useSearchClinicalAdvisorCandidatesQuery: (q: string, opts: { skip: boolean }) =>
    h.search(q, opts),
  useAddClinicalAdvisorMutation: () => [h.addAdvisor],
  useRemoveClinicalAdvisorMutation: () => [h.removeAdvisor],
  useAddDebriefOwnerMutation: () => [h.addOwner],
  useRemoveDebriefOwnerMutation: () => [h.removeOwner],
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
import { DebriefAccess } from "../DebriefAccess";
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
  owner: false,
  signOff: true,
  ...over,
});

const listOf = (...people: unknown[]) =>
  h.list.mockReturnValue({ data: people, isLoading: false, isError: false });

/** Opens a row's More menu and returns the item names it offers. */
const openMore = (row: HTMLElement) => {
  fireEvent.click(within(row).getByRole("button", { name: "More actions" }));
  return within(row)
    .getAllByRole("menuitem")
    .map(i => i.textContent);
};

describe("User Management › Debrief access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOf(person());
    h.search.mockReturnValue({ data: undefined, isError: false });
    for (const m of [h.addAdvisor, h.removeAdvisor, h.addOwner, h.removeOwner])
      m.mockReturnValue(resolves(person()));
  });

  it("explains the two roles and lists people with their debrief roles and other roles", () => {
    listOf(
      person(),
      person({
        userId: 2,
        name: "Priya",
        roles: ["CLINICAL_ADVISOR", "DEBRIEF_OWNER"],
        owner: true,
      }),
    );
    render(<DebriefAccess />);
    expect(screen.getByTestId("debrief-access")).toHaveTextContent(
      "People who review or run debriefs across every organisation.",
    );
    const [mehta, priya] = screen.getAllByTestId("access-row");
    expect(within(mehta).getByTestId("access-debrief-roles")).toHaveTextContent("Clinical advisor");
    const roles = within(mehta).getByTestId("access-roles");
    // Neither debrief role counts as an "other" role.
    expect(roles).not.toHaveTextContent("Clinical advisor");
    expect(roles).toHaveTextContent("Admin");
    expect(roles).toHaveTextContent("Simulation reviewer");
    expect(within(mehta).getByTestId("access-roles-more")).toHaveTextContent("+2");
    expect(within(mehta).getByTestId("access-roles-more")).toHaveAttribute(
      "title",
      "Scribe reviewer, Learner",
    );
    expect(within(mehta).queryByTestId("access-incomplete")).toBeNull();

    const both = within(priya).getByTestId("access-debrief-roles");
    expect(both).toHaveTextContent("Clinical advisor");
    expect(both).toHaveTextContent("Debrief owner");
    expect(within(priya).getByTestId("access-roles")).toHaveTextContent("None");
  });

  it("offers only the role changes that apply, in More", () => {
    listOf(person(), person({ userId: 2, advisor: false, owner: true }));
    render(<DebriefAccess />);
    const [advisor, owner] = screen.getAllByTestId("access-row");
    expect(openMore(advisor)).toEqual(["Remove clinical advisor", "Make Debrief owner"]);
    expect(openMore(owner)).toEqual(["Make clinical advisor", "Remove Debrief owner"]);
  });

  it("says when no one has debrief access yet", () => {
    listOf();
    render(<DebriefAccess />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent("No one has debrief access yet");
  });

  it("makes someone the Debrief owner after confirming, naming the roles they keep", async () => {
    render(<DebriefAccess />);
    const row = screen.getByTestId("access-row");
    openMore(row);
    fireEvent.click(within(row).getByRole("menuitem", { name: "Make Debrief owner" }));
    expect(screen.getByTestId("confirmation-description")).toHaveTextContent(
      "Make Dr. Mehta the Debrief owner? They keep their current roles: Admin, Simulation reviewer, Scribe reviewer, Learner.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Make Debrief owner" }));
    await waitFor(() => expect(h.addOwner).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Dr. Mehta is now the Debrief owner"),
    );
    expect(h.addAdvisor).not.toHaveBeenCalled();
  });

  it("removes the Debrief owner after confirming", async () => {
    listOf(person({ owner: true }));
    render(<DebriefAccess />);
    const row = screen.getByTestId("access-row");
    openMore(row);
    fireEvent.click(within(row).getByRole("menuitem", { name: "Remove Debrief owner" }));
    expect(screen.getByTestId("confirmation-description")).toHaveTextContent(
      "Remove Debrief owner from Dr. Mehta? They keep their other roles.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Debrief owner" }));
    await waitFor(() => expect(h.removeOwner).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Dr. Mehta is no longer the Debrief owner"),
    );
  });

  it("removes a clinical advisor after confirming, and shows ally-be's reason when it can't", async () => {
    render(<DebriefAccess />);
    const remove = () => {
      const row = screen.getByTestId("access-row");
      openMore(row);
      fireEvent.click(within(row).getByRole("menuitem", { name: "Remove clinical advisor" }));
    };
    remove();
    expect(screen.getByTestId("confirmation-description")).toHaveTextContent(
      "Remove Dr. Mehta as a clinical advisor? They keep their other roles.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove clinical advisor" }));
    await waitFor(() => expect(h.removeAdvisor).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("Dr. Mehta is no longer a clinical advisor"),
    );

    h.removeAdvisor.mockReturnValue(rejects("This person has no other role; give them one first"));
    remove();
    fireEvent.click(screen.getByRole("button", { name: "Remove clinical advisor" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "This person has no other role; give them one first",
      ),
    );
  });

  it("searches after 3 letters, then adds a match as clinical advisor or Debrief owner", async () => {
    const match = person({
      userId: 2,
      name: "Asha Rao",
      roles: ["ADMIN"],
      advisor: false,
      owner: false,
      signOff: false,
    });
    h.search.mockImplementation((q: string, { skip }: { skip: boolean }) =>
      skip ? { data: undefined } : { data: q === "ash" ? [match] : [], isError: false },
    );
    render(<DebriefAccess />);
    fireEvent.click(screen.getByRole("button", { name: "Add a person" }));
    const box = screen.getByRole("searchbox", { name: "Find a person by name or email" });
    fireEvent.change(box, { target: { value: "as" } });
    await new Promise(r => setTimeout(r, 350));
    expect(screen.queryByTestId("access-match")).toBeNull();
    expect(h.search).not.toHaveBeenCalledWith("as", { skip: false });

    fireEvent.change(box, { target: { value: "ash" } });
    const found = await screen.findByTestId("access-match");
    expect(found).toHaveTextContent("Asha Rao");
    expect(found).toHaveTextContent("Sangath");
    expect(found).toHaveTextContent("Admin");
    fireEvent.click(within(found).getByRole("button", { name: "Add…" }));
    expect(
      within(found)
        .getAllByRole("menuitem")
        .map(i => i.textContent),
    ).toEqual(["Add as clinical advisor", "Add as Debrief owner"]);
    fireEvent.click(within(found).getByRole("menuitem", { name: "Add as Debrief owner" }));
    expect(screen.getByTestId("confirmation-description")).toHaveTextContent(
      "Make Asha Rao the Debrief owner? They keep their current roles: Admin.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Make Debrief owner" }));
    await waitFor(() => expect(h.addOwner).toHaveBeenCalledWith(2));
    // The panel closes after adding.
    await waitFor(() => expect(screen.queryByTestId("access-add-panel")).toBeNull());
  });

  it("offers a match only the role they lack, and none when they hold both", async () => {
    const advisorOnly = person({ userId: 3, name: "Advisor Only" });
    const both = person({ userId: 4, name: "Both Roles", owner: true });
    h.search.mockImplementation((_q: string, { skip }: { skip: boolean }) =>
      skip ? { data: undefined } : { data: [advisorOnly, both], isError: false },
    );
    render(<DebriefAccess />);
    fireEvent.click(screen.getByRole("button", { name: "Add a person" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "rol" } });
    const [first, second] = await screen.findAllByTestId("access-match");
    fireEvent.click(within(first).getByRole("button", { name: "Add…" }));
    expect(
      within(first)
        .getAllByRole("menuitem")
        .map(i => i.textContent),
    ).toEqual(["Add as Debrief owner"]);
    expect(second).toHaveTextContent("Has both debrief roles");
    expect(within(second).queryByRole("button", { name: "Add…" })).toBeNull();
  });

  it.each([
    [{ advisor: true, signOff: false }, "Needs the debrief console access", "addAdvisor"],
    [
      { advisor: false, owner: true, signOff: false },
      "Needs the debrief console access",
      "addOwner",
    ],
    [
      { advisor: false, owner: false, signOff: true },
      "Has console access but no debrief role",
      "addAdvisor",
    ],
  ] as const)(
    "tags incomplete access (%o) and Fix access adds the right role",
    async (over, words, hook) => {
      listOf(person(over));
      render(<DebriefAccess />);
      const row = screen.getByTestId("access-row");
      expect(within(row).getByTestId("access-incomplete")).toHaveTextContent(words);
      fireEvent.click(within(row).getByRole("button", { name: "Fix access" }));
      fireEvent.click(
        screen.getByRole("button", {
          name: hook === "addOwner" ? "Make Debrief owner" : "Make clinical advisor",
        }),
      );
      await waitFor(() => expect(h[hook]).toHaveBeenCalledWith(1));
    },
  );
});
