import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

const h = vi.hoisted(() => ({
  profile: vi.fn(),
  crisis: vi.fn(),
  saveProfile: vi.fn(),
  saveCrisis: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  access: { current: { canEditOrg: true, canViewOrg: true } as Record<string, boolean> },
}));

vi.mock("@ally-ui-mono/ui-shared", async () => (await import("./uiSharedFakes")).uiSharedFakes);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideOrgProfileQuery: () => h.profile(),
  useGetAllyGuideOrgCrisisResponsesQuery: () => h.crisis(),
  useSaveAllyGuideOrgProfileMutation: () => [h.saveProfile, { isLoading: false }],
  useSaveAllyGuideOrgCrisisResponseMutation: () => [h.saveCrisis],
}));

// eslint-disable-next-line import/first
import { AllyOrgTab } from "../AllyOrgTab";

const TENANT = "tenant-uuid-1";

const PROFILE = {
  tenantId: TENANT,
  version: 4,
  updatedBy: 7,
  updatedAt: "2026-10-21T08:00:00.000Z",
  profile: {
    supportLines: {
      en: [
        {
          name: "Acme helpline",
          phone: "+91 98765 43210",
          hours: "9 to 6",
          url: "https://acme.org/help",
          isCrisis: true,
        },
        { name: "Front desk", phone: "080 2222 3333", hours: null, url: null, isCrisis: false },
      ],
    },
    supervisorContact: "Dr Rao",
    supervisorWording: "Please talk to your clinical supervisor.",
    protocols: "Follow the disclosure protocol.",
    toneNotes: "Warm and plain.",
    avoidTopics: ["politics", "religion"],
    outreachEnabled: false,
    emailEnabled: true,
  },
};

const loaded = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
  ...extra,
});

const renderTab = () =>
  render(
    <Provider store={configureStore({ reducer: { user: () => ({ user: { id: 7 } }) } })}>
      <AllyOrgTab tenantId={TENANT} />
    </Provider>,
  );

const saveBar = () => screen.getByTestId("ally-org-save-bar");
const field = (label: string) => screen.getByLabelText(label);

