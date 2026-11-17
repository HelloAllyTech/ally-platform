import { FC, RefObject, useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import { useGetRoleplaySessionLogsQuery } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";

/** How many of the most recent sessions Newer / Older can step through. */
export const NAV_WINDOW = 100;

/**
 * Newer / Older session buttons. The list's filters are not shared with this page, so this steps
 * through the most recent sessions overall (newest first) and hides a button at either end or
 * when the session is older than the window.
 */
export const SessionPager: FC<{ sessionId: string }> = ({ sessionId }) => {
  const navigate = useNavigate();
  const { data } = useGetRoleplaySessionLogsQuery({ limit: NAV_WINDOW, offset: 0 });
  const rows = data?.data ?? [];
  const index = rows.findIndex(row => String(row.id) === String(sessionId));
  if (index < 0) return null;
  const newer = index > 0 ? rows[index - 1] : null;
  const older = index < rows.length - 1 ? rows[index + 1] : null;
  const go = (row: { id: string | number }) => navigate(ROUTES.ROLEPLAY_SESSION_LOG_DETAIL(row.id));
  return (
    <div className="flex items-center gap-2" data-testid="session-pager">
      <Button
        variant={ButtonVariant.TEXT}
        disabled={!newer}
        onClick={() => newer && go(newer)}
        className="h-[36px] px-2"
      >
        ← Newer
      </Button>
      <Button
        variant={ButtonVariant.TEXT}
        disabled={!older}
        onClick={() => older && go(older)}
        className="h-[36px] px-2"
      >
        Older →
      </Button>
    </div>
  );
};

/**
 * Jump links to every section on the page. Built from the page's own section headings, so it
 * stays right as sections appear or disappear with the data.
 */
export const SectionNav: FC<{ containerRef: RefObject<HTMLElement>; watchKey: unknown }> = ({
  containerRef,
  watchKey,
}) => {
  const [sections, setSections] = useState<{ title: string; el: HTMLElement }[]>([]);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const found = Array.from(root.querySelectorAll<HTMLElement>("section")).flatMap(section => {
      const heading = section.querySelector("h2");
      const title = heading?.textContent?.trim();
      return title ? [{ title, el: section }] : [];
    });
    setSections(found);
  }, [containerRef, watchKey]);
  if (sections.length < 2) return null;
  return (
    <nav
      aria-label="Sections"
      className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-sm"
      data-testid="section-nav"
    >
      {sections.map(s => (
        <button
          key={s.title}
          type="button"
          onClick={() => s.el.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="text-primary-500 hover:text-primary-600 underline-offset-2 hover:underline"
        >
          {s.title}
        </button>
      ))}
    </nav>
  );
};
