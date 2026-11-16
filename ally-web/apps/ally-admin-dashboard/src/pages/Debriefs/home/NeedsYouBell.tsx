import React, { useEffect, useRef, useState } from "react";

import { Bell } from "lucide-react";
import { Link } from "react-router-dom";

import { en } from "@constants";
import { DebriefHomeV2 } from "@types";

import { changesPath } from "../consoleRoutes";

/**
 * Needs you on Home (review 2026-11-16): a bell with a count, not a section. Each waiting change
 * opens on the PM agent page, where the whole change, the decision buttons and its own
 * conversation are; nothing is decided from Home. Closes on a click elsewhere or Esc.
 */
export const NeedsYouBell: React.FC<{ items: DebriefHomeV2["needsYou"] }> = ({ items }) => {
  const t = en.debriefs.v2.home;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const n = items.length;
  return (
    <div ref={ref} className="relative shrink-0" data-testid="needs-you-bell">
      <button
        type="button"
        aria-label={t.bellLabel(n)}
        title={t.bellLabel(n)}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(o => !o)}
        className="relative flex h-9 w-10 items-center justify-center rounded-sm border border-neutral-400 bg-white"
      >
        <Bell aria-hidden="true" className="h-4 w-4 text-typography-900" />
        {n > 0 && (
          <span
            data-testid="needs-you-count"
            className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-[#DA1E28] px-[5px] py-px text-center text-[11px] font-semibold text-white"
          >
            {n}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="needs-you-menu"
          className="absolute right-0 top-11 z-20 flex w-[380px] max-w-[calc(100vw-32px)] flex-col border border-neutral-100 bg-white shadow-lg"
        >
          <div className="border-b border-neutral-100 px-4 py-2.5 text-sm font-semibold">
            {t.bellLabel(n)}
          </div>
          {n === 0 ? (
            <p className="m-0 px-4 py-3 text-sm text-neutral-600">{t.bellEmpty}</p>
          ) : (
            items.map(i => (
              <Link
                key={i.changeId}
                role="menuitem"
                to={changesPath(i.changeId)}
                onClick={() => setOpen(false)}
                data-testid="needs-you-link"
                className="flex min-w-0 flex-col gap-0.5 border-b border-neutral-100 px-4 py-2.5 text-typography-900 no-underline hover:bg-neutral-50"
              >
                <span className="truncate text-sm font-medium">{i.title}</span>
                {i.why && <span className="truncate text-[13px] text-neutral-600">{i.why}</span>}
              </Link>
            ))
          )}
          <Link
            role="menuitem"
            to={changesPath()}
            onClick={() => setOpen(false)}
            className="px-4 py-2.5 text-[13px] text-primary-500"
          >
            {t.bellOpenAll}
          </Link>
        </div>
      )}
    </div>
  );
};
