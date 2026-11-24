import React, { useEffect, useMemo, useState } from "react";

import { useGetChatbotsQuery } from "@api";

import { SAFETY_PACKS_COPY as C } from "./copy";
import {
  useCreateSafetyPackDraftMutation,
  useGetSafetyPackReleaseQuery,
  useGetSafetyPacksQuery,
  useReleaseSafetyPackMutation,
  useRollbackSafetyPackMutation,
  useRunSafetyPackSuiteMutation,
  useUpdateSafetyPackDraftMutation,
} from "./safetyPacksApi";

import type {
  ListField,
  PackContent,
  PackReleaseDetail,
  SafetyPackSummary,
} from "./safetyPacksApi";

const buttonClass =
  "rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const secondaryClass =
  "rounded-md border border-border-light px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const inputClass = "border border-border-light rounded-md px-3 py-2 text-sm w-full";

const LIST_FIELDS: ListField[] = ["rules", "always", "never", "atRisk", "probes"];
const TEXT_FIELDS = ["name", "industryLabel", "builderMessage", "summary", "disclaimer"] as const;
type TextField = (typeof TEXT_FIELDS)[number];

const day = (at: string | null) => (at ? new Date(at).toLocaleDateString() : "");

const errorOf = (error: unknown): { code?: string; message?: string; blockers?: string[] } =>
  ((error as { data?: unknown })?.data ?? {}) as {
    code?: string;
    message?: string;
    blockers?: string[];
  };

/** One release-gate reason in words. */
export const blockerText = (blocker: string): string => {
  const [code, language] = blocker.split(":");
  if (code === "language_failed") return C.gate.languageFailed(language);
  if (code === "language_missing") return C.gate.languageMissing(language);
  return C.gate.blockers[code] ?? blocker;
};

const Message: React.FC<{ ok: boolean; text: string; testId?: string }> = ({
  ok,
  text,
  testId,
}) => (
  <p
    role={ok ? "status" : "alert"}
    className={ok ? "text-sm" : "text-sm text-red-700"}
    data-testid={testId}
  >
    {text}
  </p>
);

