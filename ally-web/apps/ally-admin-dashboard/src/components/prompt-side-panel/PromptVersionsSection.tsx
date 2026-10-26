import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import {
  useDiscardPromptVersionMutation,
  useGetLanguagesQuery,
  usePromotePromptVersionMutation,
  useTranslatePromptVersionMutation,
} from "@api";
import { ActionConfirmationPopup, Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { PromptVersionSummary, PromptVersionTranslations, SkillsStoreErrorCode } from "@types";
import { getErrorMessage } from "@utils/errorMessage";
import { diffLines, placeholdersIn } from "@utils/promptVersionText";

interface Props {
  promptId: string;
  versions: PromptVersionSummary[];
  /** Refetch the list (after a conflict, or once a publish lands). */
  onReload: () => void;
}

/** The `errorCode` a Skills Store write-path error carries in its body, if any. */
export const skillsStoreErrorCode = (error: unknown): SkillsStoreErrorCode | undefined =>
  (error as { data?: { errorCode?: SkillsStoreErrorCode } } | null)?.data?.errorCode;

/** The `details` object that rides with a Skills Store error. */
export const skillsStoreErrorDetails = (error: unknown): Record<string, unknown> =>
  (error as { data?: { details?: Record<string, unknown> } } | null)?.data?.details ?? {};

type BusyAction = "publish" | "retry" | "discard";

const STATUS_STYLES: Record<PromptVersionSummary["status"], string> = {
  live: "bg-green-100 text-green-800",
  candidate: "bg-amber-100 text-amber-800",
  history: "bg-neutral-100 text-neutral-700",
};

const formatWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/**
 * A prompt's versions: the live one, drafts waiting to be published (with how
 * their translations are getting on) and earlier ones that can be rolled back
 * to. Every change to a prompt's text or model goes through here — a draft is
 * saved from the editor, then published. Each version expands to its full text,
 * the variables it uses and, for any but the live one, its changes from live.
 */
const PromptVersionsSection: React.FC<Props> = ({ promptId, versions, onReload }) => {
  const strings = en.skillsStore.versions;
  const { data: languages } = useGetLanguagesQuery({});
  const [promote] = usePromotePromptVersionMutation();
  const [translateVersion] = useTranslatePromptVersionMutation();
  const [discardVersion] = useDiscardPromptVersionMutation();
  // Which version has a request running, and which action, so only that button says so.
  const [busy, setBusy] = useState<{ version: number; action: BusyAction } | null>(null);
  const [rollBackTo, setRollBackTo] = useState<number | null>(null);
  const [discardTarget, setDiscardTarget] = useState<number | null>(null);
  const [rubricConfirmFor, setRubricConfirmFor] = useState<{
    version: number;
    rollback: boolean;
  } | null>(null);

  const languageLabel = useMemo(() => {
    const map = new Map<number, string>();
    (languages ?? []).forEach(l => {
      if (typeof l.id === "number") map.set(l.id, l.label);
    });
    return (id: number) => map.get(id) ?? `Language ${id}`;
  }, [languages]);

  const live = versions.find(v => v.status === "live") ?? null;
  const liveVersion = live?.version ?? null;

  const runPromote = async (version: number, rollback: boolean, confirmJudge = false) => {
    setBusy({ version, action: "publish" });
    try {
      const result = await promote({
        id: promptId,
        version,
        body: {
          expectedCurrentVersion: liveVersion,
          ...(rollback ? { rollback: true } : {}),
          ...(confirmJudge ? { confirmJudgeRubricChange: true } : {}),
        },
      }).unwrap();
      toast.success(strings.published(result.version));
      if (result.failedLanguages?.length) {
        toast.warning(
          strings.failedLanguagesKeepEnglish(
            result.failedLanguages.map(f => languageLabel(f.languageId)).join(", "),
          ),
        );
      }
      onReload();
    } catch (error) {
      const code = skillsStoreErrorCode(error);
      if (code === "SKILLS_STORE_JUDGE_RUBRIC_PINNED") {
        setRubricConfirmFor({ version, rollback });
      } else if (code === "SKILLS_STORE_TRANSLATIONS_PENDING") {
        toast.message(strings.translationsRunning);
        onReload();
      } else if (code === "SKILLS_STORE_STALE_BASE") {
        toast.error(strings.liveChanged);
        onReload();
      } else if ((error as { status?: unknown } | null)?.status !== 403) {
        toast.error(getErrorMessage(error, strings.publishFailed));
      }
    } finally {
      setBusy(null);
    }
  };

  const retryTranslations = async (version: number) => {
    setBusy({ version, action: "retry" });
    try {
      await translateVersion({ id: promptId, version }).unwrap();
      onReload();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.publishFailed));
    } finally {
      setBusy(null);
    }
  };

  const runDiscard = async (version: number) => {
    setBusy({ version, action: "discard" });
    try {
      await discardVersion({ id: promptId, version }).unwrap();
      toast.success(strings.discarded(version));
      onReload();
    } catch (error) {
      if ((error as { status?: unknown } | null)?.status !== 403) {
        toast.error(getErrorMessage(error, strings.discardFailed));
      }
      onReload();
    } finally {
      setBusy(null);
    }
  };

  if (!versions.length) {
    return <p className="text-sm text-typography-500">{strings.empty}</p>;
  }

  return (
    <div className="w-full flex flex-col divide-y divide-border-light border-y border-border-light">
      {versions.map(v => (
        <VersionRow
          key={v.version}
          version={v}
          live={live}
          languageLabel={languageLabel}
          busy={busy?.version === v.version ? busy.action : null}
          onPublish={() => void runPromote(v.version, false)}
          onRetry={() => void retryTranslations(v.version)}
          onRollBack={() => setRollBackTo(v.version)}
          onDiscard={() => setDiscardTarget(v.version)}
        />
      ))}

      <ActionConfirmationPopup
        isOpen={rollBackTo != null}
        onClose={() => setRollBackTo(null)}
        title={rollBackTo != null ? strings.rollBackTitle(rollBackTo) : ""}
        description={strings.rollBackBody}
        primaryButton={{
          label: strings.rollBack,
          onClick: () => {
            const target = rollBackTo;
            setRollBackTo(null);
            if (target != null) void runPromote(target, true);
          },
        }}
        secondaryButton={{ label: strings.cancel, onClick: () => setRollBackTo(null) }}
      />
      <ActionConfirmationPopup
        isOpen={discardTarget != null}
        onClose={() => setDiscardTarget(null)}
        title={discardTarget != null ? strings.discardTitle(discardTarget) : ""}
        description={strings.discardBody}
        primaryButton={{
          label: strings.discard,
          onClick: () => {
            const target = discardTarget;
            setDiscardTarget(null);
            if (target != null) void runDiscard(target);
          },
        }}
        secondaryButton={{ label: strings.cancel, onClick: () => setDiscardTarget(null) }}
      />
      <ActionConfirmationPopup
        isOpen={rubricConfirmFor != null}
        onClose={() => setRubricConfirmFor(null)}
        title={strings.judgeRubricTitle}
        description={strings.judgeRubricBody}
        primaryButton={{
          label: strings.judgeRubricConfirm,
          onClick: () => {
            const target = rubricConfirmFor;
            setRubricConfirmFor(null);
            if (target) void runPromote(target.version, target.rollback, true);
          },
        }}
        secondaryButton={{ label: strings.cancel, onClick: () => setRubricConfirmFor(null) }}
      />
    </div>
  );
};

