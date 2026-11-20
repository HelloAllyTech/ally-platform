import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LANDING_COPY } from "../landingCopy";
import { LandingPage1 } from "../LandingPage1";

const renderPage = (path = "/landingpage1") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/landingpage1/*" element={<LandingPage1 />} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("LandingPage1 prototype", () => {
  it("shows English first, with the helpline and all three blocks", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(LANDING_COPY.en.heading);
    expect(screen.getByText(LANDING_COPY.en.helpline)).toBeTruthy();
    expect(screen.getByText(LANDING_COPY.en.courses.name)).toBeTruthy();
    expect(screen.getByText(LANDING_COPY.en.practice.name)).toBeTruthy();
    expect(screen.getByText(LANDING_COPY.en.resources.name)).toBeTruthy();
  });

  it("lists conversation practice first, then courses, then resources", () => {
    const { container } = renderPage();
    const names = Array.from(container.querySelectorAll(".lp1-card-name")).map(
      el => el.textContent,
    );
    expect(names).toEqual([
      LANDING_COPY.en.practice.name,
      LANDING_COPY.en.courses.name,
      LANDING_COPY.en.resources.name,
    ]);
  });

  it("shows the quote carousel between the heading and the blocks", () => {
    const { container } = renderPage();
    const carousel = screen.getByRole("region", { name: LANDING_COPY.en.quotesLabel });
    const options = container.querySelector(".lp1-options") as HTMLElement;
    expect(screen.getAllByRole("listitem")).toHaveLength(LANDING_COPY.en.quotes.length);
    expect(
      carousel.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: LANDING_COPY.en.quotesPrevious })).toBeDisabled();
  });

  it("moves to the next quote", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: LANDING_COPY.en.quotesNext }));
    expect(screen.getByRole("button", { name: LANDING_COPY.en.quotesPrevious })).toBeEnabled();
  });

  it("offers log in, and no sign up, in the header", () => {
    renderPage();
    expect(screen.getByRole("button", { name: LANDING_COPY.en.logIn })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign up/i })).toBeNull();
  });

  it("shows the Ally logo in the footer", () => {
    renderPage();
    expect(screen.getByRole("img", { name: "Ally" })).toBeTruthy();
  });

  it("puts the Ally logo bottom left and the ElevenLabs logo bottom right", () => {
    renderPage();
    const ally = screen.getByRole("img", { name: "Ally" });
    const eleven = screen.getByRole("img", { name: "ElevenLabs" });
    expect(ally.parentElement).toBe(eleven.parentElement);
    expect(ally.compareDocumentPosition(eleven) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens a login drawer with email and mobile options", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: LANDING_COPY.en.login.title }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("tab", { name: LANDING_COPY.en.login.emailTab })).toBeTruthy();
    expect(screen.getByRole("tab", { name: LANDING_COPY.en.login.mobileTab })).toBeTruthy();
    expect(screen.getByLabelText(LANDING_COPY.en.login.emailLabel)).toBeTruthy();
  });

  it("switches the drawer to mobile and checks the number", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: LANDING_COPY.en.login.title }));
    await user.click(screen.getByRole("tab", { name: LANDING_COPY.en.login.mobileTab }));
    await user.type(screen.getByLabelText(LANDING_COPY.en.login.mobileLabel), "12345");
    await user.click(screen.getByRole("button", { name: LANDING_COPY.en.login.sendCode }));
    expect(screen.getByRole("alert").textContent).toBe(LANDING_COPY.en.login.mobileError);
    await user.type(screen.getByLabelText(LANDING_COPY.en.login.mobileLabel), "67890");
    await user.click(screen.getByRole("button", { name: LANDING_COPY.en.login.sendCode }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(LANDING_COPY.en.login.prototypeNote);
  });

  it("closes the login drawer with Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: LANDING_COPY.en.login.title }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("switches to Hindi", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Toggle options" }));
    await user.click(screen.getByRole("option", { name: "हिन्दी" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(LANDING_COPY.hi.heading);
  });

  it("links each block to its own page", () => {
    renderPage();
    expect(
      screen.getByRole("link", { name: new RegExp(LANDING_COPY.en.practice.name) }),
    ).toHaveAttribute("href", "/landingpage1/practice");
    expect(
      screen.getByRole("link", { name: new RegExp(LANDING_COPY.en.courses.name) }),
    ).toHaveAttribute("href", "/landingpage1/courses");
    expect(
      screen.getByRole("link", { name: new RegExp(LANDING_COPY.en.resources.name) }),
    ).toHaveAttribute("href", "/landingpage1/resources");
  });

  it("opens a block's page with breadcrumbs back to the landing page", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("link", { name: new RegExp(LANDING_COPY.en.courses.name) }));
    const crumbs = screen.getByRole("navigation", { name: LANDING_COPY.en.breadcrumbLabel });
    expect(crumbs.textContent).toContain(LANDING_COPY.en.breadcrumbHome);
    expect(crumbs.textContent).toContain(LANDING_COPY.en.courses.name);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      LANDING_COPY.en.courses.name,
    );
    await user.click(screen.getByRole("link", { name: LANDING_COPY.en.breadcrumbHome }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(LANDING_COPY.en.heading);
  });

  it("keeps the chosen language when moving to a block's page", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Toggle options" }));
    await user.click(screen.getByRole("option", { name: "हिन्दी" }));
    await user.click(screen.getByRole("link", { name: new RegExp(LANDING_COPY.hi.practice.name) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      LANDING_COPY.hi.practice.name,
    );
    expect(
      screen.getByRole("navigation", { name: LANDING_COPY.hi.breadcrumbLabel }).textContent,
    ).toContain(LANDING_COPY.hi.breadcrumbHome);
  });

  it("sends an unknown block page back to the landing page", () => {
    renderPage("/landingpage1/nope");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(LANDING_COPY.en.heading);
  });

  it("links the login drawer to the existing terms and privacy pages", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: LANDING_COPY.en.login.title }));
    expect(screen.getByRole("link", { name: LANDING_COPY.en.login.termsLink })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: LANDING_COPY.en.login.privacyLink })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
