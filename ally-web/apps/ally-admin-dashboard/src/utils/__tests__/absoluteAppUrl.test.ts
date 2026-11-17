import { afterEach, describe, expect, it, vi } from "vitest";

import { absoluteAppUrl } from "../absoluteAppUrl";

describe("absoluteAppUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the /admin base path, so a copied link opens the admin console", () => {
    vi.stubEnv("BASE_URL", "/admin/");
    expect(absoluteAppUrl("/product-roadmap?opportunity=abc")).toBe(
      `${window.location.origin}/admin/product-roadmap?opportunity=abc`,
    );
  });

  it("adds nothing when the app is served from the root", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(absoluteAppUrl("/evaluate")).toBe(`${window.location.origin}/evaluate`);
  });
});