describe("AllyOrgTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEditOrg: true, canViewOrg: true };
    h.profile.mockReturnValue(loaded(PROFILE));
    h.crisis.mockReturnValue(loaded([]));
    h.saveProfile.mockReturnValue({ unwrap: () => Promise.resolve(PROFILE) });
    h.saveCrisis.mockReturnValue({ unwrap: () => Promise.resolve({ version: 1 }) });
  });

  describe("what it shows", () => {
    it("fills every field from the saved profile", () => {
      renderTab();

      expect(field("Supervisor contact")).toHaveValue("Dr Rao");
      expect(field("How Ally refers to the supervisor")).toHaveValue(
        "Please talk to your clinical supervisor.",
      );
      expect(field("Protocols")).toHaveValue("Follow the disclosure protocol.");
      expect(field("Tone notes")).toHaveValue("Warm and plain.");
      const topics = screen.getByTestId("ally-org-avoid-list");
      expect(within(topics).getByText("politics")).toBeInTheDocument();
      expect(within(topics).getByText("religion")).toBeInTheDocument();
    });

    it("lists the English support lines with name, phone, hours, link and the crisis flag", () => {
      renderTab();

      const lines = screen.getAllByTestId("support-line-row");
      expect(lines).toHaveLength(2);
      expect(within(lines[0]).getByLabelText("Name")).toHaveValue("Acme helpline");
      expect(within(lines[0]).getByLabelText("Phone")).toHaveValue("+91 98765 43210");
      expect(within(lines[0]).getByLabelText("Hours")).toHaveValue("9 to 6");
      expect(within(lines[0]).getByLabelText("Link")).toHaveValue("https://acme.org/help");
      expect(within(lines[0]).getByLabelText("Crisis line")).toBeChecked();
      expect(within(lines[1]).getByLabelText("Crisis line")).not.toBeChecked();
    });

    it("shows the version, who saved it, and the two outreach switches as saved", () => {
      renderTab();

      expect(screen.getByTestId("ally-org-version")).toHaveTextContent("Version 4 · saved by you");
      expect(
        within(screen.getByLabelText("Ally may reach out").parentElement as HTMLElement).getByRole(
          "switch",
        ),
      ).not.toBeChecked();
      expect(screen.getByLabelText("Reach out by email")).toBeDisabled();
    });

    it("says an organisation that has never saved a profile uses the platform defaults", () => {
      h.profile.mockReturnValue(
        loaded({ tenantId: TENANT, version: 0, profile: {}, updatedBy: null, updatedAt: null }),
      );
      renderTab();

      expect(screen.getByTestId("ally-org-version")).toHaveTextContent(
        "Never saved. Ally uses the platform defaults",
      );
      expect(screen.getByTestId("support-lines-empty")).toBeInTheDocument();
    });

    it("keeps the whole profile's save apart from the crisis messages, and says so", () => {
      renderTab();

      expect(
        screen.getByText(/saved one language at a time, separately from the rest of this profile/),
      ).toBeInTheDocument();
    });
  });

  describe("saving the profile", () => {
    it("offers a save only once something has changed", () => {
      renderTab();

      expect(within(saveBar()).getByRole("button", { name: "Save profile" })).toBeDisabled();
      expect(within(saveBar()).getByText("Everything is saved.")).toBeInTheDocument();

      fireEvent.change(field("Supervisor contact"), { target: { value: "Dr Iyer" } });

      expect(within(saveBar()).getByRole("button", { name: "Save profile" })).toBeEnabled();
      expect(within(saveBar()).getByText("You have unsaved changes.")).toBeInTheDocument();
    });

    it("sends the WHOLE profile for this organisation, with the edit applied and everything else kept", async () => {
      renderTab();

      fireEvent.change(field("Supervisor contact"), { target: { value: "Dr Iyer" } });
      fireEvent.click(within(saveBar()).getByRole("button", { name: "Save profile" }));

      await waitFor(() => expect(h.saveProfile).toHaveBeenCalledTimes(1));
      expect(h.saveProfile).toHaveBeenCalledWith({
        tenantId: TENANT,
        profile: {
          supportLines: {
            en: [
              {
                name: "Acme helpline",
                phone: "+91 98765 43210",
                hours: "9 to 6",
                url: "https://acme.org/help",
                isCrisis: true,
              },
              {
                name: "Front desk",
                phone: "080 2222 3333",
                hours: null,
                url: null,
                isCrisis: false,
              },
            ],
          },
          supervisorContact: "Dr Iyer",
          supervisorWording: "Please talk to your clinical supervisor.",
          protocols: "Follow the disclosure protocol.",
          toneNotes: "Warm and plain.",
          avoidTopics: ["politics", "religion"],
          // Sent even though untouched: the server replaces the profile and resets an omitted flag to on.
          outreachEnabled: false,
          emailEnabled: true,
        },
      });
      expect(h.toastSuccess).toHaveBeenCalledWith("Ally profile saved.");
    });

    it("saves a support line added for another language", async () => {
      renderTab();

      fireEvent.click(
        within(screen.getByTestId("support-lines-switcher")).getByRole("button", { name: "Hindi" }),
      );
      expect(screen.getByTestId("support-lines-empty")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Add support line" }));
      const row = screen.getByTestId("support-line-row");
      fireEvent.change(within(row).getByLabelText("Name"), { target: { value: "Hindi line" } });
      fireEvent.change(within(row).getByLabelText("Phone"), {
        target: { value: "+91 11111 11111" },
      });
      fireEvent.click(within(row).getByLabelText("Crisis line"));
      fireEvent.click(within(saveBar()).getByRole("button", { name: "Save profile" }));

      await waitFor(() => expect(h.saveProfile).toHaveBeenCalledTimes(1));
      const sent = h.saveProfile.mock.calls[0][0].profile.supportLines;
      expect(Object.keys(sent).sort()).toEqual(["en", "hi"]);
      expect(sent.hi).toEqual([
        { name: "Hindi line", phone: "+91 11111 11111", hours: null, url: null, isCrisis: true },
      ]);
    });

    it("removes a support line", async () => {
      renderTab();

      fireEvent.click(screen.getByRole("button", { name: "Remove support line 2" }));
      fireEvent.click(within(saveBar()).getByRole("button", { name: "Save profile" }));

      await waitFor(() => expect(h.saveProfile).toHaveBeenCalledTimes(1));
      expect(h.saveProfile.mock.calls[0][0].profile.supportLines.en).toHaveLength(1);
    });

    it("adds and removes a topic to avoid, and refuses a duplicate", async () => {
      renderTab();

      fireEvent.change(field("Topics to avoid"), { target: { value: "Politics" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(screen.getByText("That topic is already listed.")).toBeInTheDocument();

      fireEvent.change(field("Topics to avoid"), { target: { value: "finances" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove religion" }));
      fireEvent.click(within(saveBar()).getByRole("button", { name: "Save profile" }));

      await waitFor(() => expect(h.saveProfile).toHaveBeenCalledTimes(1));
      expect(h.saveProfile.mock.calls[0][0].profile.avoidTopics).toEqual(["politics", "finances"]);
    });

    it("switches outreach on and off through the profile", async () => {
      renderTab();

      fireEvent.click(screen.getByLabelText("Ally may reach out"));
      fireEvent.click(within(saveBar()).getByRole("button", { name: "Save profile" }));

      await waitFor(() => expect(h.saveProfile).toHaveBeenCalledTimes(1));
      expect(h.saveProfile.mock.calls[0][0].profile).toMatchObject({
        outreachEnabled: true,
        emailEnabled: true,
      });
    });

    it("blocks a save with a bad support line, shows what is wrong on the field, and sends nothing", () => {
      renderTab();
      const first = screen.getAllByTestId("support-line-row")[0];

      fireEvent.change(within(first).getByLabelText("Phone"), { target: { value: "call me" } });
      fireEvent.click(within(saveBar()).getByRole("button", { name: "Save profile" }));

      expect(h.saveProfile).not.toHaveBeenCalled();
      expect(within(first).getByRole("alert")).toHaveTextContent("Start with a digit or +");
      expect(
        within(saveBar()).getByText("Fix the highlighted fields to save."),
      ).toBeInTheDocument();
    });

    it("refuses a link that is not http or https", () => {
      renderTab();
      const first = screen.getAllByTestId("support-line-row")[0];

      fireEvent.change(within(first).getByLabelText("Link"), {
        target: { value: "javascript:alert(1)" },
      });
      fireEvent.click(within(saveBar()).getByRole("button", { name: "Save profile" }));

      expect(h.saveProfile).not.toHaveBeenCalled();
      expect(within(first).getByRole("alert")).toHaveTextContent(
        "must start with http:// or https://",
      );
    });

    it("does not call a brand-new empty line an error until it has been touched or a save attempted", () => {
      renderTab();

      fireEvent.click(screen.getByRole("button", { name: "Add support line" }));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the server's reason when it refuses the save, and keeps the edit", async () => {
      h.saveProfile.mockReturnValue({
        unwrap: () =>
          Promise.reject({ status: 400, data: { message: '"abc" is not a phone number' } }),
      });
      renderTab();
      fireEvent.change(field("Supervisor contact"), { target: { value: "Dr Iyer" } });

      fireEvent.click(within(saveBar()).getByRole("button", { name: "Save profile" }));

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('"abc" is not a phone number'));
      expect(field("Supervisor contact")).toHaveValue("Dr Iyer");
    });

    it("discards the edits back to what is saved", () => {
      renderTab();
      fireEvent.change(field("Supervisor contact"), { target: { value: "Dr Iyer" } });

      fireEvent.click(within(saveBar()).getByRole("button", { name: "Discard changes" }));

      expect(field("Supervisor contact")).toHaveValue("Dr Rao");
      expect(within(saveBar()).getByRole("button", { name: "Save profile" })).toBeDisabled();
    });
  });

  describe("the organisation's own crisis copy", () => {
    const MESSAGE = "Our counsellors are here for you. Please call the number below straight away.";

    it("saves a language through the organisation route, with this organisation named, after sign-off", async () => {
      renderTab();
      const english = screen.getByTestId("crisis-copy-en");

      fireEvent.change(within(english).getByRole("textbox"), { target: { value: MESSAGE } });
      fireEvent.click(within(english).getByRole("button", { name: "Save new version…" }));
      fireEvent.click(screen.getByLabelText("A clinician has approved this exact text"));
      fireEvent.click(screen.getByRole("button", { name: "Save version" }));

      await waitFor(() =>
        expect(h.saveCrisis).toHaveBeenCalledWith({
          tenantId: TENANT,
          languageCode: "en",
          body: MESSAGE,
        }),
      );
      // The profile was not saved by it.
      expect(h.saveProfile).not.toHaveBeenCalled();
    });

    it("has no way to withdraw a version: the organisation layer has no such route", () => {
      h.crisis.mockReturnValue(
        loaded([
          {
            id: "c1",
            scope: "tenant",
            tenantId: TENANT,
            languageCode: "en",
            body: MESSAGE,
            version: 1,
            active: true,
            approvedBy: 7,
            approvedAt: null,
          },
        ]),
      );
      renderTab();

      expect(screen.getByTestId("crisis-copy-en-meta")).toHaveTextContent("Version 1");
      expect(screen.queryByRole("button", { name: "Withdraw…" })).not.toBeInTheDocument();
    });

    it("previews the card with the support lines as currently drafted, unsaved ones included", () => {
      renderTab();
      fireEvent.change(
        screen.getAllByTestId("support-line-row")[0].querySelector("input") as HTMLInputElement,
        {
          target: { value: "Renamed helpline" },
        },
      );

      fireEvent.click(
        within(screen.getByTestId("crisis-copy-en")).getByRole("button", {
          name: "Preview the card",
        }),
      );

      const preview = within(screen.getByTestId("crisis-copy-en")).getByTestId(
        "crisis-card-preview",
      );
      expect(within(preview).getByText(/Renamed helpline/)).toBeInTheDocument();
      // Crisis lines first, and 112 always present.
      const lines = within(preview).getAllByTestId("crisis-preview-line");
      expect(lines[0]).toHaveTextContent("Renamed helpline");
      expect(within(preview).getByText("112")).toBeInTheDocument();
    });

    it("shows one language at a time behind a switcher, English first", () => {
      renderTab();

      expect(screen.getByTestId("crisis-copy-en")).toBeVisible();
      expect(screen.getByTestId("crisis-copy-hi").parentElement).toHaveAttribute("hidden");

      fireEvent.click(
        within(screen.getByTestId("crisis-language-switcher")).getByRole("button", {
          name: "Hindi",
        }),
      );

      expect(screen.getByTestId("crisis-copy-hi").parentElement).not.toHaveAttribute("hidden");
      expect(screen.getByTestId("crisis-copy-en").parentElement).toHaveAttribute("hidden");
    });

    it("marks on the switcher which languages already have copy, and which version", () => {
      h.crisis.mockReturnValue(
        loaded([
          {
            id: "c1",
            scope: "tenant",
            tenantId: TENANT,
            languageCode: "hi",
            body: "x".repeat(60),
            version: 2,
            active: true,
            approvedBy: 7,
            approvedAt: null,
          },
        ]),
      );
      renderTab();

      const switcher = within(screen.getByTestId("crisis-language-switcher"));
      expect(switcher.getByRole("button", { name: "Hindi · v2" })).toBeInTheDocument();
      expect(switcher.getByRole("button", { name: "English" })).toBeInTheDocument();
    });

    it("keeps a half-written message in one language while another is looked at", () => {
      renderTab();
      const switcher = within(screen.getByTestId("crisis-language-switcher"));
      fireEvent.change(within(screen.getByTestId("crisis-copy-en")).getByRole("textbox"), {
        target: { value: "A draft that is not saved yet, long enough to count as written." },
      });

      fireEvent.click(switcher.getByRole("button", { name: "Hindi" }));
      fireEvent.click(switcher.getByRole("button", { name: "English" }));

      expect(within(screen.getByTestId("crisis-copy-en")).getByRole("textbox")).toHaveValue(
        "A draft that is not saved yet, long enough to count as written.",
      );
    });

    it("sits after the profile it is saved apart from, so the profile's save bar does not follow into it", () => {
      renderTab();

      const profile = screen.getByTestId("ally-org-profile");
      const crisis = screen.getByTestId("crisis-language-switcher");

      expect(profile.contains(screen.getByTestId("ally-org-save-bar"))).toBe(true);
      expect(profile.contains(crisis)).toBe(false);
      expect(
        profile.compareDocumentPosition(crisis) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("tells a language with no lines of its own that the English ones show", () => {
      renderTab();

      fireEvent.click(
        within(screen.getByTestId("crisis-language-switcher")).getByRole("button", {
          name: "Hindi",
        }),
      );
      fireEvent.click(
        within(screen.getByTestId("crisis-copy-hi")).getByRole("button", {
          name: "Preview the card",
        }),
      );

      expect(
        within(screen.getByTestId("crisis-copy-hi")).getByText(
          /No lines for this language, so the English ones show/,
        ),
      ).toBeInTheDocument();
    });

    it("tells a missing crisis list apart from the profile, without losing the profile", () => {
      h.crisis.mockReturnValue(loaded(undefined, { isError: true, error: { status: 500 } }));
      renderTab();

      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      expect(field("Supervisor contact")).toHaveValue("Dr Rao");
    });
  });

  describe("read-only", () => {
    beforeEach(() => {
      h.access.current = { canEditOrg: false, canViewOrg: true };
    });

    it("says so, shows everything, and disables every field", () => {
      renderTab();

      expect(screen.getByText(/View only/)).toBeInTheDocument();
      expect(field("Supervisor contact")).toBeDisabled();
      expect(field("Protocols")).toBeDisabled();
      expect(
        within(screen.getAllByTestId("support-line-row")[0]).getByLabelText("Name"),
      ).toBeDisabled();
      expect(screen.getByLabelText("Ally may reach out")).toBeDisabled();
    });

    it("offers no save, no add and no remove", () => {
      renderTab();

      expect(screen.queryByTestId("ally-org-save-bar")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add support line" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Remove support line 1" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save new version…" })).not.toBeInTheDocument();
    });
  });

  describe("states", () => {
    it("shows a skeleton while the profile loads", () => {
      h.profile.mockReturnValue(loaded(undefined, { isLoading: true }));
      renderTab();

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
    });

    it("tells a failure from an empty profile, and retries", () => {
      const refetch = vi.fn();
      h.profile.mockReturnValue(
        loaded(undefined, { isError: true, error: { status: 500 }, refetch }),
      );
      renderTab();

      expect(
        screen.getByText("Could not load this organisation's Ally profile"),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("explains a refusal in terms of the organisation allowlist, not a generic error", () => {
      h.profile.mockReturnValue(loaded(undefined, { isError: true, error: { status: 403 } }));
      renderTab();

      expect(screen.getByTestId("ally-forbidden")).toHaveTextContent("add it to your allowlist");
    });
  });
});
