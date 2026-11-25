import React, { useState } from "react";

import { TEMPLATES_ADMIN_COPY as C } from "./copy";
import {
  buttonClass,
  errorCode,
  Field,
  keyFromName,
  secondaryClass,
  Select,
  TextInput,
} from "./fields";
import { useCreateTemplateDraftMutation } from "./templatesAdminApi";

import type { TemplateRow } from "./templatesAdminApi";

const N = C.create;

/**
 * Starts a draft of a new template: blank, or a copy of another. The key follows the name until
 * it is edited by hand; it can't change once the draft exists.
 */
export const NewTemplateForm: React.FC<{
  /** The templates to copy from. Left out when copying one fixed template (`from`). */
  templates?: TemplateRow[];
  from?: { key: string; name: string };
  onCancel: () => void;
  onCreated: (key: string) => void;
}> = ({ templates, from, onCancel, onCreated }) => {
  const [create, { isLoading }] = useCreateTemplateDraftMutation();
  const [source, setSource] = useState(from?.key ?? "");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await create({
        key,
        name: name.trim(),
        ...(source ? { from: { key: source } } : {}),
      }).unwrap();
      onCreated(key);
    } catch (e) {
      setError(N.failed[errorCode(e) ?? "default"] ?? N.failed.default);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-3 max-w-xl rounded-md border border-border-light p-4"
      data-testid="new-template-form"
    >
      <h3 className="font-medium">{N.title}</h3>
      {templates && (
        <Field label={N.startFrom}>
          <Select
            value={source}
            onChange={setSource}
            testId="new-template-source"
            options={[
              { value: "", label: N.blank },
              ...templates.map(t => ({ value: t.key, label: N.copyOf(t.name) })),
            ]}
          />
        </Field>
      )}
      {from && <p className="text-sm">{N.copyOf(from.name)}</p>}
      <Field label={N.name} hint={N.nameHint}>
        <TextInput
          value={name}
          data-testid="new-template-name"
          onChange={v => {
            setName(v);
            if (!keyEdited) setKey(keyFromName(v));
          }}
        />
      </Field>
      <Field label={N.key} hint={N.keyHint}>
        <TextInput
          value={key}
          data-testid="new-template-key"
          onChange={v => {
            setKeyEdited(true);
            setKey(v);
          }}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className={buttonClass}
          disabled={isLoading || !name.trim() || !key}
          data-testid="new-template-start"
        >
          {N.start}
        </button>
        <button type="button" className={secondaryClass} onClick={onCancel}>
          {N.cancel}
        </button>
      </div>
    </form>
  );
};
