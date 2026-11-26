import React from "react";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

/** What shows while the manual's chunk loads: a quiet outline of the rail and a page. */
export const ManualRouteFallback: React.FC = () => (
  <div className="flex h-full min-h-0" aria-busy="true" aria-label={en.productManual.loading}>
    <div className="hidden w-[17rem] shrink-0 flex-col gap-3 border-r border-border-light p-4 lg:flex">
      <SkeletonText paragraph lineCount={8} />
    </div>
    <div className="mx-auto w-full max-w-[46rem] px-8 py-10">
      <SkeletonText heading width="60%" />
      <SkeletonText width="80%" />
      <div className="mt-8">
        <SkeletonText paragraph lineCount={10} />
      </div>
    </div>
  </div>
);
