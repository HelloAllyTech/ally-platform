import React from "react";

import { LibraryPanel } from "@components/ally-guide/LibraryPanel";
import { useAllyGuideAccess } from "@hooks";

/** The platform's own library: global documents Ally may draw on for every learner and visitor. */
export const LibraryTab: React.FC = () => {
  const { canEdit } = useAllyGuideAccess();
  return <LibraryPanel scope="platform" canEdit={canEdit} />;
};
