import React, { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import {
  useCreateBuilderRuleMutation,
  useDraftBuilderRuleMutation,
  usePreviewBuilderRuleMutation,
} from "@api";
import { en } from "@constants";
import { BuilderRule, BuilderRuleMatch, BuilderRulePreview } from "@types";

import { Sheet } from "./Sheet";

const strings = en.builder.room.editor;

/** The fixed list; free-text areas fragment. Mirrors ally-be's BUILDER_RULE_AREAS. */
export const RULE_AREAS = [
  "Admin UI",
  "Helpline UI",
  "Learner experience",
  "Mobile",
  "ally-be API",
  "Data model",
  "AI prompts",
];

export type RuleEditorSource =
  | { mode: "draft"; historyId: string; sessionId?: string | null }
  | { mode: "text"; text: string; sessionId?: string | null }
  | { mode: "edit"; rule: BuilderRule }
  | { mode: "new" };

type ScopeKind = "session" | "area" | "everywhere";

const scopeOf = (kind: ScopeKind, area: string, sessionId: string | null | undefined) =>
  kind === "session" && sessionId
    ? `session:${sessionId}`
    : kind === "area"
      ? `area:${area}`
      : "everywhere";

interface RuleEditorProps {
  source: RuleEditorSource;
  placement: "bottom" | "side";
  onClose: () => void;
}

/**
 * A rule, drafted by Builder from an answer and finished by the person.
 *
 * The person sees what the rule would have changed before saving — "would have
 * applied to 4 earlier decisions, agrees with 3" — which is the strongest
 * guard against a careless rule, and a contradiction with a rule they already
 * have is resolved here, explicitly, never by whichever was saved last.
 */
export const RuleEditor: React.FC<RuleEditorProps> = ({ source, placement, onClose }) => {
  const [draftRule, { isLoading: drafting }] = useDraftBuilderRuleMutation();
  const [previewRule, { isLoading: previewing }] = usePreviewBuilderRuleMutation();
  const [createRule, { isLoading: saving }] = useCreateBuilderRuleMutation();

  const sessionId = source.mode === "draft" || source.mode === "text" ? source.sessionId : null;
  const editing = source.mode === "edit" ? source.rule : null;
  const [statement, setStatement] = useState(
    source.mode === "text" ? source.text : editing ? editing.statement : "",
  );
  const [scopeKind, setScopeKind] = useState<ScopeKind>(
    editing ? (editing.scope.startsWith("area:") ? "area" : "everywhere") : "area",
  );
  const [area, setArea] = useState(
    editing?.scope.startsWith("area:") ? editing.scope.slice(5) : RULE_AREAS[0],
  );
  const [effect, setEffect] = useState<"guide" | "decide">(editing?.effect ?? "guide");
  const [match, setMatch] = useState<BuilderRuleMatch | null>(editing?.match ?? null);
  const [decideAllowed, setDecideAllowed] = useState(Boolean(editing?.effect === "decide"));
  const [origin, setOrigin] = useState<{ prompt: string; chosen: string | null } | null>(null);
  const [preview, setPreview] = useState<BuilderRulePreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [winner, setWinner] = useState<"new" | "old" | null>(null);

  // Builder drafts the general version of the answer; the person edits it.
  useEffect(() => {
    if (source.mode !== "draft") return;
    draftRule(source.historyId)
      .unwrap()
      .then(draft => {
        setStatement(draft.statement);
        if (draft.scope.startsWith("area:")) {
          setScopeKind("area");
          setArea(draft.scope.slice(5));
        } else setScopeKind("everywhere");
        setDecideAllowed(draft.decideAllowed);
        setMatch(draft.match);
        if (draft.source) setOrigin({ prompt: draft.source.prompt, chosen: draft.source.chosen });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scope = scopeOf(scopeKind, area, sessionId);

  // The preview follows the wording and the scope, a beat after typing stops.
  useEffect(() => {
    if (statement.trim().length < 8) {
      setPreview(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      setPreviewError(false);
      previewRule({ statement: statement.trim(), scope, excludeRuleId: editing?.id })
        .unwrap()
        .then(result => {
          setPreview(result);
          setWinner(null);
        })
        .catch(() => setPreviewError(true));
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement, scope]);

  const agree = useMemo(
    () => preview?.matches.filter(entry => entry.agrees).length ?? 0,
    [preview],
  );
  const conflicts = preview?.conflicts ?? [];
  const canSave =
    statement.trim().length >= 8 && !saving && (!conflicts.length || winner === "new");

  const save = async () => {
    if (!canSave) return;
    try {
      await createRule({
        statement: statement.trim(),
        scope,
        effect: decideAllowed && match ? effect : "guide",
        match,
        sourceHistoryId: source.mode === "draft" ? source.historyId : undefined,
        supersedes: [
          ...(editing ? [editing.id] : []),
          ...(winner === "new" ? conflicts.map(rule => rule.id) : []),
        ],
      }).unwrap();
      toast.success(strings.saved);
      onClose();
    } catch {
      toast.error(strings.failed);
    }
  };

  const chip = (active: boolean) =>
    [
      "min-h-[36px] rounded-full border px-3 text-sm",
      active ? "border-typography-900 bg-typography-900 text-white" : "border-neutral-500",
    ].join(" ");

  return (
    <Sheet
      title={editing ? strings.editTitle : strings.newTitle}
      placement={placement}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="min-h-[40px] border border-typography-900 px-4 text-sm"
            onClick={onClose}
          >
            {strings.cancel}
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className="min-h-[40px] bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {effect === "decide" && decideAllowed
              ? strings.saveDecide(preview?.matches.length ?? 0)
              : strings.save}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {origin && (
          <p className="text-sm text-typography-600">
            {strings.from(origin.prompt, origin.chosen ?? "")}
          </p>
        )}

        <div>
          <label
            htmlFor="rule-statement"
            className="mb-1.5 block text-xs tracking-wide text-typography-600"
          >
            {strings.statement}
          </label>
          <textarea
            id="rule-statement"
            value={statement}
            onChange={event => setStatement(event.target.value)}
            disabled={drafting}
            placeholder={drafting ? strings.drafting : ""}
            className="min-h-[88px] w-full resize-y border-0 border-b border-neutral-500 bg-neutral-100 px-3 py-2 text-base leading-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          />
          <p className="mt-1.5 text-xs text-typography-500">
            {drafting
              ? strings.drafting
              : source.mode === "draft"
                ? strings.drafted
                : strings.blank}
          </p>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-xs tracking-wide text-typography-600">
            {strings.scope}
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            {sessionId && (
              <button
                type="button"
                aria-pressed={scopeKind === "session"}
                className={chip(scopeKind === "session")}
                onClick={() => setScopeKind("session")}
              >
                {strings.scopes.session}
              </button>
            )}
            <button
              type="button"
              aria-pressed={scopeKind === "area"}
              className={chip(scopeKind === "area")}
              onClick={() => setScopeKind("area")}
            >
              {strings.scopes.area}
            </button>
            {scopeKind === "area" && (
              <select
                aria-label={strings.scopes.area}
                value={area}
                onChange={event => setArea(event.target.value)}
                className="min-h-[36px] rounded-full border border-neutral-500 bg-white px-3 text-sm"
              >
                {RULE_AREAS.map(name => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              aria-pressed={scopeKind === "everywhere"}
              className={chip(scopeKind === "everywhere")}
              onClick={() => setScopeKind("everywhere")}
            >
              {strings.scopes.everywhere}
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs tracking-wide text-typography-600">
            {strings.effect}
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={effect === "guide"}
              className={chip(effect === "guide")}
              onClick={() => setEffect("guide")}
            >
              {strings.guide}
            </button>
            <button
              type="button"
              aria-pressed={effect === "decide"}
              disabled={!decideAllowed || !match}
              className={[chip(effect === "decide"), "disabled:opacity-40"].join(" ")}
              onClick={() => setEffect("decide")}
            >
              {en.builder.room.rules.decideForMe}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-typography-500">
            {effect === "decide"
              ? strings.decideHelp
              : decideAllowed
                ? strings.guideHelp
                : `${strings.guideHelp} ${strings.decideNotOffered}`}
          </p>
        </fieldset>

        <div>
          <p className="mb-1.5 text-xs tracking-wide text-typography-600">{strings.preview}</p>
          <div className="bg-neutral-100 px-3 py-3 text-sm" aria-live="polite">
            {previewing && !preview ? (
              <p className="text-typography-500">{strings.previewing}</p>
            ) : previewError ? (
              <p className="text-typography-600">{strings.previewFailed}</p>
            ) : !preview ? (
              <p className="text-typography-500">{strings.blank}</p>
            ) : preview.matches.length ? (
              <>
                <p className="font-semibold">
                  {strings.previewCount(preview.matches.length, agree)}
                </p>
                <ul className="mt-2 flex flex-col gap-2 text-[13px]">
                  {preview.matches.map(entry => (
                    <li key={entry.historyId} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
                      <span
                        aria-hidden
                        className={entry.agrees ? "text-green-700" : "text-red-700"}
                      >
                        {entry.agrees ? "✓" : "✕"}
                      </span>
                      <span>
                        {entry.sessionTitle && (
                          <span className="text-typography-500">{entry.sessionTitle} · </span>
                        )}
                        {entry.prompt} → <b>{entry.chosen ?? "—"}</b>
                        {!entry.agrees && (
                          <span className="text-red-700"> ({strings.disagreed})</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="font-semibold">{strings.previewNone}</p>
                <p className="mt-1 font-medium text-amber-700">{strings.previewNoneWarn}</p>
              </>
            )}
          </div>
        </div>

        {conflicts.length > 0 && (
          <div className="border-l-[3px] border-amber-600 bg-amber-50 px-3 py-3 text-sm">
            <p className="font-semibold">{strings.conflict}</p>
            <ul className="my-2 flex flex-col gap-1 text-[13px]">
              {conflicts.map(rule => (
                <li key={rule.id}>
                  {rule.area}: {rule.statement}
                </li>
              ))}
            </ul>
            <p className="text-xs tracking-wide text-typography-600">{strings.whichWins}</p>
            <label className="mt-1.5 flex items-start gap-2">
              <input
                type="radio"
                name="rule-winner"
                checked={winner === "new"}
                onChange={() => setWinner("new")}
              />
              <span>{strings.newWins}</span>
            </label>
            <label className="mt-1.5 flex items-start gap-2">
              <input
                type="radio"
                name="rule-winner"
                checked={winner === "old"}
                onChange={() => {
                  setWinner("old");
                  onClose();
                }}
              />
              <span>{strings.oldWins}</span>
            </label>
          </div>
        )}
      </div>
    </Sheet>
  );
};
