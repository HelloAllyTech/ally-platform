import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LandingPageFormDialog } from "../LandingPageFormDialog";
import { LandingPageFormValues } from "../landingPageForm";

vi.mock("../../../api/userManagement", () => ({
  useGetTenantsQuery: () => ({
    data: { data: [{ id: "t1", name: "Agatsu Foundation", code: "agatsu" }] },
  }),
}));

const initial = (): LandingPageFormValues => ({
  tenantId: "t1",
  name: "Campaign",
  slug: "campaign",
  languages: ["en"],
  defaultLanguage: "en",
  signUpEnabled: false,
});

const renderSettings = (
  onSubmit = vi.fn(),
  overrides: Partial<Parameters<typeof LandingPageFormDialog>[0]> = {},
) => {
  render(
    <LandingPageFormDialog
      open
      mode="settings"
      initial={initial()}
      tenantLabel="Agatsu Foundation"
      tenantCode="agatsu"
      onClose={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return onSubmit;
};

const submit = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

describe("LandingPageFormDialog", () => {
  it("shows the organization, not a picker, in settings", () => {
    renderSettings();
    expect(screen.getByText("Agatsu Foundation")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search organizations")).toBeNull();
  });

  it("shows the address as visitors will type it", () => {
    renderSettings();
    expect(screen.getByText("Visitors open /agatsu/campaign")).toBeTruthy();
  });

  it("submits the values, with the name trimmed", () => {
    const onSubmit = renderSettings();
    fireEvent.change(screen.getByLabelText("Page name"), { target: { value: "  New name  " } });
    submit("Save settings");
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New name", slug: "campaign" }),
    );
  });

  it("keeps the address as it is when the name changes, in settings", () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Page name"), { target: { value: "Something else" } });
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("campaign");
  });

  it("makes the address from the name in create, until the address is edited by hand", () => {
    render(<LandingPageFormDialog open mode="create" onClose={vi.fn()} onSubmit={vi.fn()} />);
    const name = screen.getByLabelText("Page name");
    const address = screen.getByLabelText("Address") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Baat Se Baat" } });
    expect(address.value).toBe("baat-se-baat");
    fireEvent.change(address, { target: { value: "my-own" } });
    fireEvent.change(name, { target: { value: "Baat Se Baat Banegi" } });
    expect(address.value).toBe("my-own");
  });

  it("will not create without an organization, and says why", () => {
    const onSubmit = vi.fn();
    render(<LandingPageFormDialog open mode="create" onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Page name"), { target: { value: "Campaign" } });
    submit("Create page");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Choose an organization")).toBeTruthy();
  });

  it("will not save a name or address that is empty or malformed", () => {
    const onSubmit = renderSettings();
    fireEvent.change(screen.getByLabelText("Page name"), { target: { value: " " } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Bad Address!" } });
    submit("Save settings");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Give the page a name")).toBeTruthy();
    expect(screen.getByText("Use lowercase letters, digits and single hyphens")).toBeTruthy();
  });

  it("needs at least one language", () => {
    const onSubmit = renderSettings();
    fireEvent.click(screen.getByLabelText("English (English)"));
    submit("Save settings");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Choose at least one language")).toBeTruthy();
  });

  it("offers an 'opens in' choice only with more than one language, and keeps it valid", () => {
    const onSubmit = renderSettings();
    expect(screen.queryByLabelText("Opens in")).toBeNull();
    fireEvent.click(screen.getByLabelText("Hindi (हिन्दी)"));
    const opensIn = screen.getByLabelText("Opens in") as HTMLSelectElement;
    expect(
      within(opensIn)
        .getAllByRole("option")
        .map(option => option.textContent),
    ).toEqual(["English", "Hindi"]);
    fireEvent.change(opensIn, { target: { value: "hi" } });
    fireEvent.click(screen.getByLabelText("English (English)"));
    submit("Save settings");
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ languages: ["hi"], defaultLanguage: "hi" }),
    );
  });

  it("stores the sign-up switch, and says it does nothing visible yet", () => {
    const onSubmit = renderSettings();
    expect(screen.getByText(/isn't built yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch"));
    submit("Save settings");
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ signUpEnabled: true }));
  });

  it("shows an error from the server, such as an address already taken", () => {
    renderSettings(vi.fn(), {
      serverError: "This organization already has a landing page with that address",
    });
    expect(screen.getByText(/already has a landing page with that address/)).toBeTruthy();
  });
});
