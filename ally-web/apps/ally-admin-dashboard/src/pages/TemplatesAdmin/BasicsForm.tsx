import React from "react";

import { TEMPLATES_ADMIN_COPY as C } from "./copy";
import { Check, Field, issuesOn, Select, TextArea, TextInput } from "./fields";

import type { TemplateIssue, TemplateManifest, TemplatesMeta } from "./templatesAdminApi";

const B = C.basics;

export interface FormProps {
  value: TemplateManifest;
  onChange: (next: TemplateManifest) => void;
  issues: TemplateIssue[];
  meta: TemplatesMeta;
}

/** The card, what the assistant is for, its safety pack and its instructions. */
export const BasicsForm: React.FC<FormProps> = ({ value: t, onChange, issues, meta }) => {
  const set = <K extends keyof TemplateManifest>(key: K, next: TemplateManifest[K]) =>
    onChange({ ...t, [key]: next });
  const on = (path: string) => issuesOn(issues, path);

  return (
    <div className="space-y-4 max-w-3xl" data-testid="template-basics">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={B.name} issues={on("name")}>
          <TextInput value={t.name} onChange={v => set("name", v)} data-testid="basics-name" />
        </Field>
        <Field label={B.key}>
          <TextInput value={t.id} readOnly disabled onChange={() => undefined} />
        </Field>
        <Field label={B.group} hint={B.groupHint} issues={on("group")}>
          <Select
            value={t.group}
            onChange={v => set("group", v as TemplateManifest["group"])}
            options={meta.groups.map(g => ({ value: g.id, label: g.name }))}
          />
        </Field>
        <Field label={B.icon} hint={B.iconHint} issues={on("icon")}>
          <TextInput value={t.icon} onChange={v => set("icon", v)} maxLength={40} />
        </Field>
      </div>

      <Field label={B.oneLiner} hint={B.oneLinerHint} issues={on("one_liner")}>
        <TextInput
          value={t.one_liner}
          onChange={v => set("one_liner", v)}
          data-testid="basics-one-liner"
        />
      </Field>
      <Field label={B.audience} issues={on("for")}>
        <TextInput value={t.for} onChange={v => set("for", v)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={B.purpose} issues={on("purpose")}>
          <Select
            value={t.purpose}
            onChange={v => set("purpose", v)}
            options={meta.purposes.map(p => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label={B.pack} tip={B.packHint} issues={on("pack")}>
          <Select
            value={t.pack ?? ""}
            onChange={v => set("pack", v || null)}
            options={[
              { value: "", label: B.packNone },
              ...meta.packs.map(p => ({ value: p.id, label: p.name })),
            ]}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <Check
          label={B.handOver}
          hint={B.handOverHint}
          checked={t.hand_over}
          onChange={v => set("hand_over", v)}
        />
        <Check label={B.memory} checked={t.memory} onChange={v => set("memory", v)} />
        <Check
          label={B.organisationOnly}
          hint={B.organisationOnlyHint}
          checked={Boolean(t.organisation_only)}
          onChange={v => set("organisation_only", v || undefined)}
        />
      </div>
      {t.memory && (
        <Field label={B.memoryNotice} hint={B.memoryNoticeHint} issues={on("memory_notice")}>
          <TextArea
            value={t.memory_notice ?? ""}
            onChange={v => set("memory_notice", v || undefined)}
            rows={2}
          />
        </Field>
      )}

      <Field label={B.instructions} hint={B.instructionsHint} issues={on("instructions")}>
        <TextArea
          value={t.instructions}
          onChange={v => set("instructions", v)}
          rows={6}
          testId="basics-instructions"
        />
      </Field>

      <Field label={B.suggestedFor} hint={B.suggestedForHint} issues={on("suggested_for")}>
        <TextInput
          value={t.suggested_for.join(", ")}
          onChange={v =>
            set(
              "suggested_for",
              v
                .split(",")
                .map(s => s.trim())
                .filter(Boolean),
            )
          }
        />
      </Field>
    </div>
  );
};
