import React, { useCallback, useEffect, useId, useRef, useState } from "react";

/** Two halves need room: below this width the build and test areas become tabs. */
export const SPLIT_MIN_WIDTH = 1280;
/** The build half's share of the width, in percent (the test half gets the rest). */
export const SPLIT_MIN = 30;
export const SPLIT_MAX = 70;
const STEP = 2;
const STEP_BIG = 10;

export const SPLIT_STORAGE_KEY = "ally.onboarding.split.layout";

export interface SplitBuildLabels {
  /** Accessible name of the whole layout and of the tab list. */
  group: string;
  build: string;
  test: string;
  /** Accessible name of the draggable divider. */
  divider: string;
}

interface Layout {
  /** The build half's width, in percent. */
  pct: number;
}

const DEFAULT_LAYOUT: Layout = { pct: 50 };

const clamp = (n: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n));

const readLayout = (): Layout => {
  try {
    const raw = window.localStorage.getItem(SPLIT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    // An older "assistant only" choice (`only: true`) is dropped; the width it kept is used.
    const parsed = JSON.parse(raw) as Partial<Layout>;
    return { pct: typeof parsed.pct === "number" ? clamp(parsed.pct) : DEFAULT_LAYOUT.pct };
  } catch {
    return DEFAULT_LAYOUT;
  }
};

const writeLayout = (layout: Layout) => {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // no storage: the choice lasts until the page closes
  }
};

/** True while the viewport is at least `SPLIT_MIN_WIDTH` wide; follows resizes. */
export const useWideViewport = (): boolean => {
  const query = `(min-width: ${SPLIT_MIN_WIDTH}px)`;
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setWide(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return wide;
};

/**
 * Build beside test. From 1280 px: two halves with a draggable divider. Narrower: "Build" and "Test"
 * tabs, one at a time. Both slots stay mounted either way, so a half you can't see keeps its
 * state (a chat in progress, a field being typed in). The build half comes first in the tab
 * order, then the divider, then the test half.
 */
export const SplitBuild: React.FC<{
  build: React.ReactNode;
  test: React.ReactNode;
  labels: SplitBuildLabels;
}> = ({ build, test, labels }) => {
  const wide = useWideViewport();
  const [layout, setLayout] = useState<Layout>(readLayout);
  const root = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const apply = useCallback((next: Layout) => {
    setLayout(next);
    writeLayout(next);
  }, []);

  const onResizeStart = (event: React.PointerEvent) => {
    event.preventDefault();
    const box = root.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const move = (e: PointerEvent) => {
      setLayout({ pct: clamp(((e.clientX - box.left) / box.width) * 100) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      writeLayout(layoutRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onResizeKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? STEP_BIG : STEP;
    let pct: number;
    switch (event.key) {
      case "ArrowLeft":
        pct = layout.pct - step;
        break;
      case "ArrowRight":
        pct = layout.pct + step;
        break;
      case "Home":
        pct = SPLIT_MIN;
        break;
      case "End":
        pct = SPLIT_MAX;
        break;
      default:
        return;
    }
    event.preventDefault();
    apply({ pct: clamp(pct) });
  };

  const ids = useId();
  const [tab, setTab] = useState<"build" | "test">("build");

  if (!wide) {
    const tabs = ["build", "test"] as const;
    const onTabKey = (event: React.KeyboardEvent) => {
      const at = tabs.indexOf(tab);
      let next = at;
      if (event.key === "ArrowRight") next = (at + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (at + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      setTab(tabs[next]);
      document.getElementById(`${ids}-tab-${tabs[next]}`)?.focus();
    };
    return (
      <div className="ally-split ally-split--tabs">
        <div role="tablist" aria-label={labels.group} className="ally-split__tabs">
          {tabs.map(key => (
            <button
              key={key}
              id={`${ids}-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`${ids}-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              className="ally-split__tab ally-press"
              onClick={() => setTab(key)}
              onKeyDown={onTabKey}
            >
              {labels[key]}
            </button>
          ))}
        </div>
        {tabs.map(key => (
          <div
            key={key}
            id={`${ids}-panel-${key}`}
            role="tabpanel"
            aria-labelledby={`${ids}-tab-${key}`}
            hidden={tab !== key}
            className="ally-split__pane ally-split__pane--tab"
          >
            {key === "build" ? build : test}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={root}
      role="group"
      aria-label={labels.group}
      className="ally-split"
      style={{ ["--split-build" as string]: `${layout.pct}%` }}
    >
      <div className="ally-split__pane ally-split__pane--build">{build}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={labels.divider}
        aria-valuemin={SPLIT_MIN}
        aria-valuemax={SPLIT_MAX}
        aria-valuenow={Math.round(layout.pct)}
        tabIndex={0}
        className="ally-split__divider"
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKey}
      />
      <div className="ally-split__pane ally-split__pane--test">
        <div className="ally-split__test">{test}</div>
      </div>
    </div>
  );
};
