import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Ratchet: the AI Chatbots admin screens use the dashboard's shared components (`@components/button`
 * and friends), not `components/v2/core` (kept dependency-free for the public bot page and the
 * onboarding flow) and not raw HTML controls. Existing raw controls are grandfathered in the
 * baselines below; lower a number when you migrate one, never raise it. Use the shared Button or
 * Input instead of a new raw `<button>` or `<input>`.
 */
const PAGES = path.resolve(__dirname, "../pages");

const BASELINE: Record<string, { button: number; input: number }> = {
  AssistantHome: { button: 22, input: 33 },
  Inbox: { button: 5, input: 0 },
  WhatsAppBot: { button: 9, input: 1 },
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });

const count = (files: string[], pattern: RegExp) =>
  files.reduce((n, file) => n + (readFileSync(file, "utf8").match(pattern)?.length ?? 0), 0);

describe("admin chatbot screens use the shared component library", () => {
  for (const [area, baseline] of Object.entries(BASELINE)) {
    const files = sourceFiles(path.join(PAGES, area));

    it(`${area} imports no Button from components/v2`, () => {
      const offenders = files.filter(file =>
        /import\s*\{[^}]*\b(Button|PrimaryButton)\b[^}]*\}\s*from\s*"@components\/v2"/.test(
          readFileSync(file, "utf8"),
        ),
      );
      expect(offenders.map(f => path.relative(PAGES, f))).toEqual([]);
    });

    it(`${area} adds no raw <button>`, () => {
      expect(count(files, /<button\b/g)).toBeLessThanOrEqual(baseline.button);
    });

    it(`${area} adds no raw <input>`, () => {
      expect(count(files, /<input\b/g)).toBeLessThanOrEqual(baseline.input);
    });
  }
});
