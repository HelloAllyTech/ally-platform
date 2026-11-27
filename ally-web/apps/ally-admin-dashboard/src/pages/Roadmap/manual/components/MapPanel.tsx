import React, { Component, Suspense, lazy } from "react";

import { SkeletonPlaceholder } from "@ally-ui-mono/ui-shared";
import { useGetManualGraphQuery } from "@api";
import { en } from "@constants";
import type { ManualGraph } from "@types";

import { MapListFallback } from "./MapListFallback";
import { ManualMessage } from "./StateViews";

import type { MapViewProps } from "./MapView";

// xyflow is only fetched when the map opens. If the chunk fails to load, the list stands in.
const LazyMapView = lazy(() =>
  import("./MapView").catch(() => ({
    default: (({ graph }: MapViewProps) => (
      <MapListFallback graph={graph} />
    )) as React.FC<MapViewProps>,
  })),
);

/** A render error inside the canvas also falls back to the list. */
class MapBoundary extends Component<
  { graph: ManualGraph; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <MapListFallback graph={this.props.graph} /> : this.props.children;
  }
}

export const MapPanel: React.FC<{
  currentSlug?: string | null;
  onOpen: (slug: string) => void;
}> = ({ currentSlug, onOpen }) => {
  const copy = en.productManual.mapView;
  const { data, isLoading, isError, refetch } = useGetManualGraphQuery();
  if (isLoading) {
    return (
      <div className="h-[60vh] w-full" aria-busy="true" aria-label={copy.loading}>
        <SkeletonPlaceholder className="!h-full !w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ManualMessage title={copy.loadFailed} action={en.productManual.retry} onAction={refetch} />
    );
  }
  if (data.nodes.length === 0) {
    return <ManualMessage title={en.productManual.emptyManual} />;
  }
  if (data.edges.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <ManualMessage title={copy.noLinks} hint={copy.noLinksHint} />
        <MapListFallback graph={data} note={false} />
      </div>
    );
  }
  return (
    <div className="h-[calc(100vh-11rem)] min-h-[24rem] w-full border border-border-light">
      <MapBoundary graph={data}>
        <Suspense
          fallback={
            <div className="h-full w-full" aria-busy="true" aria-label={copy.loading}>
              <SkeletonPlaceholder className="!h-full !w-full" />
            </div>
          }
        >
          <LazyMapView graph={data} currentSlug={currentSlug} onOpen={onOpen} />
        </Suspense>
      </MapBoundary>
    </div>
  );
};
