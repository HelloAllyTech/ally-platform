/**
 * The home's six sections, in the left list's order (stage 2: six replace the ten). Build and
 * Knowledge hold two parts each; Channels and Settings stack theirs.
 */
export const SECTION_IDS = [
  "overview",
  "build",
  "conversations",
  "channels",
  "knowledge",
  "settings",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/** The parts of a section that is split in two (`?part=`). */
export const PARTS = {
  build: ["personality", "checkup"],
  knowledge: ["knows", "lists"],
} as const;

export type BuildPart = (typeof PARTS.build)[number];
export type KnowledgePart = (typeof PARTS.knowledge)[number];
export type PartId = BuildPart | KnowledgePart;

interface Target {
  section: SectionId;
  part?: PartId;
  tryIt?: boolean;
}

/**
 * Where an older link lands: the ten old sections (`?section=`), the classic tabs (`?tab=`) and
 * Settings sections (`?tab=settings&section=`) all map to the section that now holds them. `test`
 * opens Try it.
 */
const OLD_LINKS: Record<string, Target> = {
  // The ten sections of the previous home.
  overview: { section: "overview" },
  knows: { section: "knowledge", part: "knows" },
  lists: { section: "knowledge", part: "lists" },
  personality: { section: "build", part: "personality" },
  safety: { section: "settings" },
  how: { section: "settings" },
  page: { section: "channels" },
  checkup: { section: "build", part: "checkup" },
  share: { section: "channels" },
  // The classic tabs.
  usage: { section: "overview" },
  agent: { section: "overview" },
  persona: { section: "build", part: "personality" },
  replies: { section: "settings" },
  knowledge: { section: "knowledge", part: "knows" },
  unanswered: { section: "knowledge", part: "knows" },
  general: { section: "settings" },
  botPage: { section: "channels" },
  lookAndFeel: { section: "channels" },
  conversations: { section: "conversations" },
  inbox: { section: "conversations" },
  people: { section: "settings" },
  connectors: { section: "channels" },
  test: { section: "build", part: "personality", tryIt: true },
};

/** `?tool=` on the old Lists section: the built-in tools moved out of it. */
const OLD_TOOLS: Record<string, Target> = {
  pages: { section: "channels" },
  memory: { section: "settings" },
  handover: { section: "settings" },
};

const isSection = (id: string | null): id is SectionId =>
  Boolean(id) && (SECTION_IDS as readonly string[]).includes(id as string);

const isPart = (section: SectionId, id: string | null): id is PartId =>
  section in PARTS &&
  Boolean(id) &&
  ((PARTS as Record<string, readonly string[]>)[section] ?? []).includes(id as string);

/** The section (and part) a URL asks for, and whether it asks for Try it (the old Preview tab). */
export const sectionFromUrl = (
  params: URLSearchParams,
): { section: SectionId; part: PartId | null; tryIt: boolean; tool: string | null } => {
  const section = params.get("section");
  const tab = params.get("tab");
  const part = params.get("part");
  const tool = params.get("tool");
  if (isSection(section)) {
    return {
      section,
      part: isPart(section, part) ? part : null,
      tryIt: false,
      tool: section === "knowledge" ? tool : null,
    };
  }
  // The old Lists section with a built-in tool open: that tool now lives elsewhere.
  if (section === "lists" && tool && OLD_TOOLS[tool]) {
    return { section: OLD_TOOLS[tool].section, part: null, tryIt: false, tool: null };
  }
  const old = (tab === "settings" ? section : tab) ?? section;
  const target = old ? OLD_LINKS[old] : undefined;
  if (target) {
    return {
      section: target.section,
      part: target.part ?? null,
      tryIt: Boolean(target.tryIt),
      // A list's own key (`?section=lists&tool=bookings`) opens that list.
      tool: target.part === "lists" ? tool : null,
    };
  }
  return { section: "overview", part: null, tryIt: false, tool: null };
};

/** The section list for someone who sees only part of the home: a Responder sees Conversations. */
export const visibleSections = (responderOnly: boolean): readonly SectionId[] =>
  responderOnly ? (["conversations"] as const) : SECTION_IDS;
