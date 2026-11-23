import React, { useEffect, useRef, useState } from "react";

import { useApplyBotDraftChangeMutation, useProposeBotDraftChangeMutation } from "@api";
import type { DraftChangeProposal, ProposedChange } from "@api";
import { Button, Chip } from "@components/v2";

import { BUILD_COPY } from "./copy";
import {
  asText,
  codeOf,
  crawlFailureText,
  isCreditsRequired,
  looksLikeAddress,
  messageOf,
} from "./logic";
import { SOURCE_ACCEPT, filesOk } from "./useSources";
import { COPY, fill } from "../copy";

import type { SuggestionId } from "./logic";
import type { Narration } from "./useDraftEvents";
import type { WorkingCopy } from "./useWorkingCopy";

const C = BUILD_COPY.copilot;
const QUESTIONS = BUILD_COPY.interview;

type Question = (typeof QUESTIONS)[number];

/** A working-copy field's name as the builder knows it. */
export const fieldLabel = (field: string): string => {
  const f = BUILD_COPY.form;
  const map: Record<string, string> = {
    name: f.name,
    assistantName: f.assistantName,
    introduction: f.greeting,
    tone: f.tone,
    instructions: f.instructions,
    languages: f.languages,
    suggestedQuestions: f.questions,
    declineText: f.decline,
    extraNever: COPY.change.fields.add_rule,
    ownerNotes: f.sections.sources,
  };
  return map[field] ?? field;
};

type Line =
  | { id: string; kind: "you"; text: string }
  | { id: string; kind: "copilot"; text: string; error?: boolean }
  | { id: string; kind: "narration"; text: string; error?: boolean }
  | {
      id: string;
      kind: "proposal";
      proposal: DraftChangeProposal;
      state: "open" | "applied" | "discarded";
    }
  | { id: string; kind: "confirm"; proposalId: string; fields: string[] };

// The backend keeps no Copilot conversation (only the older builder chat), so the lines are kept
// per chatbot in this browser and read back on reload.
const MAX_SAVED_LINES = 100;
const linesKey = (draftId: string) => `ally.build.copilot.${draftId}`;
const readLines = (draftId: string): Line[] => {
  try {
    const raw = window.localStorage.getItem(linesKey(draftId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as Line[]) : [];
  } catch {
    return [];
  }
};
const writeLines = (draftId: string, lines: Line[]) => {
  try {
    const keep = lines.filter(l => l.kind !== "confirm").slice(-MAX_SAVED_LINES);
    window.localStorage.setItem(linesKey(draftId), JSON.stringify(keep));
  } catch {
    // no storage: the conversation lasts until the page closes
  }
};

const show = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return C.empty;
  if (Array.isArray(value)) return value.join(" · ") || C.empty;
  return String(value);
};

/** The next interview question whose field is still empty. */
export const nextQuestion = (
  values: Record<string, unknown>,
  asked: Set<string>,
): Question | null =>
  QUESTIONS.find(q => !asked.has(q.field) && !asText(values[q.field]).trim()) ?? null;

/**
 * Copilot: a conversation that edits the same working copy as the form. A pasted web address is
 * read (progress arrives as narration on /events), attached files are added as sources, an answer
 * to Copilot's question goes straight into that field, and anything else is a proposed change
 * shown as a before and after, applied only on Apply. A change to a field the builder is still
 * editing in the form asks first.
 */
