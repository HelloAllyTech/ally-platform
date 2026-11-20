import { useEffect, useState } from "react";

/**
 * The four Roadmap layouts (§4.17), on Carbon's grid: phone < 672, tablet 672–1055,
 * laptop 1056–1311, desktop ≥ 1312. Rotating or resizing never loses state; the components switch
 * layout only, and everything that matters (open idea, tab, scroll) lives in the URL or above them.
 */
export type RoadmapBreakpoint = "phone" | "tablet" | "laptop" | "desktop";

export const ROADMAP_BREAKPOINTS = { tablet: 672, laptop: 1056, desktop: 1312 } as const;

export const breakpointFor = (width: number): RoadmapBreakpoint => {
  if (width >= ROADMAP_BREAKPOINTS.desktop) return "desktop";
  if (width >= ROADMAP_BREAKPOINTS.laptop) return "laptop";
  if (width >= ROADMAP_BREAKPOINTS.tablet) return "tablet";
  return "phone";
};

const currentWidth = (): number =>
  typeof window === "undefined" ? ROADMAP_BREAKPOINTS.desktop : window.innerWidth;

export const useRoadmapBreakpoint = (): RoadmapBreakpoint => {
  const [breakpoint, setBreakpoint] = useState<RoadmapBreakpoint>(() =>
    breakpointFor(currentWidth()),
  );
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setBreakpoint(breakpointFor(currentWidth())));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return breakpoint;
};

/** Reading pane beside the list: laptop and up. Below that a row opens the full page (§4.17). */
export const hasReadingPane = (bp: RoadmapBreakpoint): boolean =>
  bp === "laptop" || bp === "desktop";

/** The idea page's side panel sits in the layout only on desktop; laptop overlays it; below, tabs. */
export const sidePanelMode = (bp: RoadmapBreakpoint): "inline" | "overlay" | "sheet" | "tabs" => {
  switch (bp) {
    case "desktop":
      return "inline";
    case "laptop":
      return "overlay";
    case "tablet":
      return "sheet";
    default:
      return "tabs";
  }
};
