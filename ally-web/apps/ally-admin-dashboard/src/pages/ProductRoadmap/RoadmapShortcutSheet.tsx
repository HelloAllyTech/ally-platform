import React, { useEffect, useRef } from "react";

import { en } from "@constants";

interface Shortcut {
  keys: string[];
  label: string;
}

/**
 * Built inside the component, never at module scope: it reads `en`, and a top-level object off the
 * `@constants` barrel is the pattern that broke nine admin suites once (see BugHunter's sheet).
 */
const groups = (canDecide: boolean): { title: string; shortcuts: Shortcut[] }[] => {
  const t = en.roadmapTriage;
  return [
    {
      title: t.shortcutsGroupMove,
      shortcuts: [
        { keys: ["j", "↓"], label: t.shortcutsMoveDown },
        { keys: ["k", "↑"], label: t.shortcutsMoveUp },
        { keys: ["o", "Enter"], label: t.shortcutsOpen },
        { keys: ["/"], label: t.shortcutsSearch },
        { keys: ["Esc"], label: t.shortcutsEscape },
        { keys: ["?"], label: t.shortcutsHelp },
      ],
    },
    // Decisions are dropped, not greyed, for a reader who cannot make them: a card listing keys
    // that silently do nothing reads as broken shortcuts rather than as keys that are not theirs.
    ...(canDecide
      ? [
          {
            title: t.shortcutsGroupAct,
            shortcuts: [
              { keys: ["a"], label: t.shortcutsAccept },
              { keys: ["r"], label: t.shortcutsReject },
              { keys: ["u"], label: t.shortcutsAssignToMe },
              { keys: ["z"], label: t.shortcutsUndo },
            ],
          },
        ]
      : []),
  ];
};

const KeyCap: React.FC<{ children: string }> = ({ children }) => (
  <kbd className="border-border-light text-typography-800 inline-flex min-w-[1.5rem] items-center justify-center rounded border bg-neutral-50 px-1.5 py-0.5 font-mono text-xs">
    {children}
  </kbd>
);

/** The `?` overlay: a reference card with one action, close. Escape closes it and stops there. */
export const RoadmapShortcutSheet: React.FC<{ onClose: () => void; canDecide: boolean }> = ({
  onClose,
  canDecide,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="roadmap-shortcuts-heading"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-lg"
        onClick={event => event.stopPropagation()}
      >
        <h2 id="roadmap-shortcuts-heading" className="text-typography-900 text-base font-semibold">
          {en.roadmapTriage.shortcutsTitle}
        </h2>
        <p className="text-typography-600 mt-1 text-xs">{en.roadmapTriage.shortcutsIntro}</p>
        <div className="mt-4 flex flex-col gap-4">
          {groups(canDecide).map(group => (
            <div key={group.title}>
              <p className="text-typography-500 mb-2 text-xs">{group.title}</p>
              <ul className="flex flex-col gap-1.5">
                {group.shortcuts.map(shortcut => (
                  <li key={shortcut.label} className="flex items-center justify-between gap-4">
                    <span className="text-typography-800 text-sm">{shortcut.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {shortcut.keys.map(key => (
                        <KeyCap key={key}>{key}</KeyCap>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="border-border-light text-typography-800 cursor-pointer rounded border px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            {en.roadmapTriage.shortcutsClose}
          </button>
        </div>
      </div>
    </div>
  );
};
