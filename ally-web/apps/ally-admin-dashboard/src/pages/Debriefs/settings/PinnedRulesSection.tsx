import React from "react";

import { Link } from "react-router-dom";

import { useGetDebriefPinnedRulesQuery } from "@api";
import { en, ROUTES } from "@constants";

/**
 * Settings › Pinned rules: a read-only list of the prompts that decide what counts as safe, with
 * the version in force and who last changed it. They are edited in the Skills Store by a few
 * named people; the Debrief PM agent can read them but never change them.
 */
export const PinnedRulesSection: React.FC = () => {
  const s = en.debriefs.settingsPage.pinned;
  const q = useGetDebriefPinnedRulesQuery();
  const rules = q.data?.rules;
  if (!rules?.length) return <p className="text-sm text-neutral-600">{s.notYet}</p>;
  return (
    <div className="rounded-sm bg-neutral-50" data-testid="pinned-rules">
      {rules.map(r => (
        <div key={r.code} className="border-b border-neutral-100 px-5 py-3">
          <div className="grid grid-cols-[minmax(200px,1.4fr)_90px_minmax(200px,1.6fr)_160px] items-center gap-3 text-sm">
            <span className="font-medium">{r.label}</span>
            <span>{r.version == null ? "—" : `v${r.version}`}</span>
            <span className="text-[13px] text-neutral-700">
              {r.updatedBy || r.updatedAt
                ? s.updated(
                    r.updatedBy?.name ?? s.someone,
                    r.updatedAt
                      ? new Date(r.updatedAt).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })
                      : "",
                  )
                : s.writtenByEngineering}
            </span>
            <span>
              <Link
                to={ROUTES.MANAGE_PROMPTS}
                className="text-primary-500 underline"
                data-testid={`pinned-rule-open-${r.code}`}
                title={r.code}
              >
                {s.open}
              </Link>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};
