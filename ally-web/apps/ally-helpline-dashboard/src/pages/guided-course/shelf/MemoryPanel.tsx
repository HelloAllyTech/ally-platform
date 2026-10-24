import { FC, useState } from "react";

import { useTranslation } from "react-i18next";

import {
  useForgetAllGuideMemoryMutation,
  useForgetGuideMemoryMutation,
  useGetGuideMemoryQuery,
  useGetGuidePrefsQuery,
  usePutGuidePrefsMutation,
} from "@api";

import {
  ConfirmRemove,
  SettingSwitch,
  ShelfLoadFailed,
  ShelfLoading,
  shortDate,
  UtilityPage,
} from "./shelfParts";

import type { GuideMemorySource } from "../contract/wire";

const KNOWN_KINDS = [
  "preference",
  "goal",
  "possible_self",
  "strength",
  "struggle",
  "context",
  "commitment",
  "unique_outcome",
];

/**
 * Why Ally remembers this (memory provenance, plan §6): the learner's own
 * words it was drawn from, quoted as they wrote them, with when. A source
 * they have since deleted is simply absent.
 */
const MemorySources: FC<{ sources: GuideMemorySource[]; language: string }> = ({
  sources,
  language,
}) => {
  const { t } = useTranslation();
  if (!sources.length) return null;
  return (
    <details className="mt-1" data-testid="memory-sources">
      <summary className="min-h-11 cursor-pointer py-2 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2">
        {t("guide.memory.why")}
      </summary>
      <ul className="flex flex-col gap-2 pb-1">
        {sources.map(source => {
          const when = shortDate(source.at, language);
          return (
            <li key={source.messageId} className="border-l-2 border-[var(--g-line)] pl-3">
              <q className="font-secondary text-base text-[var(--g-ink)]">{source.excerpt}</q>
              {when && (
                <span className="g-caption block">{t("guide.memory.youSaid", { date: when })}</span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
};

/**
 * What Ally remembers (plan §6, memory: view, forget one, forget all, turn
 * off). Shown plainly, theirs to remove, with the switch right above the
 * list (Stacks: "Make Agent Memory Transparent and User-Controllable").
 */
export const MemoryPanel: FC<{ onForgotten?: (scope: "one" | "all") => void }> = ({
  onForgotten,
}) => {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError, refetch } = useGetGuideMemoryQuery();
  const { data: prefs } = useGetGuidePrefsQuery();
  const [putPrefs, { isLoading: saving }] = usePutGuidePrefsMutation();
  const [forget, { isLoading: forgetting }] = useForgetGuideMemoryMutation();
  const [forgetAll, { isLoading: forgettingAll }] = useForgetAllGuideMemoryMutation();
  const [failed, setFailed] = useState<string | null>(null);
  const enabled = prefs?.memoryEnabled !== false;

  const run = async (work: () => Promise<unknown>, scope?: "one" | "all") => {
    setFailed(null);
    try {
      await work();
      if (scope) onForgotten?.(scope);
    } catch {
      setFailed(t("guide.memory.failed"));
    }
  };

  return (
    <UtilityPage testId="memory-panel">
      <p className="g-prose text-[var(--g-ink-soft)]">{t("guide.memory.intro")}</p>
      <SettingSwitch
        label={t("guide.memory.switch")}
        hint={enabled ? t("guide.memory.onHint") : t("guide.memory.offHint")}
        checked={enabled}
        disabled={!prefs || saving}
        onChange={memoryEnabled => void run(() => putPrefs({ memoryEnabled }).unwrap())}
        testId="memory-switch"
      />
      {failed && (
        <p className="font-secondary text-sm text-[var(--g-ink)]" role="status">
          {failed}
        </p>
      )}

      {isLoading ? (
        <ShelfLoading />
      ) : isError ? (
        <ShelfLoadFailed onRetry={() => void refetch()} />
      ) : !data?.length ? (
        <p className="g-caption" data-testid="memory-empty">
          {t("guide.memory.empty")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {data.map(memory => {
              const until = shortDate(memory.expiresAt, i18n.language);
              const kind = KNOWN_KINDS.includes(memory.kind)
                ? t(`guide.memory.kind.${memory.kind}`)
                : t("guide.memory.kind.other");
              return (
                <li
                  key={memory.id}
                  className="rounded-[10px] border border-[var(--g-line)] px-3 py-2"
                  data-testid="memory-item"
                >
                  <p className="g-label text-[var(--g-ink-faint)]">{kind}</p>
                  <p className="g-prose mt-1 text-[var(--g-ink)]">{memory.body}</p>
                  <MemorySources sources={memory.sources ?? []} language={i18n.language} />
                  <div className="mt-1 flex flex-wrap items-center gap-x-3">
                    {until && (
                      <span className="g-caption">{t("guide.memory.until", { date: until })}</span>
                    )}
                    <ConfirmRemove
                      label={t("guide.memory.forget")}
                      question={t("guide.memory.forgetQuestion")}
                      confirmLabel={t("guide.memory.forget")}
                      onConfirm={() =>
                        void run(() => forget({ memoryId: memory.id }).unwrap(), "one")
                      }
                      busy={forgetting}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[var(--g-line)] pt-3">
            <ConfirmRemove
              label={t("guide.memory.forgetAll")}
              question={t("guide.memory.forgetAllQuestion")}
              confirmLabel={t("guide.memory.forgetAllConfirm")}
              onConfirm={() => void run(() => forgetAll().unwrap(), "all")}
              busy={forgettingAll}
            />
          </div>
        </>
      )}
    </UtilityPage>
  );
};
