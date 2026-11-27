import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { step: string; arg: unknown }[],
  fail: null as string | null,
  current: [] as { key: string; enabled: boolean }[],
}));

const step = vi.hoisted(() => (name: string, result: unknown = {}) => () => [
  (arg: unknown) => {
    h.calls.push({ step: name, arg });
    return {
      unwrap: () =>
        h.fail === name
          ? Promise.reject({ data: { message: `${name} refused` } })
          : Promise.resolve(result),
    };
  },
  { isLoading: false },
]);

vi.mock("@api", () => ({
  useGetFeatureToggleRegistryQuery: () => ({
    data: [
      { key: "users", label: "Users", description: "Users and organisations" },
      { key: "whatsapp_bot", label: "WhatsApp Bot", description: "" },
      { key: "analytics", label: "Analytics", description: "Dashboards" },
    ],
    isLoading: false,
  }),
  useGetUserFeatureTogglesQuery: () => ({ data: h.current }),
  useGetTenantsQuery: () => ({
    data: {
      data: [
        { id: "t-1", name: "Sunrise" },
        { id: "t-ally", name: "Ally" },
      ],
    },
  }),
  useCreateCustomLoginMutation: step("createCustomLogin", { id: 77 }),
  useSetUserFeatureTogglesMutation: step("setToggles"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Sidesteps the @constants ↔ @components circular import under vitest (as SuperAdmins.test does).
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
}));
vi.mock("@components/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid={rest["data-testid"]}>
      {children}
    </button>
  ),
}));

// eslint-disable-next-line import/first
import { CustomLoginPanel } from "../CustomLoginPanel";

const fillIn = () => {
  fireEvent.change(screen.getByTestId("custom-login-name"), { target: { value: "Asha Rao" } });
  fireEvent.change(screen.getByTestId("custom-login-email"), {
    target: { value: "Asha@Clinic.example" },
  });
  fireEvent.change(screen.getByTestId("custom-login-organisation"), {
    target: { value: "t-1" },
  });
};

describe("Create a custom login (A1)", () => {
  beforeEach(() => {
    h.calls = [];
    h.fail = null;
    h.current = [];
  });

  it("offers Assistants first, ticked, and every other feature unticked", () => {
    render(<CustomLoginPanel onClose={vi.fn()} />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0].getAttribute("data-testid")).toBe("custom-login-feature-whatsapp_bot");
    expect(screen.getByText("Assistants")).toBeTruthy();
    expect(boxes.map(b => b.checked)).toEqual([true, false, false]);
  });

  it("No organisation (6b) puts the login in Ally's own organisation", async () => {
    const onClose = vi.fn();
    render(<CustomLoginPanel onClose={onClose} />);
    const select = screen.getByTestId("custom-login-organisation") as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent)).toEqual([
      "Choose an organisation",
      "No organisation",
      "Sunrise",
      "Ally",
    ]);
    fireEvent.change(screen.getByTestId("custom-login-name"), { target: { value: "Asha Rao" } });
    fireEvent.change(screen.getByTestId("custom-login-email"), {
      target: { value: "asha@clinic.example" },
    });
    fireEvent.change(select, { target: { value: "t-ally" } });
    fireEvent.click(screen.getByTestId("custom-login-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.calls[0].arg).toMatchObject({ tenantId: "t-ally" });
  });

  it("creates the custom login in one call (not a platform admin), then sets EVERY toggle to what was ticked", async () => {
    const onClose = vi.fn();
    render(<CustomLoginPanel onClose={onClose} />);
    fillIn();
    fireEvent.click(screen.getByTestId("custom-login-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.calls.map(c => c.step)).toEqual(["createCustomLogin", "setToggles"]);
    expect(h.calls[0].arg).toMatchObject({
      name: "Asha Rao",
      email: "asha@clinic.example",
      tenantId: "t-1",
    });
    expect(h.calls[0].arg).not.toHaveProperty("roles");
    expect(h.calls[1].arg).toEqual({
      userId: 77,
      toggles: [
        { featureKey: "whatsapp_bot", enabled: true },
        { featureKey: "users", enabled: false },
        { featureKey: "analytics", enabled: false },
      ],
    });
  });

  it("says the creation failed, and stops there", async () => {
    h.fail = "createCustomLogin";
    render(<CustomLoginPanel onClose={vi.fn()} />);
    fillIn();
    fireEvent.click(screen.getByTestId("custom-login-save"));
    await waitFor(() => expect(screen.getByTestId("custom-login-problem")).toBeTruthy());
    expect(screen.getByTestId("custom-login-problem").textContent).toContain(
      "Couldn't create the account: createCustomLogin refused",
    );
    expect(h.calls.map(c => c.step)).toEqual(["createCustomLogin"]);
  });

  it("won't create a login that can use nothing", async () => {
    render(<CustomLoginPanel onClose={vi.fn()} />);
    fillIn();
    fireEvent.click(screen.getByTestId("custom-login-feature-whatsapp_bot"));
    fireEvent.click(screen.getByTestId("custom-login-save"));
    await waitFor(() => expect(screen.getByTestId("custom-login-problem")).toBeTruthy());
    expect(h.calls).toEqual([]);
  });

  it("edits what an existing login can use, prefilled, writing every toggle", async () => {
    h.current = [
      { key: "users", enabled: false },
      { key: "whatsapp_bot", enabled: true },
      { key: "analytics", enabled: true },
    ];
    const onClose = vi.fn();
    render(
      <CustomLoginPanel
        edit={{ id: 9, name: "Ravi", email: "ravi@x.example" } as never}
        onClose={onClose}
      />,
    );
    expect(screen.queryByTestId("custom-login-email")).toBeNull();
    const analytics = screen.getByTestId("custom-login-feature-analytics") as HTMLInputElement;
    expect(analytics.checked).toBe(true);
    fireEvent.click(analytics);
    fireEvent.click(screen.getByTestId("custom-login-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.calls).toEqual([
      {
        step: "setToggles",
        arg: {
          userId: 9,
          toggles: [
            { featureKey: "whatsapp_bot", enabled: true },
            { featureKey: "users", enabled: false },
            { featureKey: "analytics", enabled: false },
          ],
        },
      },
    ]);
  });
});
