import { useEffect, useState } from "react";

/**
 * How much of the layout viewport the on-screen keyboard covers (§4.17 "The keyboard never covers
 * the input"). Sticky bars and the composer lift by this much; the bottom bar hides while it is
 * above zero. Zero where `visualViewport` isn't supported, which is every desktop browser that
 * has no on-screen keyboard anyway.
 */
export const keyboardInset = (
  layoutHeight: number,
  viewport: { height: number; offsetTop: number } | null | undefined,
): number => {
  if (!viewport) return 0;
  const covered = layoutHeight - viewport.height - viewport.offsetTop;
  // Below ~80 px it's browser chrome resizing, not a keyboard.
  return covered > 80 ? Math.round(covered) : 0;
};

export const useKeyboardInset = (): number => {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!viewport) return undefined;
    const update = () => setInset(keyboardInset(window.innerHeight, viewport));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
};
