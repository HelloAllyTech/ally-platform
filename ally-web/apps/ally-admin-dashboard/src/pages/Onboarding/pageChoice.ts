import type { FoundPages, PageChoice } from "@api";

/** The sections "Leave out blog and news" and "Leave out careers" leave out (ally-be url-scope). */
export const SHORTCUTS = {
  blog: [
    "blog",
    "blogs",
    "news",
    "newsroom",
    "articles",
    "article",
    "stories",
    "press",
    "press-releases",
    "insights",
    "posts",
    "updates",
  ],
  careers: ["careers", "career", "jobs", "join-us", "work-with-us", "vacancies"],
} as const;

/**
 * The owner's choice as ally-be stores it: a whole section left out is one pattern ("/blog"), a
 * single page left out is its path. Nothing left out is "read everything". The home page is
 * always read.
 */
export const choiceFrom = (found: FoundPages, leftOut: Set<string>): PageChoice => {
  const exclude: string[] = [];
  for (const group of found.groups) {
    if (!group.section) continue;
    const out = group.pages.filter(page => leftOut.has(page.url));
    if (!out.length) continue;
    if (out.length === group.pages.length) exclude.push(`/${group.section}`);
    else exclude.push(...out.map(page => page.path.replace(/\/+$/, "") || "/"));
  }
  return { include: [], exclude };
};

/** The pages a saved choice leaves out, to show it again. */
export const leftOutBy = (found: FoundPages): Set<string> => {
  const out = new Set<string>();
  const patterns = found.choice.exclude;
  for (const group of found.groups) {
    for (const page of group.pages) {
      const path = page.path.replace(/\/+$/, "").toLowerCase() || "/";
      if (patterns.some(p => p !== "/" && (path === p || path.startsWith(`${p}/`)))) {
        out.add(page.url);
      }
    }
  }
  return out;
};

/** The pages in the sections a shortcut names. */
export const pagesIn = (found: FoundPages, sections: readonly string[]): string[] =>
  found.groups
    .filter(group => sections.includes(group.section))
    .flatMap(group => group.pages.map(page => page.url));