export const Copilot: React.FC<{
  copy: WorkingCopy;
  draftId: string;
  canEdit: boolean;
  /** Opened from "Answer a few questions": Copilot asks first. */
  interview: boolean;
  narration: Narration[];
  suggestions: SuggestionId[];
  addAddress: (address: string) => Promise<{
    started: string | null;
    queued: string[];
    failure: { errorCode: string; message: string } | null;
  }>;
  addFiles: (files: File[]) => Promise<{ documents: { id: string; title: string }[] }>;
}> = ({ copy, draftId, canEdit, interview, narration, suggestions, addAddress, addFiles }) => {
  const [propose] = useProposeBotDraftChangeMutation();
  const [applyChange] = useApplyBotDraftChangeMutation();
  const restored = useRef<Line[] | null>(null);
  if (restored.current === null) restored.current = readLines(draftId);
  const counter = useRef(restored.current.length + 1000);
  const nextId = () => `c${(counter.current += 1)}`;
  const asked = useRef(new Set<string>());
  const [question, setQuestion] = useState<Question | null>(() =>
    interview && !restored.current?.length ? nextQuestion(copy.values, asked.current) : null,
  );
  const [lines, setLines] = useState<Line[]>(() => {
    if (restored.current && restored.current.length) return restored.current;
    const first: Line[] = [
      { id: "c0", kind: "copilot", text: interview ? C.interviewHello : C.hello },
    ];
    const q = interview ? nextQuestion(copy.values, new Set()) : null;
    if (q) first.push({ id: "c-q0", kind: "copilot", text: q.ask });
    return first;
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const seen = useRef(narration.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLOListElement>(null);
  const off = !canEdit || copy.creditsOut;

  if (question) asked.current.add(question.field);

  // Narration from the event stream, as Copilot's own progress lines.
  useEffect(() => {
    if (narration.length <= seen.current) return;
    const fresh = narration.slice(seen.current);
    seen.current = narration.length;
    setLines(list => [
      ...list,
      ...fresh.map(n => ({
        id: nextId(),
        kind: "narration" as const,
        text: n.errorCode ? crawlFailureText(n.errorCode, n.text) : n.text,
        error: Boolean(n.errorCode),
      })),
    ]);
  }, [narration]);

  useEffect(() => {
    writeLines(draftId, lines);
  }, [draftId, lines]);

  useEffect(() => {
    scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
  }, [lines.length]);

  const say = (line: Omit<Extract<Line, { kind: "copilot" }>, "id" | "kind">) =>
    setLines(list => [...list, { id: nextId(), kind: "copilot", ...line }]);

  const fail = (error: unknown, fallback: string = C.failed) => {
    if (isCreditsRequired(error)) {
      copy.markCreditsOut();
      say({ text: BUILD_COPY.credits.body, error: true });
      return;
    }
    const code = codeOf(error);
    if (code === "stale_field" || code === "stale_version") say({ text: C.stale, error: true });
    else if (code && BUILD_COPY.crawlFailure[code])
      say({ text: crawlFailureText(code), error: true });
    else say({ text: messageOf(error) ?? fallback, error: true });
  };

  const askNext = () => {
    const q = nextQuestion(copy.values, asked.current);
    setQuestion(q);
    if (q) say({ text: q.ask });
  };

  const answer = async (q: Question, value: string) => {
    const current = asText(copy.values[q.field]).trim();
    // An answer about what they do adds to the notes rather than replacing them.
    const next = q.field === "ownerNotes" && current ? `${current}\n\n${value}` : value;
    const outcome = await copy.commit(q.field, next);
    if (outcome.status === "credits") {
      say({ text: BUILD_COPY.credits.body, error: true });
      return;
    }
    if (outcome.status !== "saved") {
      say({ text: outcome.reason || BUILD_COPY.field.refused, error: true });
      return;
    }
    say({ text: fill(C.saved, { field: fieldLabel(q.field) }) });
    askNext();
  };

  const runApply = async (lineId: string, proposal: DraftChangeProposal) => {
    setBusy(true);
    try {
      await applyChange({
        id: draftId,
        changes: proposal.changes,
        version: proposal.version,
        ...(proposal.fieldVersions ? { fieldVersions: proposal.fieldVersions } : {}),
      }).unwrap();
      setLines(list =>
        list.map(l => (l.id === lineId && l.kind === "proposal" ? { ...l, state: "applied" } : l)),
      );
      await copy.refresh();
      say({ text: copy.live ? C.appliedLive : C.applied });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const tryApply = (lineId: string, proposal: DraftChangeProposal) => {
    const touched = Object.keys(proposal.fieldVersions ?? {});
    const editing = touched.filter(f => copy.hasPendingEdit(f));
    if (editing.length) {
      setLines(list => [
        ...list,
        { id: nextId(), kind: "confirm", proposalId: lineId, fields: editing },
      ]);
      return;
    }
    void runApply(lineId, proposal);
  };

  const send = async (raw: string) => {
    const value = raw.trim();
    if (!value || busy || off) return;
    setText("");
    setLines(list => [...list, { id: nextId(), kind: "you", text: value }]);
    setBusy(true);
    try {
      if (looksLikeAddress(value)) {
        const result = await addAddress(value);
        if (result.failure) {
          say({
            text: crawlFailureText(result.failure.errorCode, result.failure.message),
            error: true,
          });
        }
        // Progress itself arrives as narration.
        return;
      }
      if (question) {
        await answer(question, value);
        return;
      }
      const proposal = await propose({ id: draftId, message: value }).unwrap();
      if (proposal.refused) {
        say({ text: proposal.message || C.refused });
      } else if (!proposal.changes.length) {
        say({ text: proposal.message || C.nothing });
      } else {
        setLines(list => [...list, { id: nextId(), kind: "proposal", proposal, state: "open" }]);
      }
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const attach = async (files: File[]) => {
    if (!filesOk(files)) {
      say({ text: BUILD_COPY.start.fileLimits, error: true });
      return;
    }
    setBusy(true);
    try {
      const result = await addFiles(files);
      const docs = result.documents ?? [];
      say({
        text:
          docs.length === 1
            ? fill(C.uploadedOne, { title: docs[0].title })
            : fill(C.uploaded, { n: docs.length }),
      });
    } catch (error) {
      fail(error, C.uploadFailed);
    } finally {
      setBusy(false);
    }
  };

  const proposalById = (id: string) =>
    lines.find(
      (l): l is Extract<Line, { kind: "proposal" }> => l.id === id && l.kind === "proposal",
    );

  return (
    <section className="ally-build__copilot" aria-label={C.label} data-testid="copilot">
      <ol className="ally-build__chat" ref={scroller} aria-live="polite">
        {lines.map(line => {
          if (line.kind === "you") {
            return (
              <li key={line.id} className="ally-dt__msg ally-dt__msg--user">
                <span className="ally-dt__who">{C.you}</span>
                <p>{line.text}</p>
              </li>
            );
          }
          if (line.kind === "copilot" || line.kind === "narration") {
            return (
              <li
                key={line.id}
                className={`ally-dt__msg ally-dt__msg--assistant${line.kind === "narration" ? " ally-build__narration" : ""}`}
                data-testid={line.kind === "narration" ? "copilot-narration" : undefined}
                role={line.error ? "alert" : undefined}
              >
                {line.kind === "copilot" && <span className="ally-dt__who">{C.copilot}</span>}
                <p>{line.text}</p>
              </li>
            );
          }
          if (line.kind === "confirm") {
            const target = proposalById(line.proposalId);
            if (!target || target.state !== "open") return null;
            return (
              <li
                key={line.id}
                className="ally-build__confirm"
                role="alert"
                data-testid="copilot-confirm"
              >
                <p>{fill(C.pendingEdit, { field: line.fields.map(fieldLabel).join(", ") })}</p>
                <div className="ally-dt__actions">
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      line.fields.forEach(f => copy.reload(f));
                      void runApply(target.id, target.proposal);
                    }}
                  >
                    {C.replace}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setLines(list =>
                        list.map(l =>
                          l.id === target.id && l.kind === "proposal"
                            ? { ...l, state: "discarded" }
                            : l,
                        ),
                      )
                    }
                  >
                    {C.keepMine}
                  </Button>
                </div>
              </li>
            );
          }
          const p = line.proposal;
          return (
            <li key={line.id} className="ally-build__proposal" data-testid="copilot-proposal">
              <p className="ally-field__label">{C.proposalHeading}</p>
              {p.message && <p className="ally-small">{p.message}</p>}
              <dl>
                {p.changes.map((change: ProposedChange, n) => (
                  <div key={`${change.field}-${n}`}>
                    <dt>
                      {(COPY.change.fields as Record<string, string>)[change.field] ?? change.field}
                    </dt>
                    <dd>
                      <span className="ally-small">{COPY.change.before}: </span>
                      {show(change.before)}
                    </dd>
                    <dd>
                      <span className="ally-small">{COPY.change.after}: </span>
                      {show(change.after)}
                    </dd>
                  </div>
                ))}
              </dl>
              {line.state === "open" ? (
                <div className="ally-dt__actions">
                  <Button
                    variant="primary"
                    disabled={busy || off}
                    onClick={() => tryApply(line.id, p)}
                  >
                    {C.apply}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setLines(list =>
                        list.map(l =>
                          l.id === line.id && l.kind === "proposal"
                            ? { ...l, state: "discarded" }
                            : l,
                        ),
                      );
                      say({ text: C.discarded });
                    }}
                  >
                    {C.discard}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
        {busy && (
          <li className="ally-small" role="status">
            {C.thinking}
          </li>
        )}
      </ol>

      {copy.creditsOut && (
        <p className="ally-small" role="note" data-testid="copilot-credits">
          {BUILD_COPY.credits.body}
        </p>
      )}

      {(question || suggestions.length > 0) && !off && (
        <div className="ally-chips" role="group" aria-label={C.ideas}>
          {question && (
            <Chip outline onToggle={askNext}>
              {C.skip}
            </Chip>
          )}
          {!question &&
            suggestions.slice(0, 3).map(id => (
              <Chip key={id} outline onToggle={() => setText(BUILD_COPY.suggestions[id])}>
                {BUILD_COPY.suggestions[id]}
              </Chip>
            ))}
        </div>
      )}

      <form
        className="ally-dt__form"
        onSubmit={event => {
          event.preventDefault();
          void send(text);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept={SOURCE_ACCEPT}
          data-testid="copilot-upload"
          onChange={event => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void attach(files);
          }}
        />
        <Button
          variant="ghost"
          aria-label={C.attach}
          disabled={off || busy}
          onClick={() => fileRef.current?.click()}
        >
          📎
        </Button>
        <input
          className="ally-input"
          aria-label={C.inputLabel}
          placeholder={C.placeholder}
          value={text}
          disabled={off || busy}
          onChange={e => setText(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={off || busy || !text.trim()}>
          {C.send}
        </Button>
      </form>
    </section>
  );
};
