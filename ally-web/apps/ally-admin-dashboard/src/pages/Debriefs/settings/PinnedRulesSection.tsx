import React, { useState } from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import { useGetDebriefPinnedRulesQuery } from "@api";
import { en } from "@constants";

import { AskForChange } from "../pm/PinnedRule";

/**
 * Settings › Pinned rules: each rule's version in force and who approved it. The clinical
 * advisor and the owner may ask for a change to a rule here; it then waits in PM agent › Ideas.
 */
export const PinnedRulesSection: React.FC<{ canAsk: boolean }> = ({ canAsk }) => {
  const s = en.debriefs.settingsPage.pinned;
  const q = useGetDebriefPinnedRulesQuery();
  const [asking, setAsking] = useState<string | null>(null);
  const rules = q.data?.rules;
  if (!rules?.length) return <p className="text-sm text-neutral-600">{s.notYet}</p>;
  const waiting = (code: string) =>
    (q.data?.proposals ?? []).filter(x => x.change?.promptCode === code && !x.change?.firstVersion)
      .length;
  return (
    <div className="rounded-sm bg-neutral-50" data-testid="pinned-rules">
      {rules.map(r => (
        <div key={r.code} className="border-b border-neutral-100 px-5 py-3">
          <div className="grid grid-cols-[minmax(200px,1.4fr)_90px_minmax(200px,1.6fr)_160px] items-center gap-3 text-sm">
            <span className="font-medium">{r.label}</span>
            <span>{r.version == null ? "—" : `v${r.version}`}</span>
            <span className="text-[13px] text-neutral-700">
              {r.signedAt
                ? s.signed(
                    r.signedBy?.name ?? s.someone,
                    new Date(r.signedAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    }),
                  )
                : s.unsigned}
            </span>
            <span>
              {canAsk && r.text && asking !== r.code && (
                <Button kind="tertiary" size="sm" onClick={() => setAsking(r.code)}>
                  {s.askForChange}
                </Button>
              )}
            </span>
          </div>
          {asking === r.code && r.text && (
            <div className="mt-3">
              <AskForChange
                code={r.code}
                name={r.label.split(" (")[0]}
                text={r.text}
                otherOpen={waiting(r.code)}
                onClose={() => setAsking(null)}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
