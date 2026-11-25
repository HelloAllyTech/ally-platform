import React from "react";

import { TEMPLATES_ADMIN_COPY as C } from "./copy";
import {
  Card,
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
import type { SetupFill, SetupKind, SetupQuestion, TemplateManifest } from "./templatesAdminApi";

const S = C.setup;
const MAX_QUESTIONS = 4;

/** A destination of the right shape for its type, keeping what carries over. */
const fillOf = (to: SetupFill["to"], previous: SetupFill): SetupFill => {
  const list = "list" in previous && typeof previous.list === "string" ? previous.list : "";
  switch (to) {
    case "entries":
      return { to, list, columns: [] };
    case "field":
    case "options":
      return { to, list, field: "" };
    case "pack":
      return { to, pack: "standard" };
    default:
      return { to } as SetupFill;
  }
};

const FillRow: React.FC<{
  fill: SetupFill;
  onChange: (next: SetupFill) => void;
  onRemove: () => void;
  template: TemplateManifest;
  meta: FormProps["meta"];
  problems: FormProps["issues"];
  testId: string;
}> = ({ fill, onChange, onRemove, template, meta, problems, testId }) => {
  const listKeys = template.lists.map(l => l.key);
  const listName = (key: string) => meta.lists.find(l => l.key === key)?.name ?? key;
  const fieldsOf = (key: string) => meta.lists.find(l => l.key === key)?.fields ?? [];
  const listValue =
    fill.to === "entries" || fill.to === "field" || fill.to === "options" ? fill.list : "";
  const hasList = fill.to === "entries" || fill.to === "field" || fill.to === "options";

  return (
    <div className="rounded-md bg-surface-100 p-2 space-y-2" data-testid={testId}>
      <div className="flex items-end gap-2">
        <Field label={S.fills} className="flex-1">
          <Select
            value={fill.to}
            onChange={v => onChange(fillOf(v as SetupFill["to"], fill))}
            options={Object.entries(S.fillTypes).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <button type="button" className={secondaryClass} onClick={onRemove}>
          {S.remove}
        </button>
      </div>

      {hasList && (
        <Field label={S.list}>
          <Select
            value={listValue}
            onChange={v => onChange({ ...fill, list: v } as SetupFill)}
            options={[
              { value: "", label: C.lists.choose },
              ...listKeys.map(k => ({ value: k, label: listName(k) })),
            ]}
          />
        </Field>
      )}

      {fill.to === "entries" && listValue && (
        <Field
          label={S.columns}
          hint={`${S.columnsHint} ${S.available(
            fieldsOf(listValue)
              .map(f => f.key)
              .join(", "),
          )}`}
        >
          <TextInput
            value={fill.columns.join(", ")}
            onChange={v =>
              onChange({
                ...fill,
                columns: v
                  .split(",")
                  .map(s => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      )}

      {(fill.to === "field" || fill.to === "options") && listValue && (
        <Field label={S.field}>
          <Select
            value={fill.field}
            onChange={v => onChange({ ...fill, field: v })}
            options={[
              { value: "", label: C.lists.choose },
              ...fieldsOf(listValue)
                .filter(f => fill.to !== "options" || f.example_options)
                .map(f => ({ value: f.key, label: f.label })),
            ]}
          />
        </Field>
      )}

      {fill.to === "pack" && (
        <Field label={S.pack}>
          <Select
            value={fill.pack}
            onChange={v => onChange({ ...fill, pack: v })}
            options={meta.packs.map(p => ({ value: p.id, label: p.name }))}
          />
        </Field>
      )}
      <Problems issues={problems} />
    </div>
  );
};

/** The questions the owner answers once, and where each answer goes. */
export const SetupForm: React.FC<FormProps> = ({ value: t, onChange, issues, meta }) => {
  const setSetup = (setup: SetupQuestion[], lists = t.lists) => onChange({ ...t, setup, lists });

  const add = () =>
    setSetup([
      ...t.setup,
      {
        key: `question_${t.setup.length + 1}`,
        ask: "",
        kind: "long_text",
        fills: [{ to: "fact" }],
      },
    ]);

  const rename = (i: number, key: string) => {
    const old = t.setup[i].key;
    setSetup(
      replaceAt(t.setup, i, { ...t.setup[i], key }),
      t.lists.map(l => (l.only_if === old ? { ...l, only_if: key } : l)),
    );
  };

  const remove = (i: number) => {
    const old = t.setup[i].key;
    setSetup(
      removeAt(t.setup, i),
      t.lists.map(l => (l.only_if === old ? { ...l, only_if: undefined } : l)),
    );
  };

  return (
    <div className="space-y-3 max-w-3xl" data-testid="template-setup">
      <p className="text-sm text-typography-600">{S.intro}</p>
      <Problems issues={issuesOn(issues, "setup")} />
      {!t.setup.length && <p className="text-sm">{S.empty}</p>}

      {t.setup.map((q, i) => {
        const at = `setup.${i}`;
        const set = (patch: Partial<SetupQuestion>) =>
          setSetup(replaceAt(t.setup, i, { ...q, ...patch }));
        return (
          <Card
            key={i}
            testId={`template-setup-${i}`}
            title={q.ask || `Question ${i + 1}`}
            problems={issuesAt(issues, at).filter(x => x.severity === "error").length}
            actions={
              <button type="button" className={secondaryClass} onClick={() => remove(i)}>
                {S.remove}
              </button>
            }
          >
            <Field label={S.ask} issues={issuesOn(issues, `${at}.ask`)}>
              <TextInput value={q.ask} onChange={v => set({ ask: v })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={S.key} tip={S.keyHint} issues={issuesOn(issues, `${at}.key`)}>
                <TextInput value={q.key} onChange={v => rename(i, v)} />
              </Field>
              <Field label={S.kind} issues={issuesOn(issues, `${at}.kind`)}>
                <Select
                  value={q.kind}
                  onChange={v => set({ kind: v as SetupKind })}
                  options={Object.entries(S.kinds).map(([value, label]) => ({ value, label }))}
                />
              </Field>
            </div>
            {q.kind === "choices" && (
              <Field
                label={S.choices}
                hint={S.choicesHint}
                issues={issuesOn(issues, `${at}.choices`)}
              >
                <TextArea
                  value={fromLines(q.choices)}
                  onChange={v => set({ choices: toLines(v) })}
                  rows={3}
                />
              </Field>
            )}
            <Field label={S.hint}>
              <TextInput value={q.hint ?? ""} onChange={v => set({ hint: v || undefined })} />
            </Field>

            <div className="space-y-2">
              <Problems issues={issuesOn(issues, `${at}.fills`)} />
              {q.fills.map((fill, f) => (
                <FillRow
                  key={f}
                  testId={`setup-${i}-fill-${f}`}
                  fill={fill}
                  template={t}
                  meta={meta}
                  problems={issuesOn(issues, `${at}.fills.${f}`)}
                  onChange={next => set({ fills: replaceAt(q.fills, f, next) })}
                  onRemove={() => set({ fills: removeAt(q.fills, f) })}
                />
              ))}
              <button
                type="button"
                className={secondaryClass}
                onClick={() => set({ fills: [...q.fills, { to: "fact" }] })}
              >
                {S.addFill}
              </button>
            </div>
          </Card>
        );
      })}

      <button
        type="button"
        className={secondaryClass}
        onClick={add}
        disabled={t.setup.length >= MAX_QUESTIONS}
        data-testid="setup-add"
      >
        {S.add}
      </button>
    </div>
  );
};
