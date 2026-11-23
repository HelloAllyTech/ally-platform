import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { Button, TextInput } from "@ally-ui-mono/ui-shared";
import { useGetDebriefClinicalListsQuery, useUpdateDebriefClinicalListMutation } from "@api";
import { en } from "@constants";
import { DebriefClinicalListKind } from "@types";
import { getErrorMessage } from "@utils";

/**
 * Settings › Clinical lists: the words the score, diagnosis and jargon checks look for, per
 * language. Master–detail: the lists on the left, one list's words for one language on the right.
 * Everyone with the console reads them; the clinical advisor and the owner change them (ally-be
 * enforces the same). Entries are plain words or phrases; ally-be never treats them as patterns.
 */
export const ClinicalListsSection: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const s = en.debriefs.settingsPage.clinical;
  const q = useGetDebriefClinicalListsQuery();
  const [save, saving] = useUpdateDebriefClinicalListMutation();
  const [kind, setKind] = useState<DebriefClinicalListKind>("jargon");
  const [language, setLanguage] = useState("en");
  const [draft, setDraft] = useState<string[] | null>(null);
  const [adding, setAdding] = useState("");
  const saved = q.data?.lists[kind]?.[language] ?? [];

  // A new list or language starts from what is saved.
  useEffect(() => {
    setDraft(null);
    setAdding("");
  }, [kind, language]);

  if (q.isLoading) return <p className="text-sm text-neutral-600">{s.loading}</p>;
  if (!q.data) return <p className="text-sm text-neutral-600">{s.loadFailed}</p>;
  const words = draft ?? saved;
  const changed = draft !== null && draft.join("\n") !== saved.join("\n");

  const add = () => {
    const w = adding.trim().replace(/\s+/g, " ");
    if (!w || words.some(x => x.toLowerCase() === w.toLowerCase())) return setAdding("");
    setDraft([...words, w]);
    setAdding("");
  };
  const submit = async (entries: string[] | null) => {
    try {
      await save({ kind, language, entries }).unwrap();
      setDraft(null);
      toast.success(s.saved);
    } catch (e) {
      toast.error(getErrorMessage(e, s.saveFailed));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {!canEdit && <p className="text-[13px] text-neutral-600">{s.viewOnly}</p>}
      <div
        className="grid grid-cols-[minmax(180px,240px)_minmax(0,1fr)] gap-4"
        data-testid="clinical-lists"
      >
        <nav aria-label={s.lists} className="flex flex-col rounded-sm bg-neutral-50">
          {q.data.kinds.map(k => (
            <button
              key={k.kind}
              type="button"
              aria-current={k.kind === kind ? "true" : undefined}
              onClick={() => setKind(k.kind)}
              data-testid={`clinical-kind-${k.kind}`}
              className={`flex flex-nowrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3 text-left text-sm ${k.kind === kind ? "bg-white font-semibold" : ""}`}
            >
              <span className="truncate" title={k.label}>
                {k.label}
              </span>
              <span className="shrink-0 text-[13px] text-neutral-600">
                {s.count((q.data?.lists[k.kind]?.[language] ?? []).length)}
              </span>
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-3">
          <div
            role="tablist"
            aria-label={s.language}
            className="flex flex-nowrap gap-4 overflow-x-auto border-b border-neutral-100 text-sm"
          >
            {q.data.languages.map(l => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={l === language}
                onClick={() => setLanguage(l)}
                data-testid={`clinical-lang-${l}`}
                className={`whitespace-nowrap py-2 ${l === language ? "border-b-2 border-primary-500 font-semibold" : "text-neutral-600"}`}
              >
                {s.languages[l] ?? l}
              </button>
            ))}
          </div>
          {words.length === 0 ? (
            <p className="text-sm text-neutral-600">{s.empty}</p>
          ) : (
            <ul className="flex flex-col" data-testid="clinical-words">
              {words.map(w => (
                <li
                  key={w}
                  className="flex flex-nowrap items-center justify-between gap-2 border-b border-neutral-100 py-1.5 text-sm"
                >
                  <span className="truncate" title={w}>
                    {w}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={s.remove(w)}
                      title={s.remove(w)}
                      className="shrink-0 text-neutral-600 hover:text-typography-900"
                      onClick={() => setDraft(words.filter(x => x !== w))}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="flex flex-nowrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextInput
                  id="clinical-add"
                  labelText={s.addLabel}
                  value={adding}
                  maxLength={80}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdding(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === "Enter") add();
                  }}
                />
              </div>
              <Button kind="tertiary" size="md" onClick={add} disabled={!adding.trim()}>
                {s.add}
              </Button>
              <Button
                kind="primary"
                size="md"
                onClick={() => void submit(words)}
                disabled={!changed || saving.isLoading}
              >
                {s.save}
              </Button>
              <Button
                kind="ghost"
                size="md"
                onClick={() => void submit(null)}
                disabled={saving.isLoading}
              >
                {s.restore}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
