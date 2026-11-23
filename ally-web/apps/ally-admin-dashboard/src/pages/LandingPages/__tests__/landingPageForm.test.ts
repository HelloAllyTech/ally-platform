import { describe, expect, it } from "vitest";

import { errorMessage, publishProblems } from "../landingPageErrors";
import { blankLandingPageForm, slugify, validateLandingPageForm } from "../landingPageForm";
import { landingImageProblem } from "../useLandingImageUpload";

describe("slugify", () => {
  it("makes an address from a name", () => {
    expect(slugify("Baat Se Baat Banegi")).toBe("baat-se-baat-banegi");
  });

  it("drops accents, symbols and repeated or edge hyphens", () => {
    expect(slugify("  Café -- Déjà vu!! ")).toBe("cafe-deja-vu");
  });

  it("gives nothing for a name with no Latin letters or digits", () => {
    expect(slugify("बात से बात")).toBe("");
  });

  it("stays within the server's limit and never ends on a hyphen", () => {
    const slug = slugify(`${"a".repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("validateLandingPageForm", () => {
  const valid = () => ({
    ...blankLandingPageForm(),
    tenantId: "t1",
    name: "Campaign",
    slug: "campaign",
  });

  it("accepts a complete form", () => {
    expect(validateLandingPageForm(valid(), { needsTenant: true })).toEqual({});
  });

  it("asks for an organization only when creating", () => {
    const form = { ...valid(), tenantId: "" };
    expect(validateLandingPageForm(form, { needsTenant: true }).tenantId).toBeTruthy();
    expect(validateLandingPageForm(form, { needsTenant: false }).tenantId).toBeUndefined();
  });

  it("needs a name and an address", () => {
    const errors = validateLandingPageForm(
      { ...valid(), name: "  ", slug: "" },
      { needsTenant: true },
    );
    expect(errors.name).toBeTruthy();
    expect(errors.slug).toBeTruthy();
  });

  it.each(["Has Capitals", "has space", "-leading", "trailing-", "double--hyphen", "under_score"])(
    "refuses the address %s",
    slug => {
      expect(
        validateLandingPageForm({ ...valid(), slug }, { needsTenant: true }).slug,
      ).toBeTruthy();
    },
  );

  it("needs at least one language", () => {
    expect(
      validateLandingPageForm({ ...valid(), languages: [] }, { needsTenant: true }).languages,
    ).toBeTruthy();
  });

  it("starts with English only and sign-up off", () => {
    const blank = blankLandingPageForm();
    expect(blank.languages).toEqual(["en"]);
    expect(blank.defaultLanguage).toBe("en");
    expect(blank.signUpEnabled).toBe(false);
  });
});

describe("landingImageProblem", () => {
  it("accepts the supported types within the size limit", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]) {
      expect(landingImageProblem({ type, size: 1024 })).toBeNull();
    }
  });

  it("refuses other types, with a plain reason", () => {
    expect(landingImageProblem({ type: "image/gif", size: 1024 })).toMatch(
      /PNG, JPEG, WebP or SVG/,
    );
    expect(landingImageProblem({ type: "application/pdf", size: 1024 })).toBeTruthy();
  });

  it("refuses a file over 3 MB", () => {
    expect(landingImageProblem({ type: "image/png", size: 3 * 1024 * 1024 + 1 })).toMatch(/3 MB/);
    expect(landingImageProblem({ type: "image/png", size: 3 * 1024 * 1024 })).toBeNull();
  });
});

describe("server errors", () => {
  it("reads the server's message", () => {
    expect(
      errorMessage({ data: { message: "This organization already has that address" } }, "x"),
    ).toBe("This organization already has that address");
  });

  it("joins a list of validation messages", () => {
    expect(errorMessage({ data: { message: ["a is bad", "b is bad"] } }, "x")).toBe(
      "a is bad, b is bad",
    );
  });

  it("falls back when there is no message", () => {
    expect(errorMessage(undefined, "Couldn't save")).toBe("Couldn't save");
    expect(errorMessage({ status: 500 }, "Couldn't save")).toBe("Couldn't save");
  });

  it("reads what is missing before a page can publish", () => {
    expect(
      publishProblems({
        data: { message: "not ready", problems: ["The first heading is empty in en."] },
      }),
    ).toEqual(["The first heading is empty in en."]);
  });

  it("returns no problems for any other error", () => {
    expect(publishProblems({ data: { message: "boom" } })).toEqual([]);
    expect(publishProblems(undefined)).toEqual([]);
  });
});
