import { FC, lazy, Suspense, useEffect, useState } from "react";

import { Navigate, useParams, useSearchParams } from "react-router-dom";

import { useGetGuideAvailabilityQuery } from "@api";
import { ROUTES } from "@constants";

import { CLASSIC_VIEW, CLASSIC_VIEW_PARAM, classicRouteFor } from "./classicRoute";

const GuidedCourse = lazy(() => import("./GuidedCourse"));

export { CLASSIC_VIEW_PARAM };

/** The fixture transport is for development only; production builds never load it. */
export const isFixtureRequested = (
  params: URLSearchParams,
  dev: boolean = import.meta.env.DEV,
): boolean => dev && params.has("fixture");

/** `?fixture=visitor`: the fixture plays a signed-out visitor (anonymous chat). */
const isFixtureVisitor = (params: URLSearchParams): boolean => params.get("fixture") === "visitor";

export const GateLoading: FC = () => (
  <div
    className="fixed inset-0 z-40 flex h-[100dvh] items-center justify-center bg-[rgb(var(--color-background-DEFAULT))]"
    role="status"
    aria-busy="true"
    data-testid="guided-gate-loading"
  />
);

/**
 * `/journey/:trackId` (dark launch; plan §10.4). Asks whether the guided
 * experience is on for this course and opens it only on a clear yes. Every
 * other answer, an error or a malformed reply included, falls back to the
 * classic course, so a learner never meets a dead end (plan §2.3: the kill
 * switches fail closed to classic). `?view=classic` skips the question.
 */
export const GuidedCourseGate: FC = () => {
  const { trackId = "" } = useParams<{ trackId: string }>();
  const [params] = useSearchParams();
  const wantsClassic = params.get(CLASSIC_VIEW_PARAM) === CLASSIC_VIEW;
  const fixture = isFixtureRequested(params);

  const { data, isError, isLoading, isUninitialized } = useGetGuideAvailabilityQuery(
    { trackId },
    { skip: !trackId || wantsClassic || fixture },
  );

  if (!trackId) return <Navigate to={ROUTES.LEARN} replace />;
  if (wantsClassic) return <Navigate to={classicRouteFor(trackId)} replace />;
  if (fixture) return <FixtureJourney trackId={trackId} visitor={isFixtureVisitor(params)} />;
  if (isLoading || isUninitialized) return <GateLoading />;
  if (isError || data?.guided !== true) return <Navigate to={classicRouteFor(trackId)} replace />;

  return (
    <Suspense fallback={<GateLoading />}>
      <GuidedCourse trackId={trackId} />
    </Suspense>
  );
};

/** Dev only: installs the fixture backend, then opens the journey against it. */
const FixtureJourney: FC<{ trackId: string; visitor: boolean }> = ({ trackId, visitor }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let uninstall: (() => void) | undefined;
    void import("./fixture/fixtureServer").then(({ installGuideFixture }) => {
      uninstall = installGuideFixture(trackId, { visitor }).uninstall;
      setReady(true);
    });
    return () => uninstall?.();
  }, [trackId, visitor]);
  if (!ready) return <GateLoading />;
  return (
    <Suspense fallback={<GateLoading />}>
      <GuidedCourse trackId={trackId} fixture fixtureVisitor={visitor} />
    </Suspense>
  );
};

export default GuidedCourseGate;
