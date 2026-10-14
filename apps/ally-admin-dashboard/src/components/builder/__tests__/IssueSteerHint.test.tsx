import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@components", () => ({ cellTypes: {} }));

// eslint-disable-next-line import/first
import { IssueSteerHint } from "../IssueSteerHint";

describe("IssueSteerHint", () => {
  it("is one line with no pull request link in a repo chain", () => {
    render(
      <IssueSteerHint
        chained
        pullRequest={{
          repo: "ally-web",
          number: 33,
          url: "https://github.com/org/ally-web/pull/33",
        }}
      />,
    );
    expect(screen.getByText("To steer opencode, comment /oc on a pull request.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("still links the pull request for a single-repo issue build", () => {
    render(
      <IssueSteerHint
        pullRequest={{
          repo: "ally-web",
          number: 33,
          url: "https://github.com/org/ally-web/pull/33",
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Open ally-web #33" })).toBeTruthy();
  });
});
