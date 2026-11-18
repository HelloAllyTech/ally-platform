import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/* eslint-disable import/first */
import { ROUTES } from "@constants";

import { DebriefsPmAgentRedirect } from "../DebriefsPmAgentRedirect";
/* eslint-enable import/first */

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}${l.hash}`}</div>;
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={ROUTES.DEBRIEFS_PM_AGENT} element={<DebriefsPmAgentRedirect />} />
        <Route path={ROUTES.DEBRIEFS_CHANGES} element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe("the Changes page's old address", () => {
  it("opens /debriefs/changes and keeps the query and hash", () => {
    renderAt("/debriefs/pm-agent?change=c1&view=reports#top");
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/debriefs/changes?change=c1&view=reports#top",
    );
  });

  it("opens /debriefs/changes with nothing to keep", () => {
    renderAt("/debriefs/pm-agent");
    expect(screen.getByTestId("where")).toHaveTextContent("/debriefs/changes");
  });
});
