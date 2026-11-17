import { describe, expect, it } from "vitest";

import { ROUTES } from "@constants";

import { getRouteMetaPaths, resolveRouteMeta } from "../routeMeta";

describe("resolveRouteMeta", () => {
  it("titles a list page and puts it under its section", () => {
    const meta = resolveRouteMeta(ROUTES.MANAGE_PROMPTS);
    expect(meta.title).toBe("Prompts");
    expect(meta.crumbs).toEqual([{ label: "AI & Languages" }, { label: "Prompts" }]);
    expect(meta.known).toBe(true);
  });

  it("links a detail page back to its list", () => {
    const meta = resolveRouteMeta(ROUTES.EDIT_SIMULATION(42));
    expect(meta.title).toBe("Edit roleplay");
    expect(meta.crumbs).toEqual([
      { label: "Create" },
      { label: "Roleplays", to: ROUTES.SIMULATION_STUDIO },
      { label: "Edit roleplay" },
    ]);
  });

  it("matches static paths before :param ones", () => {
    expect(resolveRouteMeta(ROUTES.BUILDER_SETTINGS).title).toBe("Settings");
    expect(resolveRouteMeta(ROUTES.BUILDER_SESSION("abc")).title).toBe("Session");
    expect(resolveRouteMeta(ROUTES.CHATBOT_NEW).title).toBe("New assistant");
    expect(resolveRouteMeta("/assistants/bot-1").title).toBe("Assistant");
  });

  it("tolerates a trailing slash", () => {
    expect(resolveRouteMeta("/analytics/").title).toBe("Analytics");
  });

  it("titles the Analytics page's drift tab as Conversation Drift", () => {
    expect(resolveRouteMeta(ROUTES.ANALYTICS, "?tab=priority").title).toBe("Analytics");
    const drift = resolveRouteMeta(ROUTES.ANALYTICS, "?tab=drift");
    expect(drift.title).toBe("Conversation Drift");
    expect(drift.crumbs[0].label).toBe("Insights");
  });

  it("marks the assistant pages full-bleed, and nothing else", () => {
    expect(resolveRouteMeta(ROUTES.WHATSAPP_BOT).fullBleed).toBe(true);
    expect(resolveRouteMeta(ROUTES.CHATBOT_NEW_SESSION("d1")).fullBleed).toBe(true);
    expect(resolveRouteMeta(ROUTES.BLOG).fullBleed).toBe(false);
  });

  it("reports an unknown URL as not known, with a 404 title", () => {
    const meta = resolveRouteMeta("/nope/never");
    expect(meta.known).toBe(false);
    expect(meta.title).toBe("Page not found");
  });

  it("has no duplicate paths", () => {
    const paths = getRouteMetaPaths();
    expect(new Set(paths).size).toBe(paths.length);
  });
});
