import { useEffect, useState } from "react";

const read = () => (typeof window === "undefined" ? 1280 : window.innerWidth);

/** The window width, kept current on resize (layout breakpoints in plan §5.2). */
export const useViewportWidth = (): number => {
  const [width, setWidth] = useState(read);
  useEffect(() => {
    const onResize = () => setWidth(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
};

export const PHONE_MAX = 767;
export const DESKTOP_MIN = 1280;
/** The Spine is pinned open by default from here (plan §5.2). */
export const SPINE_PINNED_MIN = 1440;
export const STAGE_MIN = 480;
export const SPINE_RAIL = { tablet: 48, desktop: 64, open: 280 };

/** Push the Stage aside only on desktop, and only if the Stage keeps 480 px (plan §5.2). */
export const shelfMode = (
  width: number,
  shelf: "reading" | "utility",
  spinePinned: boolean,
): "push" | "overlay" => {
  if (width < DESKTOP_MIN) return "overlay";
  const shelfWidth = shelf === "reading" ? Math.min(720, width * 0.55) : 400;
  const spineWidth = spinePinned ? SPINE_RAIL.open : SPINE_RAIL.desktop;
  return width - spineWidth - shelfWidth >= STAGE_MIN ? "push" : "overlay";
};
