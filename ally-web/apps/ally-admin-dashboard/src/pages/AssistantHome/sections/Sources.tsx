import React, { useState } from "react";

import {
  usePreviewSourceMutation,
  useGetSourcesQuery,
  useRemoveSourceMutation,
  useRestoreSourceMutation,
} from "@api";
import { Button } from "@components/v2";

import { COPY, fill } from "../../Onboarding/copy";
import { HOME } from "../copy";

const t = HOME.sources;

/**
 * What it knows → Sources (chunk 20a-2): each page it learned from, with how many details came
 * from it. Remove shows how many it will forget first; a removed page can be put back.
 */
export const SourcesList: React.FC<{ botId: string; canEdit: boolean }> = ({ botId, canEdit }) => {
  const { data: pages = [] } = useGetSourcesQuery(botId);
  const [preview, previewing] = usePreviewSourceMutation();
  const [remove, removing] = useRemoveSourceMutation();
  const [restore, restoring] = useRestoreSourceMutation();
  const [confirming, setConfirming] = useState<{
    url: string;
    title: string;
    details: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!pages.length) return null;
  const busy = previewing.isLoading || removing.isLoading || restoring.isLoading;

  return (
    <div data-testid="knows-sources">
      <ul className="ally-home__docs">
        {pages.map(page => (
          <li key={page.url} data-removed={page.removed}>
            <a href={page.url} target="_blank" rel="noreferrer" className="ally-link">
              {page.title || page.url}
            </a>
            <span className="ally-small">
              {page.removed ? t.removed : fill(t.details, { n: page.details })}
            </span>
            {canEdit && !page.removed && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  try {
                    const counted = await preview({ id: botId, url: page.url }).unwrap();
                    setConfirming({
                      url: page.url,
                      title: page.title || page.url,
                      details: counted.details,
                    });
                  } catch {
                    setError(COPY.problems.generic);
                  }
                }}
              >
                {t.remove}
              </Button>
            )}
            {canEdit && page.removed && page.eventId && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void restore({ id: botId, eventId: page.eventId! })}
              >
                {t.putBack}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {confirming && (
        <div className="ally-card" role="alertdialog" aria-label={t.remove}>
          <p className="ally-body">
            {fill(t.confirm, { page: confirming.title, n: confirming.details })}
          </p>
          <div className="ally-btn-row">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                try {
                  await remove({ id: botId, url: confirming.url }).unwrap();
                  setConfirming(null);
                } catch {
                  setError(COPY.problems.generic);
                }
              }}
            >
              {t.remove}
            </Button>
            <Button onClick={() => setConfirming(null)}>{t.keep}</Button>
          </div>
        </div>
      )}
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
