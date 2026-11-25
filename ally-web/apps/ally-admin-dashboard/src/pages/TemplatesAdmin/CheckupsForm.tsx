import React from "react";

import { TEMPLATES_ADMIN_COPY as C } from "./copy";
import {
  Card,
  Check,
  Field,
  fromLines,
  issuesAt,
  issuesOn,
  Problems,
  removeAt,
  replaceAt,
  secondaryClass,
  Select,
  TextArea,
  TextInput,
  toLines,
} from "./fields";

import type { FormProps } from "./BasicsForm";
import type { CheckupExpect, StarterCase } from "./templatesAdminApi";

const K = C.checkups;
const MAX_CHECKUPS = 8;

/** The starter questions added to an assistant's Checkup. */
export const CheckupsForm: React.FC<FormProps> = ({ value: t, onChange, issues, meta }) => {
  const setCheckups = (checkups: StarterCase[]) => onChange({ ...t, checkups });
  const listName = (key: string) => meta.lists.find(l => l.key === key)?.name ?? key;

  const add = () =>
    setCheckups([
      ...t.checkups,
      { id: `question_${t.checkups.length + 1}`, send: "", expect: "answer", facts: [] },
    ]);

  return (
    <div className="space-y-3 max-w-3xl" data-testid="template-checkups">
      <p className="text-sm text-typography-600">{K.intro}</p>
      <Problems issues={issuesOn(issues, "checkups")} />
      {!t.checkups.length && <p className="text-sm">{K.empty}</p>}

      {t.checkups.map((c, i) => {
        const at = `checkups.${i}`;
        const set = (patch: Partial<StarterCase>) =>
          setCheckups(replaceAt(t.checkups, i, { ...c, ...patch }));
        return (
          <Card
            key={i}
            testId={`template-checkup-${i}`}
            title={c.send || `Question ${i + 1}`}
            problems={issuesAt(issues, at).filter(x => x.severity === "error").length}
            actions={
              <button
                type="button"
                className={secondaryClass}
                onClick={() => setCheckups(removeAt(t.checkups, i))}
              >
                {K.remove}
              </button>
            }
          >
            <Field label={K.send} issues={issuesOn(issues, `${at}.send`)}>
              <TextInput value={c.send} onChange={v => set({ send: v })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={K.id} issues={issuesOn(issues, `${at}.id`)}>
                <TextInput value={c.id} onChange={v => set({ id: v })} />
              </Field>
              <Field label={K.expect} issues={issuesOn(issues, `${at}.expect`)}>
                <Select
                  value={c.expect}
                  onChange={v => set({ expect: v as CheckupExpect })}
                  options={Object.entries(K.expects).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label={K.needs} issues={issuesOn(issues, `${at}.needs`)}>
                <Select
                  value={c.needs ?? ""}
                  onChange={v => set({ needs: v || undefined })}
                  options={[
                    { value: "", label: K.anyList },
                    ...t.lists.map(l => ({ value: l.key, label: listName(l.key) })),
                  ]}
                />
              </Field>
            </div>
            <Field label={K.facts} hint={K.factsHint} issues={issuesOn(issues, `${at}.facts`)}>
              <TextArea
                value={fromLines(c.facts)}
                onChange={v => set({ facts: toLines(v) })}
                rows={3}
                testId={`checkup-${i}-facts`}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={K.mustNot}>
                <TextArea
                  value={fromLines(c.must_not)}
                  onChange={v => set({ must_not: toLines(v) })}
                  rows={2}
                />
              </Field>
              <Field label={K.alsoOk}>
                <TextArea
                  value={fromLines(c.also_ok)}
                  onChange={v => set({ also_ok: toLines(v) })}
                  rows={2}
                />
              </Field>
            </div>
            <Check
              label={K.hardFail}
              checked={Boolean(c.hard_fail)}
              onChange={v => set({ hard_fail: v || undefined })}
            />
          </Card>
        );
      })}

      <button
        type="button"
        className={secondaryClass}
        onClick={add}
        disabled={t.checkups.length >= MAX_CHECKUPS}
        data-testid="checkup-add"
      >
        {K.add}
      </button>
    </div>
  );
};
