import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCreateBlankBotDraftMutation: () => [() => ({ unwrap: () => h.create() })],
}));

// eslint-disable-next-line import/first
import { BUILD_COPY } from "../create/copy";
// eslint-disable-next-line import/first
import { OnboardingStart } from "../OnboardingStart";

const renderStart = () =>
  render(
    <React.StrictMode>
      <MemoryRouter initialEntries={["/assistants/new"]}>
        <Routes>
          <Route path="/assistants/new" element={<OnboardingStart />} />
          <Route path="/assistants/new/:id" element={<div>build screen</div>} />
        </Routes>
      </MemoryRouter>
    </React.StrictMode>,
  );

describe("/assistants/new: a blank chatbot at the click", () => {
  beforeEach(() => h.create.mockReset());

  it("creates once, even when the page mounts twice, and opens the build screen on it", async () => {
    h.create.mockResolvedValue({ id: "d1", blank: true, reused: false });
    renderStart();
    expect(await screen.findByText("build screen")).toBeTruthy();
    // StrictMode runs effects twice: one create still (and the server reuses a blank anyway).
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it("says plainly when the builder already holds three empty chatbots, and can retry", async () => {
    h.create.mockRejectedValueOnce({
      status: 403,
      data: { errorCode: "too_many_blanks", message: "x" },
    });
    renderStart();
    expect(await screen.findByText(BUILD_COPY.tooManyBlanks)).toBeTruthy();
    h.create.mockResolvedValueOnce({ id: "d2", blank: true, reused: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.retry }));
    });
    expect(await screen.findByText("build screen")).toBeTruthy();
    expect(h.create).toHaveBeenCalledTimes(2);
  });
});
