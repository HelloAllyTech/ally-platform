import React from "react";

import { TEMPLATES_ADMIN_COPY as C } from "./copy";
import {
  Card,
  Field,
  issuesAt,
  issuesOn,
  moveBy,
  Problems,
  removeAt,
  replaceAt,
  secondaryClass,
  Select,
  TextArea,
} from "./fields";

import type { FormProps } from "./BasicsForm";
import type { Ability, TemplateListUse } from "./templatesAdminApi";

const L = C.lists;
const MAX_LINE = 300;

const ABILITY_OPTIONS = [
  { value: "do_it", label: L.doIt },
  { value: "never", label: L.never },
];

/** The lists a template adds, with what the assistant may do on each. */
export const ListsForm: React.FC<FormProps> = ({ value: t, onChange, issues, meta }) => {
  const setLists = (lists: TemplateListUse[]) => onChange({ ...t, lists });
  const used = new Set(t.lists.map(l => l.key));
  const yesNo = t.setup.filter(q => q.kind === "yes_no");
  const metaOf = (key: string) => meta.lists.find(l => l.key === key);

  const add = (key: string) => {
    if (!key) return;
    setLists([...t.lists, { key, find: "do_it", create: "never", update: "never", line: "" }]);
  };

  return (
    <div className="space-y-3 max-w-3xl" data-testid="template-lists">
      <p className="text-sm text-typography-600">{L.intro}</p>
      <Problems issues={issuesOn(issues, "lists")} />
      {!t.lists.length && <p className="text-sm">{L.empty}</p>}

      {t.lists.map((use, i) => {
        const def = metaOf(use.key);
        const writable = Boolean(def?.fields.some(f => f.agent_write));
        const at = `lists.${i}`;
        const set = (patch: Partial<TemplateListUse>) =>
          setLists(replaceAt(t.lists, i, { ...use, ...patch }));
        const ability = (name: "find" | "create" | "update", label: string) => (
          <Field label={label} tip={L.abilityHint} issues={issuesOn(issues, `${at}.${name}`)}>
            <Select
              value={use[name]}
              onChange={v => set({ [name]: v as Ability })}
              options={ABILITY_OPTIONS.map(o => ({
                ...o,
                disabled: name !== "find" && !writable && o.value === "do_it",
              }))}
              testId={`list-${i}-${name}`}
            />
          </Field>
        );
        return (
          <Card
            key={`${use.key}-${i}`}
            testId={`template-list-${i}`}
            title={def?.name ?? use.key}
            problems={issuesAt(issues, at).filter(x => x.severity === "error").length}
            actions={
              <>
                <button
                  type="button"
                  className={secondaryClass}
                  disabled={i === 0}
                  onClick={() => setLists(moveBy(t.lists, i, -1))}
                  aria-label={L.up}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={secondaryClass}
                  disabled={i === t.lists.length - 1}
                  onClick={() => setLists(moveBy(t.lists, i, 1))}
                  aria-label={L.down}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={secondaryClass}
                  onClick={() => setLists(removeAt(t.lists, i))}
                >
                  {L.remove}
                </button>
              </>
            }
          >
            <Problems issues={issuesOn(issues, at).concat(issuesOn(issues, `${at}.key`))} />
            <div className="grid gap-3 sm:grid-cols-3">
              {ability("find", L.find)}
              {ability("create", L.create)}
              {ability("update", L.update)}
            </div>
            {!writable && <p className="text-xs text-typography-600">{L.noWrite}</p>}

            <Field
              label={L.line}
              hint={`${L.lineHint} ${L.count(use.line.length, MAX_LINE)}`}
              issues={issuesOn(issues, `${at}.line`)}
            >
              <TextArea
                value={use.line}
                onChange={v => set({ line: v })}
                rows={3}
                testId={`list-${i}-line`}
              />
            </Field>

            <Field label={L.onlyIf} tip={L.onlyIfHint} issues={issuesOn(issues, `${at}.only_if`)}>
              <Select
                value={use.only_if ?? ""}
                onChange={v => set({ only_if: v || undefined })}
                options={[
                  { value: "", label: L.always },
                  ...yesNo.map(q => ({ value: q.key, label: L.onlyIfYes(q.ask) })),
                ]}
              />
            </Field>
            {use.examples && use.examples.length > 0 && (
              <p className="text-xs text-typography-600">{L.examples(use.examples.length)}</p>
            )}
          </Card>
        );
      })}

      <Field label={L.add}>
        <Select
          value=""
          onChange={add}
          testId="list-add"
          options={[
            { value: "", label: L.choose },
            ...meta.lists.filter(l => !used.has(l.key)).map(l => ({ value: l.key, label: l.name })),
          ]}
        />
      </Field>
    </div>
  );
};
