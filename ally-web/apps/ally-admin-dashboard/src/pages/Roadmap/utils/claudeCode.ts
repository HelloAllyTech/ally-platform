import { en } from "@constants";
import type { RoadmapBuildBrief } from "@types";

import { ROADMAP_STORE_KEYS, readStore, writeStore } from "./localStore";

/**
 * Open in Claude Code (D18, §4.5b): `claude://code/new?q=<prompt>&folder=<ally-platform path>`.
 * The prompt is pre-filled and never sent on its own; the desktop app asks to confirm the folder.
 * The terminal, VS Code and web links aren't offered (§4.5b says why).
 */

/** About 14,000 characters fit the deep link; the server says which side of it a brief is. */
export const DEEP_LINK_LIMIT = 14_000;

/** If nothing takes focus away from the page in this long, the app probably didn't open. */
export const CLAUDE_CODE_OPEN_TIMEOUT_MS = 3_000;

export const readClaudeCodeFolder = (): string | null => {
  const value = readStore<unknown>(ROADMAP_STORE_KEYS.claudeCodeFolder, null);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export const writeClaudeCodeFolder = (folder: string): void =>
  writeStore(ROADMAP_STORE_KEYS.claudeCodeFolder, folder.trim());

/** An absolute local path: `/Users/…`, `~/…`, or `C:\…`. Anything else is asked again. */
export const isPlausibleFolder = (folder: string): boolean => {
  const value = folder.trim();
  return /^(\/|~\/|[A-Za-z]:[\\/])/.test(value) && value.length <= 500;
};

/** Whether the whole brief goes in the link; trusts the server, and checks it never lies long. */
export const briefFitsDeepLink = (brief: Pick<RoadmapBuildBrief, "fitsDeepLink" | "markdown">) =>
  brief.fitsDeepLink && brief.markdown.length <= DEEP_LINK_LIMIT;

/** A brief too long for the link becomes a short prompt pointing at the downloaded file. */
export const shortPrompt = (
  brief: Pick<RoadmapBuildBrief, "code" | "filename" | "branch" | "prTitle">,
): string => en.roadmapV2Tools.build.shortPrompt(brief);

export const promptFor = (brief: RoadmapBuildBrief): string =>
  briefFitsDeepLink(brief) ? brief.markdown : shortPrompt(brief);

export const claudeCodeLink = (prompt: string, folder: string): string =>
  `claude://code/new?q=${encodeURIComponent(prompt)}&folder=${encodeURIComponent(folder.trim())}`;

/** Save text as a file through the browser's own download. */
export const downloadText = (filename: string, text: string): void => {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Hand the link to the OS and report whether the page lost focus soon after, which is what an
 * app opening looks like from inside a browser. There is no other signal: a custom scheme with no
 * handler fails silently.
 */
export const openDeepLink = (
  link: string,
  onDidNotOpen: () => void,
  timeoutMs: number = CLAUDE_CODE_OPEN_TIMEOUT_MS,
): (() => void) => {
  let left = false;
  const markLeft = () => {
    left = true;
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") markLeft();
  };
  window.addEventListener("blur", markLeft);
  document.addEventListener("visibilitychange", onVisibility);
  const cleanup = () => {
    window.removeEventListener("blur", markLeft);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  const timer = window.setTimeout(() => {
    cleanup();
    if (!left) onDidNotOpen();
  }, timeoutMs);
  window.location.href = link;
  return () => {
    window.clearTimeout(timer);
    cleanup();
  };
};
