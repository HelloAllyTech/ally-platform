import { describe, it, expect } from "vitest";

// Importing the script does not run the check: it only runs as a CLI.
import { countColorLiterals } from "../../../../scripts/check-color-literals.mjs";

// The ratchet counted the `#039` inside `&#039;` (an HTML apostrophe in
// rich-text-renderer/escapeHtml.ts) as a colour. Character references are
// text; real hex colours must still count.
describe("scripts/check-color-literals.mjs: countColorLiterals", () => {
  it("does not count HTML character references", () => {
    expect(countColorLiterals(`const apos = '&#039;';`)).toBe(0);
    expect(countColorLiterals(`const apos = '&#39;';`)).toBe(0);
    expect(countColorLiterals(`const apos = '&#x27;';`)).toBe(0);
    expect(
      countColorLiterals(`.replace(/'/g, "&#039;").replace(/"/g, "&#34;").replace(/&/g, "&#X26;")`),
    ).toBe(0);
  });

  it("still counts real hex colours", () => {
    expect(countColorLiterals(`style={{ color: '#039' }}`)).toBe(1);
    expect(countColorLiterals(`const bg = '#ffffff';`)).toBe(1);
    expect(countColorLiterals(`border: "1px solid #ABCDEF80"`)).toBe(1);
  });

  it("counts a colour on the same line as a character reference", () => {
    expect(countColorLiterals(`'&#039;' + '#039' + '#ffffff'`)).toBe(2);
  });
});
