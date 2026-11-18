import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TenantBranding } from "@types";

import {
  applyBranding,
  applyCachedBranding,
  cacheBranding,
  DEFAULT_DOCUMENT_TITLE,
  DEFAULT_FAVICON,
  hexToRgbTriplet,
  readCachedBranding,
} from "../applyBranding";
import { ALLY_BRANDING } from "../BrandingContext";

const acme: TenantBranding = {
  ...ALLY_BRANDING,
  enabled: true,
  displayName: "Acme Helpline",
  primaryColor: "#8E2626",
  faviconUrl: "https://assets.example/fav.png",
  welcomeLine: "Welcome back",
  tokens: {
    primary: {
      ...ALLY_BRANDING.tokens.primary,
      DEFAULT: "#8E2626",
      500: "#8E2626",
      600: "#741F1F",
      700: "#591818",
    },
    onPrimary: "#FAF9F5",
  },
};

const root = () => document.documentElement.style;

beforeEach(() => {
  localStorage.clear();
  applyBranding(null);
});

afterEach(() => {
  applyBranding(null);
});

describe("hexToRgbTriplet", () => {
  it("writes the form index.css declares the ramp in", () => {
    expect(hexToRgbTriplet("#264D8E")).toBe("38 77 142");
    expect(hexToRgbTriplet("#FFFFFF")).toBe("255 255 255");
  });
});

describe("applyBranding", () => {
  it("paints the ramp, the label colour, the Carbon tokens, the title and the favicon", () => {
    applyBranding(acme);

    expect(root().getPropertyValue("--color-primary-500")).toBe("142 38 38");
    expect(root().getPropertyValue("--color-primary-DEFAULT")).toBe("142 38 38");
    expect(root().getPropertyValue("--color-primary-foreground")).toBe("250 249 245");
    expect(root().getPropertyValue("--cds-interactive")).toBe("#8E2626");
    expect(root().getPropertyValue("--cds-button-primary-hover")).toBe("#741F1F");
    expect(root().getPropertyValue("--cds-link-secondary")).toBe("#591818");
    expect(root().getPropertyValue("--cds-text-on-color")).toBe("#FAF9F5");
    expect(document.title).toBe("Acme Helpline");
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(
      "https://assets.example/fav.png",
    );
  });

  it("takes everything off again for an org with the switch off, and for null", () => {
    applyBranding(acme);
    applyBranding({ ...acme, enabled: false });

    expect(root().getPropertyValue("--color-primary-500")).toBe("");
    expect(root().getPropertyValue("--cds-interactive")).toBe("");
    expect(document.title).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(
      DEFAULT_FAVICON,
    );

    applyBranding(acme);
    applyBranding(null);
    expect(root().getPropertyValue("--color-primary-500")).toBe("");
  });

  it("falls back to the Ally favicon when a branded org has none", () => {
    applyBranding({ ...acme, faviconUrl: null });
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(
      DEFAULT_FAVICON,
    );
  });
});

describe("branding cache", () => {
  it("round-trips an enabled branding and forgets a disabled one", () => {
    cacheBranding(acme);
    expect(readCachedBranding()?.displayName).toBe("Acme Helpline");

    cacheBranding({ ...acme, enabled: false });
    expect(readCachedBranding()).toBeNull();
  });

  it("ignores a corrupt or incomplete cache", () => {
    localStorage.setItem("orgBranding", "{not json");
    expect(readCachedBranding()).toBeNull();
    localStorage.setItem("orgBranding", JSON.stringify({ enabled: true }));
    expect(readCachedBranding()).toBeNull();
  });

  it("paints from the cache before React mounts, and does nothing without one", () => {
    applyCachedBranding();
    expect(root().getPropertyValue("--color-primary-500")).toBe("");

    cacheBranding(acme);
    applyCachedBranding();
    expect(root().getPropertyValue("--color-primary-500")).toBe("142 38 38");
    expect(document.title).toBe("Acme Helpline");
  });
});
