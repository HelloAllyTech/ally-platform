import React, { useEffect, useState } from "react";

import { useChoosePagesMutation, useGetFoundPagesQuery, useUndoPagesMutation } from "@api";
import { Button, Chip, PrimaryButton, Toast } from "@components/v2";

import { COPY, fill } from "./copy";
import { SHORTCUTS, choiceFrom, leftOutBy, pagesIn } from "./pageChoice";

const t = COPY.pages;

/**
 * Which pages should it read? (chunk 20a-2): the site's pages found so far, grouped by section,
 * each with a checkbox, plus "Leave out blog and news" and "Leave out careers". Saving the choice
 * applies to every page not read yet; pages already read that it leaves out are forgotten, with
 * Undo. The home page is always read.
 */
export const ChoosePages: React.FC<{ draftId: string; onClose: () => void }> = ({
  draftId,
  onClose,
}) => {
  const found = useGetFoundPagesQuery(draftId);
  const [choose, choosing] = useChoosePagesMutation();
  const [undo] = useUndoPagesMutation();
  const [leftOut, setLeftOut] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<{ message: string; eventId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (found.data) setLeftOut(leftOutBy(found.data));
  }, [found.data]);

  const toggle = (urls: string[], out: boolean) =>
    setLeftOut(current => {
      const next = new Set(current);
      for (const url of urls) {
        if (out) next.add(url);
        else next.delete(url);
      }
      return next;
    });

  const shortcut = (sections: readonly string[]) => {
    if (!found.data) return;
    const urls = pagesIn(found.data, sections);
    toggle(urls, !urls.every(url => leftOut.has(url)));
  };

  const save = async () => {
    if (!found.data) return;
    setError(null);
    try {
      const result = await choose({ id: draftId, ...choiceFrom(found.data, leftOut) }).unwrap();
      setSaved({
        message: result.removed ? fill(t.forgot, { n: result.removed }) : t.saved,
        eventId: result.eventId,
      });
    } catch {
      setError(COPY.problems.generic);
    }
  };

  return (
    <section className="ally-card ally-pages" data-testid="choose-pages">
      <h2 className="ally-heading">{t.title}</h2>
      <p className="ally-small">{t.note}</p>
      <div className="ally-pages__shortcuts">
        <Chip onToggle={() => shortcut(SHORTCUTS.blog)}>{t.leaveOutBlog}</Chip>
        <Chip onToggle={() => shortcut(SHORTCUTS.careers)}>{t.leaveOutCareers}</Chip>
      </div>
      {found.isLoading && <p className="ally-small">{COPY.working.thinking}</p>}
      {found.isError && <p className="ally-error">{COPY.problems.generic}</p>}
      <div className="ally-pages__groups">
        {(found.data?.groups ?? []).map(group => {
          const urls = group.pages.map(page => page.url);
          const allIn = urls.every(url => !leftOut.has(url));
          return (
            <fieldset key={group.section || "home"} className="ally-pages__group">
              <legend className="ally-label">
                {group.section ? (
                  <label>
                    <input type="checkbox" checked={allIn} onChange={() => toggle(urls, allIn)} />{" "}
                    {fill(t.all, { section: group.section })}
                  </label>
                ) : (
                  t.home
                )}
              </legend>
              <ul>
                {group.pages.map(page => (
                  <li key={page.url}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!group.section || !leftOut.has(page.url)}
                        disabled={!group.section}
                        onChange={() => toggle([page.url], !leftOut.has(page.url))}
                      />{" "}
                      <span>{page.title || page.path}</span>
                      {!page.read && <span className="ally-small"> · {t.notRead}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
      <div className="ally-btn-row">
        <PrimaryButton onClick={() => void save()} disabled={!found.data || choosing.isLoading}>
          {t.save}
        </PrimaryButton>
        <Button variant="ghost" onClick={onClose}>
          {t.readEverything}
        </Button>
      </div>
      {saved && (
        <Toast
          message={saved.message}
          actionLabel={saved.eventId ? t.undo : undefined}
          onAction={
            saved.eventId ? () => void undo({ id: draftId, eventId: saved.eventId! }) : undefined
          }
          onDone={() => {
            setSaved(null);
            onClose();
          }}
        />
      )}
    </section>
  );
};
