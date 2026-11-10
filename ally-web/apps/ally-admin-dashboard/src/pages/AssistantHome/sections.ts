/** The home's sections, in the left list's order (chunk 20d §4.1.6). */
export const SECTION_IDS = [
  "overview",
  "knows",
  "personality",
  "safety",
  // Chunk 20d-2: everything it follows, in the order it applies.
  "how",
  "page",
  "checkup",
  "conversations",
  "share",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/**
 * Where an older link lands: the classic tabs (`?tab=`) and Settings sections
 * (`?tab=settings&section=`) map to the section that now holds them. `test` opens Try it.
 */
const OLD_LINKS: Record<string, SectionId> = {
  overview: "overview",
  usage: "overview",
  agent: "overview",
  persona: "personality",
  replies: "personality",
  knowledge: "knows",
  unanswered: "knows",
  general: "safety",
  botPage: "page",
  lookAndFeel: "page",
  conversations: "conversations",
  people: "share",
  connectors: "share",
  test: "overview",
};

const isSection = (id: string | null): id is SectionId =>
  Boolean(id) && (SECTION_IDS as readonly string[]).includes(id as string);

/** The section a URL asks for, and whether it asks for Try it (the old Preview tab). */
export const sectionFromUrl = (params: URLSearchParams): { section: SectionId; tryIt: boolean } => {
  const section = params.get("section");
  const tab = params.get("tab");
  if (isSection(section)) return { section, tryIt: false };
  const old = (tab === "settings" ? section : tab) ?? section;
  if (old && OLD_LINKS[old]) return { section: OLD_LINKS[old], tryIt: old === "test" };
  return { section: "overview", tryIt: false };
};
