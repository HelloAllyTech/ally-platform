import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Checkbox, TextArea, TextInput, Tooltip } from "@ally-ui-mono/ui-shared";
import { useCreateContextChunkMutation, useUpdateContextChunkMutation } from "@api";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import {
  ContextAttributeSpec,
  ContextChunk,
  ContextCollection,
  ContextEntryInput,
  ContextGateFinding,
} from "@types";

import {
  EntryHint,
  findingMessage,
  findingsFromError,
  humanise,
  textHints,
} from "./contextLibraryFormat";
import { useContextLibraryScope } from "./contextLibraryScope";
import { Chip } from "./ContextLibraryUi";

/** ally-be CL_BODY_MAX_CHARS. */
export const BODY_MAX_CHARS = 6_000;

interface EntryFormProps {
  collection: ContextCollection;
  /** Editing this entry; absent for a new one. */
  initial?: ContextChunk;
  onSaved: (chunk: ContextChunk) => void;
  onCancel: () => void;
}

type FacetValues = Record<string, string[]>;

const toList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];

const HelpTip: React.FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button type="button" className="inline-flex cursor-pointer items-center" aria-label={label}>
      <TooltipIcon />
    </button>
  </Tooltip>
);

/**
 * A written entry, with fields generated from the collection's profile: the statement (with a
 * live count against the profile's limit), the full text, facets as chips from their
 * vocabularies, the profile's attributes, and Pin. Live hints mirror the backend's cheap
 * checks; the server's findings on a 400 appear beside the field they name.
 */