const TranslationSummary: React.FC<{
  translations: PromptVersionTranslations;
  languageLabel: (id: number) => string;
}> = ({ translations, languageLabel }) => {
  const strings = en.skillsStore.versions;
  const total =
    translations.ready.length + translations.failed.length + translations.pending.length;
  if (!translations.translatable || total === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-typography-600">
      <span>
        {strings.translationStatus(translations.ready.length, total)}
        {translations.pending.length > 0 &&
          ` · ${strings.pendingCount(translations.pending.length)}`}
        {translations.failed.length > 0 && ` · ${strings.failedCount(translations.failed.length)}`}
      </span>
      {translations.failed.length > 0 && (
        <span className="text-destructive-500" data-testid="version-failed-languages">
          {strings.failedLanguagesKeepEnglish(
            translations.failed.map(f => languageLabel(f.languageId)).join(", "),
          )}
        </span>
      )}
    </div>
  );
};

/** A version's text, its variables and, against the live version, its changes. */
const VersionDetail: React.FC<{
  version: PromptVersionSummary;
  live: PromptVersionSummary | null;
}> = ({ version: v, live }) => {
  const strings = en.skillsStore.versions;
  const [comparing, setComparing] = useState(false);
  const variables = useMemo(() => placeholdersIn(v.prompt), [v.prompt]);
  const canCompare = live != null && live.version !== v.version;
  const diff = useMemo(
    () => (comparing && live ? diffLines(live.prompt, v.prompt) : null),
    [comparing, live, v.prompt],
  );
  const unchanged = diff?.every(line => line.kind === "same") ?? false;

  return (
    <div className="flex flex-col gap-2" data-testid={`prompt-version-${v.version}-detail`}>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-typography-700">{strings.variables}</span>
        {variables.length ? (
          <div className="flex flex-wrap gap-1">
            {variables.map(name => (
              <span
                key={name}
                className="px-1.5 py-0.5 rounded bg-neutral-100 text-xs font-mono text-typography-800"
              >
                {`{${name}}`}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-typography-500">{strings.noVariables}</span>
        )}
      </div>
      {canCompare && (
        <button
          type="button"
          className="self-start text-xs text-primary-600 hover:underline"
          onClick={() => setComparing(c => !c)}
        >
          {comparing ? strings.showFullText : strings.compareWithLive(live.version)}
        </button>
      )}
      {diff && live ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-typography-600">
            {unchanged
              ? strings.noDifferences(live.version)
              : strings.comparing(v.version, live.version)}
          </span>
          <pre
            className="max-h-80 overflow-auto rounded border border-border-light text-xs font-mono whitespace-pre-wrap break-words"
            data-testid={`prompt-version-${v.version}-diff`}
          >
            {diff.map((line, i) => (
              <div
                key={i}
                className={
                  line.kind === "added"
                    ? "bg-green-50 text-green-900 px-2"
                    : line.kind === "removed"
                      ? "bg-red-50 text-red-900 line-through px-2"
                      : "px-2 text-typography-700"
                }
              >
                {(line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  ") +
                  (line.text || " ")}
              </div>
            ))}
          </pre>
        </div>
      ) : (
        <pre
          className="max-h-80 overflow-auto rounded border border-border-light bg-neutral-50 p-2 text-xs font-mono text-typography-800 whitespace-pre-wrap break-words"
          data-testid={`prompt-version-${v.version}-text`}
        >
          {v.prompt}
        </pre>
      )}
    </div>
  );
};

const VersionRow: React.FC<{
  version: PromptVersionSummary;
  live: PromptVersionSummary | null;
  languageLabel: (id: number) => string;
  busy: BusyAction | null;
  onPublish: () => void;
  onRetry: () => void;
  onRollBack: () => void;
  onDiscard: () => void;
}> = ({ version: v, live, languageLabel, busy, onPublish, onRetry, onRollBack, onDiscard }) => {
  const strings = en.skillsStore.versions;
  const [expanded, setExpanded] = useState(false);
  const label =
    v.status === "live" ? strings.live : v.status === "candidate" ? strings.draft : strings.history;
  const pending = v.translations?.translatable ? v.translations.pending.length : 0;
  const failed = v.translations?.translatable ? v.translations.failed.length : 0;
  const source = v.source ? (strings.sources[v.source] ?? v.source) : null;

  return (
    <div className="flex flex-col gap-2 py-3" data-testid={`prompt-version-${v.version}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-medium text-typography-900 tabular-nums">
              v{v.version}
            </span>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs ${STATUS_STYLES[v.status]}`}>
              {label}
            </span>
            {v.model && <span className="text-xs text-typography-500 font-mono">{v.model}</span>}
          </div>
          <span className="text-xs text-typography-500">
            {[source, formatWhen(v.publishedAt ?? v.createdAt)].filter(Boolean).join(" · ")}
          </span>
          {v.note && <span className="text-sm text-typography-700 break-words">{v.note}</span>}
          <button
            type="button"
            className="self-start text-xs text-primary-600 hover:underline"
            aria-expanded={expanded}
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? strings.hideText : strings.showText}
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {v.status === "candidate" && failed > 0 && (
            <Button variant={ButtonVariant.SECONDARY} onClick={onRetry} disabled={!!busy}>
              {busy === "retry" ? strings.retrying : strings.retryTranslations}
            </Button>
          )}
          {v.status === "candidate" && (
            <Button variant={ButtonVariant.TEXT} onClick={onDiscard} disabled={!!busy}>
              {busy === "discard" ? strings.discarding : strings.discard}
            </Button>
          )}
          {v.status === "candidate" && (
            <Button
              variant={ButtonVariant.PRIMARY}
              onClick={onPublish}
              disabled={!!busy || pending > 0}
              title={pending > 0 ? strings.translationsRunning : undefined}
            >
              {busy === "publish" ? strings.publishing : strings.publish}
            </Button>
          )}
          {v.status === "history" && (
            <Button variant={ButtonVariant.SECONDARY} onClick={onRollBack} disabled={!!busy}>
              {strings.rollBack}
            </Button>
          )}
        </div>
      </div>
      {v.translations && v.status !== "history" && (
        <TranslationSummary translations={v.translations} languageLabel={languageLabel} />
      )}
      {expanded && <VersionDetail version={v} live={live} />}
    </div>
  );
};

export default PromptVersionsSection;
