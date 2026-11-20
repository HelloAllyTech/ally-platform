import {
  LANDING_LANGUAGE_LABELS,
  LANDING_LANGUAGE_NAMES_EN,
  LANDING_LANGUAGES,
  LandingLanguage,
} from "@ally-ui-mono/ui-shared";

export { LANDING_LANGUAGE_LABELS, LANDING_LANGUAGE_NAMES_EN, LANDING_LANGUAGES };

export interface LandingPageFormValues {
  tenantId: string;
  name: string;
  slug: string;
  languages: LandingLanguage[];
  defaultLanguage: LandingLanguage;
  signUpEnabled: boolean;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 60;
export const NAME_MAX = 160;

/** An address built from a name: lowercase letters and digits joined by single hyphens. */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");

export type LandingPageFormErrors = Partial<
  Record<"tenantId" | "name" | "slug" | "languages", string>
>;

/** What is wrong with the form, field by field. Empty means it can be submitted. */
export const validateLandingPageForm = (
  values: LandingPageFormValues,
  options: { needsTenant: boolean },
): LandingPageFormErrors => {
  const errors: LandingPageFormErrors = {};
  if (options.needsTenant && !values.tenantId) errors.tenantId = "Choose an organization";
  if (!values.name.trim()) errors.name = "Give the page a name";
  else if (values.name.trim().length > NAME_MAX)
    errors.name = `Use ${NAME_MAX} characters or fewer`;
  if (!values.slug) errors.slug = "Give the page an address";
  else if (!SLUG_PATTERN.test(values.slug)) {
    errors.slug = "Use lowercase letters, digits and single hyphens";
  } else if (values.slug.length > SLUG_MAX) errors.slug = `Use ${SLUG_MAX} characters or fewer`;
  if (values.languages.length === 0) errors.languages = "Choose at least one language";
  return errors;
};

export const blankLandingPageForm = (): LandingPageFormValues => ({
  tenantId: "",
  name: "",
  slug: "",
  languages: ["en"],
  defaultLanguage: "en",
  signUpEnabled: false,
});
