import React, { useState } from "react";

import { TEMPLATES_ADMIN_COPY as C } from "./copy";
import { day, secondaryClass } from "./fields";
import { useRestoreTemplateVersionMutation } from "./templatesAdminApi";

import type { TemplateDetail } from "./templatesAdminApi";

const H = C.history;

/** Every stored version of a template, with "open as a new draft" for any of them. */
export const HistoryPanel: React.FC<{
  detail: TemplateDetail;
  /** After a restore opened a draft. */
  onRestored: () => void;
}> = ({ detail, onRestored }) => {
  const [restore, { isLoading }] = useRestoreTemplateVersionMutation();
  const [message, setMessage] = useState<string | null>(null);
  const hasDraft = Boolean(detail.draft);

  const open = async (version: number) => {
    if (!window.confirm(H.restoreConfirm(version))) return;
    setMessage(null);
    try {
      await restore({ key: detail.key, version }).unwrap();
      onRestored();
    } catch {
      setMessage(H.restoreFailed);
    }
  };

  return (
    <div className="space-y-3 max-w-3xl" data-testid="template-history">
      <p className="text-sm text-typography-600">{H.intro}</p>
      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
      {detail.origin === "built_in" && <p className="text-sm">{H.builtIn}</p>}
      {!detail.versions.length && detail.origin === "custom" && <p className="text-sm">{H.none}</p>}
      <ul className="space-y-2">
        {detail.versions.map(v => (
          <li
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-light p-3"
            data-testid={`history-version-${v.version}`}
          >
            <div className="text-sm">
              <p className="font-medium">
                {H.version(v.version)} · {H.status[v.status]}
              </p>
              <p className="text-xs text-typography-600">
                {v.published_at ? H.published(day(v.published_at)) : H.created(day(v.created_at))}
              </p>
              {v.note && <p className="text-xs">{v.note}</p>}
            </div>
            {v.status !== "draft" && (
              <button
                type="button"
                className={secondaryClass}
                disabled={hasDraft || isLoading}
                title={hasDraft ? H.needsNoDraft : undefined}
                onClick={() => open(v.version)}
              >
                {H.restore}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
