import React, { useId, useMemo, useState } from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import { ContextAudience } from "@types";

/** Every organisation, until a platform admin narrows it. */
export const GLOBAL_AUDIENCE: ContextAudience = { isGlobal: true, tenantIds: [] };

/** "Only these organisations" must name one, or nothing would ever reach anybody. */
export const audienceValid = (audience: ContextAudience): boolean =>
  audience.isGlobal || audience.tenantIds.length > 0;

/** The pair as the server takes it: global clears the names. */
export const audienceBody = (audience: ContextAudience): ContextAudience =>
  audience.isGlobal ? GLOBAL_AUDIENCE : { isGlobal: false, tenantIds: audience.tenantIds };

export const audienceOf = (
  value: { isGlobal?: boolean; tenantIds?: string[] | null } | undefined,
): ContextAudience =>
  value && value.isGlobal === false
    ? { isGlobal: false, tenantIds: [...(value.tenantIds ?? [])] }
    : GLOBAL_AUDIENCE;

/** Above this many organisations the list gets a filter box. */
const FILTER_FROM = 8;

/**
 * Who a platform admin's entry or document reaches: every organisation, or only the ones ticked.
 * Organisation-scoped features (the Ally guide, Debrief, Course Copilot) serve a learner the
 * global entries plus their own organisation's; Builder and the other platform features read
 * everything regardless.
 */
export const AudiencePicker: React.FC<{
  value: ContextAudience;
  onChange: (value: ContextAudience) => void;
  orgNames: Record<string, string>;
  /** Overrides the legend's tooltip, e.g. to say a document's entries follow it. */
  help?: string;
  /** Shown under the choice, e.g. that bulk rows with their own columns win. */
  note?: string;
  disabled?: boolean;
}> = ({ value, onChange, orgNames, help, note, disabled }) => {
  const strings = en.contextLibrary.audience;
  const name = useId();
  const [filter, setFilter] = useState("");
  const options = useMemo(() => {
    const known = Object.entries(orgNames);
    // Keep an id the list doesn't name (a deleted organisation, or names still loading) tickable.
    for (const id of value.tenantIds) {
      if (!orgNames[id]) known.push([id, strings.unknownOrganisation]);
    }
    return known.sort(([, a], [, b]) => a.localeCompare(b));
  }, [orgNames, value.tenantIds, strings.unknownOrganisation]);
  const shown = filter.trim()
    ? options.filter(([, label]) => label.toLowerCase().includes(filter.trim().toLowerCase()))
    : options;
  const toggle = (id: string, checked: boolean) =>
    onChange({
      isGlobal: false,
      tenantIds: checked
        ? [...value.tenantIds, id]
        : value.tenantIds.filter(existing => existing !== id),
    });

  return (
    <fieldset className="space-y-2" disabled={disabled} data-testid="cl-audience-picker">
      <legend className="mb-1 flex items-center gap-1 text-xs text-typography-700">
        <span>{strings.pickerLabel}</span>
        <Tooltip label={help ?? strings.pickerHelp} align="top">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center"
            aria-label={help ?? strings.pickerHelp}
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      </legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={name}
          checked={value.isGlobal}
          onChange={() => onChange(GLOBAL_AUDIENCE)}
          data-testid="cl-audience-global"
        />
        {strings.everyOrganisation}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name={name}
          checked={!value.isGlobal}
          onChange={() => onChange({ isGlobal: false, tenantIds: value.tenantIds })}
          data-testid="cl-audience-targeted"
        />
        {strings.onlyThese}
      </label>
      {!value.isGlobal && (
        <div className="ml-6 space-y-2">
          {options.length > FILTER_FROM && (
            <input
              type="search"
              value={filter}
              onChange={event => setFilter(event.target.value)}
              placeholder={strings.filterOrganisations}
              aria-label={strings.filterOrganisations}
              className="h-8 w-full rounded border border-border-light px-2 text-sm"
            />
          )}
          {options.length ? (
            <ul
              className="max-h-48 space-y-1 overflow-y-auto rounded border border-border-light p-2"
              data-testid="cl-audience-orgs"
            >
              {shown.map(([id, label]) => (
                <li key={id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={value.tenantIds.includes(id)}
                      onChange={event => toggle(id, event.target.checked)}
                    />
                    {label}
                  </label>
                </li>
              ))}
              {!shown.length && (
                <li className="text-xs text-typography-600">{strings.noOrganisationMatches}</li>
              )}
            </ul>
          ) : (
            <p className="text-xs text-typography-600">{strings.noOrganisations}</p>
          )}
          <p
            className={`text-xs ${value.tenantIds.length ? "text-typography-600" : "text-red-700"}`}
            role={value.tenantIds.length ? undefined : "alert"}
          >
            {value.tenantIds.length
              ? strings.selectedCount(value.tenantIds.length)
              : strings.chooseOne}
          </p>
        </div>
      )}
      {note && <p className="text-xs text-typography-600">{note}</p>}
    </fieldset>
  );
};

/**
 * Who something reaches, with Change for a platform admin: the badge, then the picker with Save
 * and Cancel in place. `locked` explains why it can't change (an organisation's own, or synced).
 */
export const AudienceEditor: React.FC<{
  value: ContextAudience;
  badge: React.ReactNode;
  orgNames: Record<string, string>;
  canEdit: boolean;
  locked?: string;
  help?: string;
  onSave: (value: ContextAudience) => Promise<void>;
}> = ({ value, badge, orgNames, canEdit, locked, help, onSave }) => {
  const strings = en.contextLibrary.audience;
  const [draft, setDraft] = useState<ContextAudience | null>(null);
  const [saving, setSaving] = useState(false);
  if (!draft) {
    return (
      <section data-testid="cl-audience-editor">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
          {strings.pickerLabel}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          {badge}
          {canEdit && !locked && (
            <button
              type="button"
              onClick={() => setDraft(value)}
              className="text-sm text-primary-600 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
              data-testid="cl-audience-change"
            >
              {strings.change}
            </button>
          )}
        </div>
        {locked && <p className="mt-1 text-xs text-typography-600">{locked}</p>}
      </section>
    );
  }
  const save = async () => {
    if (!audienceValid(draft)) return;
    setSaving(true);
    try {
      await onSave(audienceBody(draft));
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section
      className="space-y-3 rounded border border-border-light p-3"
      data-testid="cl-audience-editor"
    >
      <AudiencePicker value={draft} onChange={setDraft} orgNames={orgNames} help={help} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setDraft(null)}
          className="rounded px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          {strings.cancel}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !audienceValid(draft)}
          className="rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          data-testid="cl-audience-save"
        >
          {saving ? strings.saving : strings.save}
        </button>
      </div>
    </section>
  );
};
