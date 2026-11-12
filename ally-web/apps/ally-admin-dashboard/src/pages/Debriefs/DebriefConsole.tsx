import React from "react";

import { Navigate, useSearchParams } from "react-router-dom";

import { redirectForOldTab } from "./consoleRoutes";
import { DebriefsHome } from "./home/DebriefsHome";

/**
 * `/debriefs`: the Debriefs home. Until the redesign (2026-11-12) this was a tab strip with the
 * tab in `?tab=`; an old link follows its content to where it lives now.
 */
export const DebriefConsole: React.FC = () => {
  const [params] = useSearchParams();
  const redirect = redirectForOldTab(params);
  if (redirect) return <Navigate to={redirect} replace />;
  return <DebriefsHome />;
};

export default DebriefConsole;
