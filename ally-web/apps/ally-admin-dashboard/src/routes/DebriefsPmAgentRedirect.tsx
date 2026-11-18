import React from "react";

import { Navigate, useLocation } from "react-router-dom";

import { ROUTES } from "@constants";

/** `/debriefs/pm-agent` (the Changes page's old address): the same place, with its query and hash. */
export const DebriefsPmAgentRedirect: React.FC = () => {
  const { search, hash } = useLocation();
  return <Navigate to={`${ROUTES.DEBRIEFS_CHANGES}${search}${hash}`} replace />;
};
