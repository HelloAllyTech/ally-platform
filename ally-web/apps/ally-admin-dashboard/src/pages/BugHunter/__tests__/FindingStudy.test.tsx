import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudyDetails } from "../FindingStudy";

vi.mock("@utils", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatDateTime: (d: string) => d,
}));
vi.mock("../FindingConfidence", () => ({
  DetailLine: ({ label, value }: { label: string; value: string }) => (
    <p>
      {label}: {value}
    </p>
  ),
  InfoTip: () => null,
}));

const study = {
  feature: "One-time password login",
  entryPoints: [],
  howItWorksToday: ["auth.util.ts generates it", "VerifyOtp screen reads it"],
  valueLivesIn: "code" as const,
  workingSibling: null,
  rootCause: "OTP_LENGTH is 4",
  approach: "Raise the length to 6 in every repo that reads it",
  filesToChange: ["src/auth/util/auth.util.ts"],
  leaveAlone: [],
  otherRepos: ["ally-web", "ally-mobile"],
  risks: [],
  testPlan: "auth-util.spec.ts asserts 6 digits",
  previousStudyWasWrongBecause: null,
  recordedAt: "2026-10-16",
  runId: "run-1",
  review: null,
};

describe("StudyDetails", () => {
  it("shows who else reads the value and how the session searched (2026-10-16)", () => {
    render(
      <StudyDetails
        study={{
          ...study,
          consumers: {
            search: 'grep -rn "OTP_LENGTH" . /tmp/siblings',
            found: ["ally-web: OtpInput.tsx — 4 boxes", "ally-mobile: VerifyOtp.tsx — maxLength 4"],
          },
        }}
      />,
    );
    expect(screen.getByText(/Who else reads this value: ally-web: OtpInput.tsx/)).toBeTruthy();
    expect(screen.getByText(/How it searched: grep -rn "OTP_LENGTH"/)).toBeTruthy();
  });

  it("says nobody else was found, and shows nothing for an older study without a search", () => {
    const { rerender } = render(
      <StudyDetails study={{ ...study, consumers: { search: "grep -rn x", found: [] } }} />,
    );
    expect(screen.getByText(/Who else reads this value: Nobody else found/)).toBeTruthy();
    rerender(<StudyDetails study={study} />);
    expect(screen.queryByText(/Who else reads this value/)).toBeNull();
  });
});
