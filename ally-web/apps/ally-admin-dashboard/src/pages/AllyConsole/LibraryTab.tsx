import React from "react";

import { ContextCollectionLink } from "@components/context-collection-link";
import { en } from "@constants";

/** The Ally Guide Library collection: Ally's library lives in the Context Library now. */
export const ALLY_GUIDE_LIBRARY_COLLECTION = "ally_guide_library";

/**
 * Ally's library, which moved into the Context Library's Ally Guide Library
 * (docs/context-library/PLAN.md §9.6): its entries are added, edited and archived there, with the
 * global and organisation entries side by side. This tab points there instead of keeping a copy.
 */
export const LibraryTab: React.FC = () => (
  <div className="max-w-3xl py-2">
    <ContextCollectionLink
      collection={ALLY_GUIDE_LIBRARY_COLLECTION}
      copy={en.allyConsole.library.link}
    />
  </div>
);
