import { describe, expect, it } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/* eslint-disable import/first */
import { summaryHeading } from "../sections/Checkup";
/* eslint-enable import/first */

/** TF1 F13: "45% accurate" next to "Ready for clients". */
describe("the checkup's verdict line", () => {
  const totals = { failed: 0, hardFails: 0, gaps: 0, questions: 11 };

  it("is never Ready with a failed answer", () => {
    const line = summaryHeading({ totals: { ...totals, failed: 6 } }, "clients");
    expect(line).not.toMatch(/Ready/);
    expect(line).toBe("6 of 11 questions need a fix");
  });

  it("is Ready when nothing failed, with its gaps", () => {
    expect(summaryHeading({ totals }, "clients")).toBe("Ready for clients");
    expect(summaryHeading({ totals: { ...totals, gaps: 2 } }, "clients")).toBe(
      "Ready for clients, with 2 small gaps",
    );
  });
});
