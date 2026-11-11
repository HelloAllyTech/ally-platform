import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** axe on the page: no serious or critical issues (chunk-20d tests). */
export async function expectNoSeriousA11yIssues(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
  expect(
    serious.map(v => `${v.id}: ${v.help} (${v.nodes.map(n => n.target.join(" ")).join(", ")})`),
  ).toEqual([]);
}
