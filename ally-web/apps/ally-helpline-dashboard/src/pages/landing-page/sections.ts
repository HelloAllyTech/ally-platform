import { ROUTES } from "@constants";

/** The three blocks on the landing page, in the order they are shown. */
export const SECTION_KEYS = ["practice", "courses", "resources"] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const isSectionKey = (value: string | undefined): value is SectionKey =>
  SECTION_KEYS.some(key => key === value);

export const sectionPath = (key: SectionKey): string => `${ROUTES.LANDING_PAGE_1}/${key}`;

/** How many placeholder entries each section page lists until real content exists. */
export const PLACEHOLDER_ITEM_COUNT: Record<SectionKey, number> = {
  practice: 4,
  courses: 3,
  resources: 5,
};
