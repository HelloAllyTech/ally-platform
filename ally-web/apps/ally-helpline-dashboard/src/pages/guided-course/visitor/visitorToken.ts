/**
 * The anonymous visitor's token (plan §3 stage 1, §9.1). One per browser, not
 * per course: the server keeps only its hash, and the browser sends it as
 * `x-guide-visitor` on the public routes and once more when signing in, so the
 * conversation is claimed. Storage can throw (private mode, blocked site
 * data): then the visit simply lasts as long as the page.
 */
const KEY = "allyGuideVisitor";

let memory: string | null = null;

export const readVisitorToken = (): string | null => {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
};

export const storeVisitorToken = (token: string): void => {
  memory = token;
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Kept in memory for this page.
  }
};

/** Spent (claimed on sign-in) or refused by the server (`GUIDE_VISITOR_INVALID`). */
export const dropVisitorToken = (): void => {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
};

export const GUIDE_VISITOR_HEADER = "x-guide-visitor";
