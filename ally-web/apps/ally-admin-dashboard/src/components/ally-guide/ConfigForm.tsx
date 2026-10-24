import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import {
  Button,
  Checkbox,
  InlineNotification,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { AllyGuideConfigLayerField, AllyGuideConfigLayerView } from "@types";
import { formatDateTime } from "@utils";

import {
  buildChange,
  ConfigChange,
  ConfigInput,
  ConfigSaveFailure,
  changeCount,
  describeValue,
  effectiveValue,
  groupFields,
  isEmptyChange,
  messagesForKey,
  NULL_CHOICE,
  parseInput,
  readSaveFailure,
  toInput,
} from "./configDraft";
import { InfoTip } from "./InfoTip";
import { Pill } from "./Pill";

interface ConfigFormProps {
  /** One layer's view: the keys it may set, their overrides, its version and its changes. */
  view: AllyGuideConfigLayerView;
  canEdit: boolean;
  /**
   * Saves a change. Rejects with the RTK error, which is read for a refusal (400, one message per
   * key) or a stale save (409), so the form can say which.
   */
  onSave: (change: ConfigChange, expectedVersion: number) => Promise<unknown>;
  /** Drops the loaded view and fetches it again, after a stale save. */
  onReload: () => void;
}

// Read lazily: the copy barrel must not be touched while modules load (see ally-web/CLAUDE.md).
const formStrings = () => en.allyConsole.config.form;
const describe = (value: unknown, unit?: string | null) => {
  const strings = formStrings();
  return describeValue(value, unit, { off: strings.off, yes: strings.yes, no: strings.no });
};

const errorText = (field: AllyGuideConfigLayerField, error: string): string => {
  const strings = formStrings().errors;
  if (error === "min") return strings.min(field.min ?? 0);
  if (error === "max") return strings.max(field.max ?? 0);
  return strings[error as "required" | "integer" | "number" | "choice"];
};

/**
 * A form generated from the server's schema for one layer (an organisation or a course): every key
 * that layer may set, grouped as the server groups them, each with what it does, the unit and limits,
 * the live release's value and whether it is overridden here.
 *
 * Nothing is sent until Save, and then only what changed: a key edited back to the release's value
 * clears its override rather than writing a copy of the release's number that would then outlive a
 * release change. A refusal (400) lists one sentence per key and writes nothing; a stale save (409)
 * says someone else changed the layer and offers a reload instead of overwriting them.
 */
export const ConfigForm: React.FC<ConfigFormProps> = ({ view, canEdit, onSave, onReload }) => {
  const strings = formStrings();
  const [drafts, setDrafts] = useState<Record<string, ConfigInput>>({});
  const [resets, setResets] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<ConfigSaveFailure | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // A different layer (or a reload that brought a new version) starts the form clean.
  useEffect(() => {
    setDrafts({});
    setResets(new Set());
    setFailure(null);
    setShowErrors(false);
  }, [view.layer, view.scopeId, view.version]);

  const change = useMemo(
    () => buildChange(view.fields, drafts, resets),
    [view.fields, drafts, resets],
  );
  const count = changeCount(change);
  const invalidKeys = useMemo(
    () =>
      new Set(
        view.fields
          .filter(field => field.key in drafts && !resets.has(field.key))
          .filter(field => !parseInput(field, drafts[field.key]).ok)
          .map(field => field.key),
      ),
    [view.fields, drafts, resets],
  );

  const edit = (key: string, value: ConfigInput) => {
    setDrafts(previous => ({ ...previous, [key]: value }));
    setResets(previous => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
    setFailure(null);
  };

  const toggleReset = (key: string) =>
    setResets(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleSave = async () => {
    if (invalidKeys.size > 0) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    setFailure(null);
    try {
      await onSave(change, view.version);
      toast.success(strings.saved);
    } catch (error) {
      const read = readSaveFailure(error);
      setFailure(read);
      if (read.kind === "other") toast.error(read.message ?? strings.failed);
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    setDrafts({});
    setResets(new Set());
    setFailure(null);
    setShowErrors(false);
  };

  if (view.fields.length === 0) {
    return (
      <p className="text-sm text-typography-700" data-testid="config-empty">
        {strings.empty}
      </p>
    );
  }

  const refusals = failure?.kind === "refused" ? failure.messages : [];

  return (
    <div className="flex flex-col gap-6" data-testid="config-form">
      <p className="text-sm text-typography-700" data-testid="config-version">
        {strings.version(
          view.version,
          view.updatedBy,
          view.updatedAt ? formatDateTime(view.updatedAt) : null,
        )}
      </p>

      {failure?.kind === "stale" && (
        <div className="flex flex-col items-start gap-2" data-testid="config-stale">
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title={strings.staleTitle}
            subtitle={strings.staleBody}
          />
          <Button kind="tertiary" size="sm" onClick={onReload}>
            {strings.reload}
          </Button>
        </div>
      )}
      {failure?.kind === "refused" && (
        <div data-testid="config-refused">
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={strings.refusedTitle}
            subtitle=""
          />
          <ul className="list-disc pl-6 text-sm text-destructive-600">
            {failure.messages.map(message => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {groupFields(view.fields).map(([group, fields]) => (
        <section key={group} className="flex flex-col gap-3" aria-label={group}>
          <h4 className="text-lg font-normal text-typography-900">{group}</h4>
          <div className="flex flex-col divide-y divide-border-light border-y border-border-light">
            {fields.map(field => {
              const resetting = resets.has(field.key);
              const edited = field.key in drafts && !resetting;
              const input: ConfigInput = resetting
                ? toInput(field, field.releaseValue)
                : edited
                  ? drafts[field.key]
                  : toInput(field, effectiveValue(field));
              const parsed = parseInput(field, input);
              const invalid = edited && !parsed.ok && showErrors;
              const serverMessages = messagesForKey(refusals, field.key);
              const overridden = Boolean(field.override) && !resetting;
              const id = `ally-config-${view.layer}-${field.key}`;
              const disabled = !canEdit || isSaving;
              const invalidText = serverMessages.length
                ? serverMessages.join(" ")
                : "error" in parsed
                  ? errorText(field, parsed.error)
                  : "";
              const flagged = invalid || serverMessages.length > 0;
              const hint = [
                field.min !== undefined || field.max !== undefined
                  ? strings.limits(field.min, field.max, field.unit ?? null)
                  : field.unit
                    ? strings.unit(field.unit)
                    : null,
                field.nullable && field.type !== "enum" && field.type !== "boolean"
                  ? strings.emptyIsOff
                  : null,
              ]
                .filter(Boolean)
                .join(". ");

              return (
                <div
                  key={field.key}
                  className="grid grid-cols-1 gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
                  data-testid={`config-field-${field.key}`}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-typography-900">{field.key}</span>
                      {overridden ? (
                        <Pill tone="info">{strings.overridden}</Pill>
                      ) : (
                        <Pill tone="neutral">{strings.fromRelease}</Pill>
                      )}
                      {resetting && <Pill tone="warning">{strings.resetPending}</Pill>}
                      <InfoTip label={field.description} ariaLabel={strings.help(field.key)} />
                    </div>
                    <p className="max-w-xl text-sm text-typography-700">{field.description}</p>
                    <p className="text-xs text-typography-700">
                      {strings.releaseIs(describe(field.releaseValue, field.unit))}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    {field.type === "boolean" ? (
                      <Checkbox
                        id={id}
                        labelText={field.key}
                        checked={input === true}
                        disabled={disabled}
                        onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                          edit(field.key, checked)
                        }
                      />
                    ) : field.type === "enum" ? (
                      <Select
                        id={id}
                        labelText={field.key}
                        value={typeof input === "string" ? input : ""}
                        disabled={disabled}
                        invalid={flagged}
                        invalidText={invalidText}
                        onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                          edit(field.key, event.target.value)
                        }
                      >
                        {field.nullable && (
                          <SelectItem value={NULL_CHOICE} text={strings.offChoice} />
                        )}
                        {(field.enum ?? []).map(option => (
                          <SelectItem key={option} value={option} text={option} />
                        ))}
                      </Select>
                    ) : (
                      <TextInput
                        id={id}
                        labelText={field.key}
                        inputMode={field.type === "int" ? "numeric" : "decimal"}
                        value={typeof input === "string" ? input : ""}
                        disabled={disabled}
                        invalid={flagged}
                        invalidText={invalidText}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          edit(field.key, event.target.value)
                        }
                      />
                    )}
                    {hint && field.type !== "boolean" && field.type !== "enum" && (
                      <p
                        className="text-xs text-typography-700"
                        data-testid={`config-hint-${field.key}`}
                      >
                        {hint}
                      </p>
                    )}
                    {canEdit && (field.override || resetting) && (
                      <Button
                        kind="ghost"
                        size="sm"
                        className="self-start"
                        disabled={isSaving}
                        onClick={() => toggleReset(field.key)}
                      >
                        {resetting ? strings.undoReset : strings.reset}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {canEdit ? (
        <div
          className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border-light bg-white py-3"
          data-testid="config-save-bar"
        >
          <Button
            kind="primary"
            size="md"
            disabled={(isEmptyChange(change) && invalidKeys.size === 0) || isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? strings.saving : strings.save(count + invalidKeys.size)}
          </Button>
          {(count > 0 || Object.keys(drafts).length > 0 || resets.size > 0) && (
            <Button kind="ghost" size="md" disabled={isSaving} onClick={discard}>
              {strings.discard}
            </Button>
          )}
          <span
            className={`text-sm ${showErrors && invalidKeys.size > 0 ? "text-destructive-600" : "text-typography-700"}`}
            role="status"
          >
            {showErrors && invalidKeys.size > 0
              ? strings.invalid
              : count > 0
                ? strings.dirty(count)
                : strings.clean}
          </span>
        </div>
      ) : (
        <p className="text-sm text-typography-700" data-testid="config-view-only">
          {strings.viewOnly}
        </p>
      )}

      {view.audit.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={strings.auditHeading}>
          <h4 className="text-lg font-normal text-typography-900">{strings.auditHeading}</h4>
          <ConfigAuditTable rows={view.audit} />
        </section>
      )}
    </div>
  );
};

/** Override changes, newest first: which key, from what to what, and who. */
export const ConfigAuditTable: React.FC<{
  rows: AllyGuideConfigLayerView["audit"];
  /** Rows from many organisations and courses: say which each one changed. */
  showScope?: boolean;
}> = ({ rows, showScope = false }) => {
  const strings = en.allyConsole.config;
  const show = (entry: { value: unknown } | null) =>
    entry === null ? strings.unset : describe(entry.value);
  return (
    <div className="overflow-x-auto">
      <Table className="w-full border-collapse text-left" data-testid="config-audit-table">
        <TableHead>
          <TableRow className="border-b border-border-light text-sm text-typography-700">
            <TableHeader className="py-2 pr-4 font-medium">{strings.auditColumns.when}</TableHeader>
            {showScope && (
              <TableHeader className="py-2 pr-4 font-medium">
                {strings.auditColumns.appliesTo}
              </TableHeader>
            )}
            <TableHeader className="py-2 pr-4 font-medium">
              {strings.auditColumns.scope}
            </TableHeader>
            <TableHeader className="py-2 pr-4 font-medium">{strings.auditColumns.from}</TableHeader>
            <TableHeader className="py-2 pr-4 font-medium">{strings.auditColumns.to}</TableHeader>
            <TableHeader className="py-2 pr-4 font-medium">{strings.auditColumns.by}</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={`${row.key}-${row.version}-${index}`}
              className="border-b border-border-light text-sm text-typography-900"
              data-testid="config-audit-row"
            >
              <TableCell className="whitespace-nowrap py-2 pr-4">
                {formatDateTime(row.createdAt)}
              </TableCell>
              {showScope && (
                <TableCell className="py-2 pr-4" data-testid="config-audit-scope">
                  {row.scopeName ?? (
                    <span className="text-typography-700">{strings.scopeGone}</span>
                  )}
                  <span className="block text-xs text-typography-700">
                    {strings.layers[row.layer] ?? row.layer}
                  </span>
                </TableCell>
              )}
              <TableCell className="py-2 pr-4 font-mono text-xs">{row.key}</TableCell>
              <TableCell className="py-2 pr-4">{show(row.oldValue)}</TableCell>
              <TableCell className="py-2 pr-4">{show(row.newValue)}</TableCell>
              <TableCell className="py-2 pr-4">{row.actor ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
