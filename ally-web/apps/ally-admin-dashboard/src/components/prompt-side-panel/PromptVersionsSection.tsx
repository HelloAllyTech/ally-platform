import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import {
  useGetLanguagesQuery,
  usePromotePromptVersionMutation,
  useTranslatePromptVersionMutation,
} from "@api";
import { ActionConfirmationPopup, Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { PromptVersionSummary, PromptVersionTranslations, SkillsStoreErrorCode } from "@types";
import { getErrorMessage } from "@utils/errorMessage";

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
 * saved from the editor, then published.
 */
const PromptVersionsSection: React.FC<Props> = ({ promptId, versions, onReload }) => {
  const strings = en.skillsStore.versions;
  const { data: languages } = useGetLanguagesQuery({});
  const [promote, { isLoading: isPromoting }] = usePromotePromptVersionMutation();
  const [translateVersion, { isLoading: isRetrying }] = useTranslatePromptVersionMutation();
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [rollBackTo, setRollBackTo] = useState<number | null>(null);
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

  const liveVersion = versions.find(v => v.status === "live")?.version ?? null;

  const runPromote = async (version: number, rollback: boolean, confirmJudge = false) => {
    setBusyVersion(version);
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
      setBusyVersion(null);
    }
  };

  const retryTranslations = async (version: number) => {
    setBusyVersion(version);
    try {
      await translateVersion({ id: promptId, version }).unwrap();
      onReload();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.publishFailed));
    } finally {
      setBusyVersion(null);
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
          languageLabel={languageLabel}
          busy={busyVersion === v.version && (isPromoting || isRetrying)}
          onPublish={() => void runPromote(v.version, false)}
          onRetry={() => void retryTranslations(v.version)}
          onRollBack={() => setRollBackTo(v.version)}
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

const VersionRow: React.FC<{
  version: PromptVersionSummary;
  languageLabel: (id: number) => string;
  busy: boolean;
  onPublish: () => void;
  onRetry: () => void;
  onRollBack: () => void;
}> = ({ version: v, languageLabel, busy, onPublish, onRetry, onRollBack }) => {
  const strings = en.skillsStore.versions;
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
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {v.status === "candidate" && failed > 0 && (
            <Button variant={ButtonVariant.SECONDARY} onClick={onRetry} disabled={busy}>
              {busy ? strings.retrying : strings.retryTranslations}
            </Button>
          )}
          {v.status === "candidate" && (
            <Button
              variant={ButtonVariant.PRIMARY}
              onClick={onPublish}
              disabled={busy || pending > 0}
              title={pending > 0 ? strings.translationsRunning : undefined}
            >
              {busy ? strings.publishing : strings.publish}
            </Button>
          )}
          {v.status === "history" && (
            <Button variant={ButtonVariant.SECONDARY} onClick={onRollBack} disabled={busy}>
              {strings.rollBack}
            </Button>
          )}
        </div>
      </div>
      {v.translations && v.status !== "history" && (
        <TranslationSummary translations={v.translations} languageLabel={languageLabel} />
      )}
    </div>
  );
};

export default PromptVersionsSection;
