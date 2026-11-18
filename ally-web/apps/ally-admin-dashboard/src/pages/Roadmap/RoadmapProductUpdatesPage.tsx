import React from "react";

import { ProductUpdates } from "../ProductUpdates/ProductUpdates";

/**
 * Product updates, as a page of the Roadmap: the frame draws the same sub navigation above it, with
 * the Updates tab selected, and the existing page sits underneath.
 */
export const RoadmapProductUpdatesPage: React.FC = () => (
  <div className="h-full overflow-auto p-4 md:p-6">
    <ProductUpdates />
  </div>
);