/** The diff against the current release. */
export const PackDiffView: React.FC<{ detail: PackReleaseDetail }> = ({ detail }) => {
  const { diff } = detail;
  return (
    <section className="space-y-2" data-testid="pack-diff">
      <h3 className="font-medium">{C.diff.title}</h3>
      {!diff.changed && <p className="text-sm">{C.diff.none}</p>}
      {LIST_FIELDS.map(field => {
        const { added, removed } = diff.lists[field];
        if (!added.length && !removed.length) return null;
        return (
          <div key={field} className="text-sm">
            <p className="font-medium">{C.editor.fields[field]}</p>
            <ul className="space-y-1">
              {added.map(line => (
                <li key={`a-${line}`} className="text-green-800 break-words">
                  + {C.diff.added}: {line}
                </li>
              ))}
              {removed.map(line => (
                <li key={`r-${line}`} className="text-red-700 break-words">
                  − {C.diff.removed}: {line}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {diff.text.map(change => (
        <p key={change.field} className="text-sm">
          {C.diff.textChanged(C.editor.fields[change.field] ?? change.field)}
        </p>
      ))}
      {diff.classifier && <p className="text-sm">{C.diff.classifier(diff.classifier.to)}</p>}
    </section>
  );
};

const toText = (lines: string[]) => lines.join("\n");
const toLines = (text: string) =>
  text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

/** Edit a draft's content. */
const DraftForm: React.FC<{ detail: PackReleaseDetail }> = ({ detail }) => {
  const [update, { isLoading }] = useUpdateSafetyPackDraftMutation();
  const initial = (content: PackContent) => ({
    lists: Object.fromEntries(LIST_FIELDS.map(f => [f, toText(content[f])])) as Record<
      ListField,
      string
    >,
    text: Object.fromEntries(TEXT_FIELDS.map(f => [f, content[f] ?? ""])) as Record<
      TextField,
      string
    >,
  });
  const [form, setForm] = useState(() => initial(detail.content));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const change = {
      ...Object.fromEntries(LIST_FIELDS.map(f => [f, toLines(form.lists[f])])),
      ...Object.fromEntries(TEXT_FIELDS.map(f => [f, form.text[f]])),
    };
    try {
      await update({ id: detail.id, change }).unwrap();
      setMessage({ ok: true, text: C.editor.saved });
    } catch (error) {
      const code = errorOf(error).code ?? (errorOf(error) as { errorCode?: string }).errorCode;
      setMessage({ ok: false, text: (code && C.editor.errors[code]) || C.editor.saveFailed });
    }
  };

  return (
    <form onSubmit={save} className="space-y-3" noValidate data-testid="pack-draft-form">
      {TEXT_FIELDS.map(field => (
        <label key={field} className="block text-sm">
          {C.editor.fields[field]}
          <input
            className={inputClass}
            value={form.text[field]}
            onChange={e => setForm(f => ({ ...f, text: { ...f.text, [field]: e.target.value } }))}
          />
        </label>
      ))}
      {LIST_FIELDS.map(field => (
        <label key={field} className="block text-sm">
          {C.editor.fields[field]}
          <textarea
            className={inputClass}
            rows={Math.min(10, Math.max(3, toLines(form.lists[field]).length + 1))}
            value={form.lists[field]}
            onChange={e => setForm(f => ({ ...f, lists: { ...f.lists, [field]: e.target.value } }))}
            data-testid={`pack-field-${field}`}
          />
        </label>
      ))}
      <button type="submit" className={buttonClass} disabled={isLoading}>
        {C.editor.save}
      </button>
      {message && <Message {...message} testId="pack-draft-message" />}
    </form>
  );
};

/** Run the crisis suite and show the per-language results. */
const SuitePanel: React.FC<{ detail: PackReleaseDetail; editable: boolean }> = ({
  detail,
  editable,
}) => {
  const { data: chatbots } = useGetChatbotsQuery();
  const [run, { isLoading }] = useRunSafetyPackSuiteMutation();
  const list = useMemo(() => chatbots?.chatbots ?? [], [chatbots]);
  const [chatbotId, setChatbotId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const results = detail.testResults;
  const running = results?.state === "running";
  useEffect(() => {
    if (!chatbotId && list.length) setChatbotId(results?.chatbotId ?? list[0].id);
  }, [list, chatbotId, results?.chatbotId]);

  const start = async () => {
    setMessage(null);
    try {
      await run({ id: detail.id, chatbotId }).unwrap();
    } catch {
      setMessage(C.suite.failedToRun);
    }
  };

  return (
    <section className="space-y-2" data-testid="pack-suite">
      <h3 className="font-medium">{C.suite.title}</h3>
      {editable && (
        <div className="space-y-2">
          {list.length ? (
            <label className="block text-sm">
              {C.suite.chatbot}
              <select
                className={inputClass}
                value={chatbotId}
                onChange={e => setChatbotId(e.target.value)}
              >
                {list.map(bot => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-typography-600">{C.suite.chatbotHint}</span>
            </label>
          ) : (
            <p className="text-sm">{C.suite.noChatbots}</p>
          )}
          <button
            type="button"
            className={secondaryClass}
            disabled={!chatbotId || running || isLoading}
            onClick={start}
          >
            {C.suite.run}
          </button>
        </div>
      )}
      {message && <Message ok={false} text={message} />}
      {!results && <p className="text-sm">{C.suite.notRun}</p>}
      {running && (
        <p className="text-sm" role="status">
          {C.suite.running}
        </p>
      )}
      {results?.state === "error" && <Message ok={false} text={C.suite.failedToRun} />}
      {results?.state === "done" && (
        <>
          <p className="text-sm" role="status">
            {results.allPassed ? C.suite.passed : C.suite.failed}
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="pack-suite-languages">
            {results.languages.map(r => (
              <li
                key={r.language}
                className={`rounded-md border px-2 py-1 text-sm ${
                  r.status === "pass" ? "border-green-700" : "border-red-700 text-red-700"
                }`}
              >
                {C.suite.language(r.language)}: {C.suite.statusText[r.status]} (
                {C.suite.result(r.passed, r.total)})
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

/** One release: diff, edit (draft), crisis check and the release gate. */
export const ReleasePanel: React.FC<{
  releaseId: string;
  pack: SafetyPackSummary;
  onClose: () => void;
  onChanged: () => void;
}> = ({ releaseId, pack, onClose, onChanged }) => {
  const [poll, setPoll] = useState(0);
  const { data, isLoading, isError } = useGetSafetyPackReleaseQuery(releaseId, {
    pollingInterval: poll,
  });
  const [release, { isLoading: releasing }] = useReleaseSafetyPackMutation();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const running = data?.testResults?.state === "running";
  useEffect(() => setPoll(running ? 5000 : 0), [running]);

  if (isLoading) return <p className="text-sm">{C.loading}</p>;
  if (isError || !data) return <Message ok={false} text={C.loadFailed} />;
  const editable = data.status === "draft" || data.status === "testing";

  const doRelease = async () => {
    if (!window.confirm(C.gate.releaseConfirm(pack.name, pack.chatbots))) return;
    setMessage(null);
    try {
      await release(data.id).unwrap();
      setMessage({ ok: true, text: C.gate.released });
      onChanged();
    } catch (error) {
      const blockers = errorOf(error).blockers;
      setMessage({
        ok: false,
        text: blockers?.length ? blockers.map(blockerText).join(" ") : C.gate.failed,
      });
    }
  };

  return (
    <section
      className="rounded-md border border-border-light bg-white p-4 md:p-5 space-y-4 min-w-0"
      data-testid="pack-release-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{C.editor.title(pack.name, data.version)}</h2>
        <button type="button" className={secondaryClass} onClick={onClose}>
          {C.release.close}
        </button>
      </div>
      <p className="text-sm">{C.status[data.status]}</p>
      {data.note && (
        <p className="text-sm whitespace-pre-wrap">
          {C.release.note}: {data.note}
        </p>
      )}
      <PackDiffView detail={data} />
      {editable ? (
        <DraftForm key={data.id} detail={data} />
      ) : (
        <p className="text-sm">{C.editor.readOnly}</p>
      )}
      <SuitePanel detail={data} editable={editable} />
      {editable && (
        <section className="space-y-2" data-testid="pack-gate">
          {data.blockers.length > 0 && (
            <ul className="text-sm list-disc pl-5">
              {data.blockers.map(b => (
                <li key={b}>{blockerText(b)}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className={buttonClass}
            disabled={data.blockers.length > 0 || releasing}
            onClick={doRelease}
          >
            {C.gate.release}
          </button>
        </section>
      )}
      {message && <Message {...message} testId="pack-release-message" />}
    </section>
  );
};

const PackCard: React.FC<{
  pack: SafetyPackSummary;
  onOpen: (releaseId: string) => void;
  onChanged: () => void;
}> = ({ pack, onOpen, onChanged }) => {
  const [create, { isLoading: creating }] = useCreateSafetyPackDraftMutation();
  const [rollback, { isLoading: rollingBack }] = useRollbackSafetyPackMutation();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const draft = async (source: "current" | "code") => {
    setMessage(null);
    try {
      const created = await create({ packId: pack.packId, source }).unwrap();
      onChanged();
      onOpen(created.id);
    } catch {
      setMessage({ ok: false, text: C.editor.saveFailed });
    }
  };

  const doRollback = async () => {
    if (!window.confirm(C.pack.rollbackConfirm(pack.name))) return;
    const note = window.prompt(C.pack.rollbackNote) ?? undefined;
    setMessage(null);
    try {
      await rollback({ packId: pack.packId, note: note || undefined }).unwrap();
      setMessage({ ok: true, text: C.pack.rolledBack });
      onChanged();
    } catch {
      setMessage({ ok: false, text: C.pack.noRollback });
    }
  };

  return (
    <section
      className="rounded-md border border-border-light bg-white p-4 md:p-5 space-y-3 min-w-0"
      data-testid={`pack-${pack.packId}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{pack.name}</h2>
        <span className="text-sm text-typography-600">{C.pack.chatbots(pack.chatbots)}</span>
      </div>
      <p className="text-sm">
        {C.pack.current(pack.currentVersion)} · {C.pack.code(pack.codeVersion)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryClass}
          disabled={creating}
          onClick={() => draft("current")}
        >
          {C.pack.newDraft}
        </button>
        {pack.codeVersion > (pack.currentVersion ?? 0) && (
          <button
            type="button"
            className={secondaryClass}
            disabled={creating}
            onClick={() => draft("code")}
          >
            {C.pack.newFromCode}
          </button>
        )}
        <button
          type="button"
          className={secondaryClass}
          disabled={!pack.canRollBack || rollingBack}
          onClick={doRollback}
          data-testid={`pack-rollback-${pack.packId}`}
        >
          {C.pack.rollback}
        </button>
      </div>
      {message && <Message {...message} />}
      <h3 className="text-sm font-medium">{C.pack.history}</h3>
      <ul className="divide-y divide-border-light">
        {pack.releases.map(r => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm">
              {C.release.version(r.version)} · {r.current ? C.status.current : C.status[r.status]} ·{" "}
              {r.releasedAt
                ? C.release.releasedAt(day(r.releasedAt))
                : C.release.created(day(r.createdAt))}
              {r.rolledBackAt ? ` · ${C.release.rolledBackAt(day(r.rolledBackAt))}` : ""}
            </span>
            <button type="button" className={secondaryClass} onClick={() => onOpen(r.id)}>
              {C.release.open}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

/** Ally admin -> Safety packs (stage 9). Gated by `manage:safety-packs`. */
export const SafetyPacks: React.FC = () => {
  const { data, isLoading, isError, refetch } = useGetSafetyPacksQuery();
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <p className="p-4 text-sm">{C.loading}</p>;
  if (isError || !data) return <Message ok={false} text={C.loadFailed} />;
  const openPack = open ? data.packs.find(p => p.releases.some(r => r.id === open)) : undefined;

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-5xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-medium">{C.title}</h1>
        <p className="text-sm">{C.intro}</p>
        <p className="text-sm text-typography-600">{C.languages(data.languages)}</p>
        {!data.enabled && <Message ok={false} text={C.switchedOff} />}
      </header>
      {open && openPack && (
        <ReleasePanel
          releaseId={open}
          pack={openPack}
          onClose={() => setOpen(null)}
          onChanged={() => void refetch()}
        />
      )}
      {data.packs.map(pack => (
        <PackCard key={pack.packId} pack={pack} onOpen={setOpen} onChanged={() => void refetch()} />
      ))}
    </div>
  );
};

export default SafetyPacks;
