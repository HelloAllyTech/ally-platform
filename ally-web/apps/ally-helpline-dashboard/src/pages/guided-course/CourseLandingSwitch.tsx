import { FC } from "react";

import { Navigate, useParams, useSearchParams } from "react-router-dom";

import { useGetGuideAvailabilityQuery } from "@api";
import { buildJourneyRoute, LOCAL_STORAGE_KEYS } from "@constants";

import { CLASSIC_VIEW, CLASSIC_VIEW_PARAM } from "./classicRoute";
import { GateLoading } from "./GuidedCourseGate";
import { CourseLanding } from "../course-landing/CourseLanding";

const signedIn = (): boolean => {
  try {
    return Boolean(localStorage.getItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN));
  } catch {
    return false;
  }
};

/**
 * `/course/:trackId` (plan §5.14, §3 stage 1). A course that has gone guided
 * opens as Ally's journey. Signed out, only while visitors can talk to Ally:
 * without anonymous chat the classic landing explains the course better than
 * a sign-in wall. Fails closed, like the journey's own gate: an error or any
 * "no" is the classic landing, and `?view=classic` always is.
 */
export const CourseLandingSwitch: FC = () => {
  const { trackId = "" } = useParams<{ trackId: string }>();
  const [params] = useSearchParams();
  const wantsClassic = params.get(CLASSIC_VIEW_PARAM) === CLASSIC_VIEW;
  const { data, isError, isLoading, isUninitialized } = useGetGuideAvailabilityQuery(
    { trackId },
    { skip: !trackId || wantsClassic },
  );

  if (!trackId || wantsClassic) return <CourseLanding />;
  if (isLoading || isUninitialized) return <GateLoading />;
  const guided = !isError && data?.guided === true && (signedIn() || data.anonymousChat === true);
  if (!guided) return <CourseLanding />;
  // Campaign and referral parameters come along.
  const search = params.toString();
  return <Navigate to={`${buildJourneyRoute(trackId)}${search ? `?${search}` : ""}`} replace />;
};

export default CourseLandingSwitch;