export const EntryForm: React.FC<EntryFormProps> = ({ collection, initial, onSaved, onCancel }) => {
  const strings = en.contextLibrary.entry;
  // An organisation's admin writes through the organisation routes: the entry is theirs.
  const { tenantId } = useContextLibraryScope();
  const [statement, setStatement] = useState(initial?.statement ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [facets, setFacets] = useState<FacetValues>(() =>
    Object.fromEntries(
      Object.keys(collection.facets).map(key => [key, toList(initial?.facets?.[key])]),
    ),
  );
  const [attributes, setAttributes] = useState<Record<string, unknown>>(
    () => initial?.attributes ?? {},
  );
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [findings, setFindings] = useState<ContextGateFinding[]>([]);
  const [create, createState] = useCreateContextChunkMutation();
  const [update, updateState] = useUpdateContextChunkMutation();
  const saving = createState.isLoading || updateState.isLoading;

  const hints = useMemo(() => {
    const all: EntryHint[] = [
      ...textHints("statement", statement, collection.statementMaxChars),
      ...textHints("body", body, BODY_MAX_CHARS),
    ];
    for (const [key, spec] of Object.entries(collection.attributes)) {
      const value = attributes[key];
      if (spec.type === "text" && typeof value === "string") {
        all.push(...textHints(key, value, spec.maxChars));
      }
    }
    return all;
  }, [attributes, body, collection.attributes, collection.statementMaxChars, statement]);

  const hintFor = (field: string) =>
    hints
      .filter(h => h.field === field)
      .map(h => h.message)
      .join(" ");
  const fieldNames = useMemo(
    () =>
      new Set([
        "statement",
        "body",
        ...Object.keys(collection.facets),
        ...Object.keys(collection.attributes),
      ]),
    [collection.attributes, collection.facets],
  );
  const findingFor = (field: string) =>
    findings
      .filter(f => f.field === field)
      .map(findingMessage)
      .join(" ");
  const otherFindings = findings.filter(f => !f.field || !fieldNames.has(f.field));

  const toggleFacet = (key: string, value: string, multi: boolean) =>
    setFacets(previous => {
      const current = previous[key] ?? [];
      const has = current.includes(value);
      const next = multi
        ? has
          ? current.filter(v => v !== value)
          : [...current, value]
        : has
          ? []
          : [value];
      return { ...previous, [key]: next };
    });

  const buildEntry = (): ContextEntryInput => {
    const facetBody: Record<string, string | string[]> = {};
    for (const [key, spec] of Object.entries(collection.facets)) {
      const values = facets[key] ?? [];
      if (spec.multi) {
        // An edit sends an emptied multi-value facet as [], so the server clears it.
        if (values.length || initial) facetBody[key] = values;
      } else if (values[0]) {
        facetBody[key] = values[0];
      }
    }
    const attributeBody: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(collection.attributes)) {
      const value = attributes[key];
      if (value === undefined || value === "") continue;
      if (spec.type === "text[]") {
        const list = toList(value).filter(item => item.trim());
        if (list.length) attributeBody[key] = list;
      } else {
        attributeBody[key] = value;
      }
    }
    return {
      statement: statement.trim(),
      body: body.trim() ? body : null,
      facets: facetBody,
      attributes: attributeBody,
      pinned,
    };
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!statement.trim()) {
      setFindings([{ reason: "missing_statement", field: "statement" }]);
      return;
    }
    setFindings([]);
    try {
      const entry = buildEntry();
      const saved = initial
        ? await update({ code: initial.code, entry, tenantId }).unwrap()
        : await create({ collectionId: collection.id, entry, tenantId }).unwrap();
      toast.success(strings.saved(saved.code));
      onSaved(saved);
    } catch (error) {
      const serverFindings = findingsFromError(error);
      setFindings(serverFindings);
      toast.error(strings.saveFailed);
    }
  };

  const renderAttribute = (key: string, spec: ContextAttributeSpec) => {
    const value = attributes[key];
    const set = (next: unknown) => setAttributes(previous => ({ ...previous, [key]: next }));
    const invalidText = findingFor(key);
    const warnText = hintFor(key);
    const counter =
      spec.maxChars && typeof value === "string"
        ? strings.chars(value.length, spec.maxChars)
        : undefined;
    switch (spec.type) {
      case "enum":
        return (
          <fieldset key={key} className="space-y-1">
            <legend className="text-xs text-typography-700">{spec.label}</legend>
            <div className="flex flex-wrap gap-1">
              {(spec.values ?? []).map(option => (
                <Chip
                  key={option}
                  pressed={value === option}
                  onClick={() => set(value === option ? undefined : option)}
                >
                  {humanise(option)}
                </Chip>
              ))}
            </div>
            {invalidText && <p className="text-xs text-red-700">{invalidText}</p>}
          </fieldset>
        );
      case "bool":
        return (
          <Checkbox
            key={key}
            id={`cl-attr-${key}`}
            labelText={spec.label}
            checked={value === true}
            onChange={(_: unknown, { checked }: { checked: boolean }) => set(checked)}
          />
        );
      case "text[]":
        return (
          <TextArea
            key={key}
            id={`cl-attr-${key}`}
            labelText={spec.label}
            helperText={strings.textListHelp}
            rows={3}
            value={toList(value).join("\n")}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              set(e.target.value.split("\n"))
            }
            invalid={Boolean(invalidText)}
            invalidText={invalidText}
          />
        );
      case "text":
      default:
        return (
          <TextArea
            key={key}
            id={`cl-attr-${key}`}
            labelText={spec.label}
            rows={spec.maxChars && spec.maxChars <= 200 ? 2 : 3}
            value={typeof value === "string" ? value : ""}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set(e.target.value)}
            helperText={counter}
            invalid={Boolean(invalidText)}
            invalidText={invalidText}
            warn={!invalidText && Boolean(warnText)}
            warnText={warnText}
          />
        );
    }
  };

  const statementInvalid = findingFor("statement");
  const statementHint = hintFor("statement");

  return (
    <form onSubmit={submit} className="space-y-5" noValidate data-testid="cl-entry-form">
      {otherFindings.length > 0 && (
        <ul
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          {otherFindings.map((f, i) => (
            <li key={i}>
              {f.field ? `${humanise(f.field)}: ` : ""}
              {findingMessage(f)}
            </li>
          ))}
        </ul>
      )}

      <div>
        <div className="mb-1 flex items-center gap-1 text-xs text-typography-700">
          <span>{strings.statement}</span>
          <HelpTip label={strings.statementHelp} />
        </div>
        <TextArea
          id="cl-entry-statement"
          labelText={strings.statement}
          hideLabel
          rows={2}
          value={statement}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setStatement(e.target.value)}
          helperText={strings.chars(statement.length, collection.statementMaxChars)}
          invalid={Boolean(statementInvalid)}
          invalidText={statementInvalid}
          warn={!statementInvalid && Boolean(statementHint)}
          warnText={statementHint}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-xs text-typography-700">
          <span>{strings.body}</span>
          <HelpTip label={strings.bodyHelp} />
        </div>
        <TextArea
          id="cl-entry-body"
          labelText={strings.body}
          hideLabel
          rows={5}
          value={body}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
          helperText={body ? strings.chars(body.length, BODY_MAX_CHARS) : undefined}
          invalid={Boolean(findingFor("body"))}
          invalidText={findingFor("body")}
          warn={!findingFor("body") && Boolean(hintFor("body"))}
          warnText={hintFor("body")}
        />
      </div>

      {Object.entries(collection.facets).map(([key, spec]) => {
        const invalidText = findingFor(key);
        if (!spec.values?.length) {
          return (
            <TextInput
              key={key}
              id={`cl-facet-${key}`}
              labelText={spec.label}
              helperText={strings.freeTextHelp}
              value={(facets[key] ?? []).join(", ")}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFacets(previous => ({
                  ...previous,
                  [key]: e.target.value
                    .split(",")
                    .map(v => v.trim())
                    .filter(Boolean),
                }))
              }
              invalid={Boolean(invalidText)}
              invalidText={invalidText}
            />
          );
        }
        return (
          <fieldset key={key} className="space-y-1">
            <legend className="text-xs text-typography-700">{spec.label}</legend>
            <div className="flex flex-wrap gap-1">
              {spec.values.map(option => (
                <Chip
                  key={option}
                  pressed={(facets[key] ?? []).includes(option)}
                  onClick={() => toggleFacet(key, option, spec.multi)}
                >
                  {humanise(option)}
                </Chip>
              ))}
            </div>
            {invalidText && <p className="text-xs text-red-700">{invalidText}</p>}
          </fieldset>
        );
      })}

      {Object.entries(collection.attributes)
        .filter(([, spec]) => spec.shown !== false)
        .map(([key, spec]) => renderAttribute(key, spec))}

      <div className="flex items-center gap-1">
        <Checkbox
          id="cl-entry-pinned"
          labelText={strings.pinned}
          checked={pinned}
          onChange={(_: unknown, { checked }: { checked: boolean }) => setPinned(checked)}
        />
        <HelpTip label={strings.pinnedHelp} />
      </div>

      <div className="flex justify-end gap-2 border-t border-border-light pt-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          {strings.cancel}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          {saving ? strings.saving : strings.save}
        </button>
      </div>
    </form>
  );
};
