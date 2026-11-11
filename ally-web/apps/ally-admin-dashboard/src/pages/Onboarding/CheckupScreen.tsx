import React, { useEffect, useRef, useState } from "react";

import {
  useAnswerGapMutation,
  useGetBotPageQuery,
  useGetChatbotQuery,
  useLazyGetCheckupRunQuery,
  useMarkNotOfferedMutation,
  useRunDraftCheckupMutation,
} from "@api";
import { Button, CheckRow, GapCard, PrimaryButton, Question } from "@components/v2";

import { COPY, fill } from "./copy";
import { accuracyPct, gapsOf, hasTotals, statusOf } from "../AssistantHome/checkup";
import { TryIt } from "../AssistantHome/TryIt";

import type { BotDraftView } from "./types";
import type { CheckupRunView } from "../../types/checkup";

const t = COPY.checkup;
const POLL_MS = 1500;
const runKey = (draftId: string) => `ally.onboarding.${draftId}.checkupRun`;

const storedRun = (draftId: string): string | null => {
  try {
    return window.localStorage.getItem(runKey(draftId));
  } catch {
    return null;
  }
};

/**
 * The checkup in onboarding (chunk 20a-2, screenshots 01-14 and 01-15): the assistant just built is
 * asked its checkup questions, and the rows fill in as they're graded. Gaps can be answered here,
 * one at a time; "Try it yourself" opens the phone; Skip or Continue goes on to Share. Publishing
 * is gated by ally-be on this run (no unsourced answer, every safety question passed).
 */
export const CheckupScreen: React.FC<{ view: BotDraftView; onContinue: () => void }> = ({
  view,
  onContinue,
}) => {
  const chatbotId = view.chatbotId ?? "";
  const [start, startState] = useRunDraftCheckupMutation();
  const [loadRun] = useLazyGetCheckupRunQuery();
  const [answer, answerState] = useAnswerGapMutation();
  const [notOffered, notOfferedState] = useMarkNotOfferedMutation();
  const bot = useGetChatbotQuery(chatbotId, { skip: !chatbotId });
  const page = useGetBotPageQuery(chatbotId, { skip: !chatbotId });
  const [runId, setRunId] = useState<string | null>(() => storedRun(view.id));
  const [result, setResult] = useState<CheckupRunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [gapIndex, setGapIndex] = useState(0);
  const [trying, setTrying] = useState(false);
  const started = useRef(false);

  // Start once per draft; a reload picks the same run up again.
  useEffect(() => {
    if (runId || started.current || !chatbotId) return;
    started.current = true;
    void start(view.id)
      .unwrap()
      .then(({ run }) => {
        try {
          window.localStorage.setItem(runKey(view.id), run.id);
        } catch {
          // Private mode: the run still shows; a reload starts another.
        }
        setRunId(run.id);
      })
      .catch((err: { status?: number }) =>
        setError(err?.status === 429 ? t.blocked.limit : t.blocked.start),
      );
  }, [runId, chatbotId, start, view.id]);

  useEffect(() => {
    if (!runId || !chatbotId) return undefined;
    let stop = false;
    const tick = async () => {
      const next = await loadRun({ id: chatbotId, runId })
        .unwrap()
        .catch(() => null);
      if (stop) return;
      if (next) setResult(next);
      if (!next || next.run.status === "running") setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [runId, chatbotId, loadRun]);

  const running = !result || result.run.status === "running";
  const gaps = gapsOf(result);
  const gap = gaps[Math.min(gapIndex, Math.max(gaps.length - 1, 0))];
  const totals = hasTotals(result) ? result.totals : null;

  if (trying && bot.data) {
    return (
      <div className="ally-screen" data-testid="checkup-try">
        <TryIt bot={bot.data} page={page.data ?? null} onClose={() => setTrying(false)} />
      </div>
    );
  }

  if (answering && gap) {
    return (
      <div className="ally-screen" data-testid="checkup-gaps">
        <GapCard
          key={gap.caseId}
          said={gap.reply}
          busy={answerState.isLoading || notOfferedState.isLoading}
          labels={{
            prompt: fill(t.gapPrompt, { question: gap.question }),
            said: t.gapSaid,
            answer: t.gapAnswer,
            placeholder: t.gapPlaceholder,
            add: t.gapAdd,
            notOffered: t.gapNotOffered,
            counter: fill(t.gapCounter, { n: gapIndex + 1, total: gaps.length }),
          }}
          onAdd={async text => {
            const ok = !("error" in (await answer({ id: chatbotId, caseId: gap.caseId, text })));
            if (ok) next();
            return ok;
          }}
          onNotOffered={async () => {
            const ok = !("error" in (await notOffered({ id: chatbotId, caseId: gap.caseId })));
            if (ok) next();
            return ok;
          }}
        />
      </div>
    );
  }

  function next() {
    if (gapIndex + 1 < gaps.length) setGapIndex(i => i + 1);
    else setAnswering(false);
  }

  return (
    <div className="ally-screen" data-testid="checkup-screen">
      <Question
        eyebrow={t.eyebrow}
        title={
          running || !totals
            ? fill(t.running, {
                n: Math.min((result?.run.done ?? 0) + 1, result?.run.total ?? 1),
                total: result?.run.total ?? "…",
              })
            : totals.gaps
              ? fill(t.titleGaps, {
                  passed: totals.accuracy.passed,
                  total: totals.accuracy.total,
                  gaps: totals.gaps,
                })
              : fill(t.titleClear, {
                  passed: totals.accuracy.passed,
                  total: totals.accuracy.total,
                })
        }
      />
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
      {totals && (
        <div className="ally-checkup__tiles" data-testid="checkup-tiles">
          <div className="ally-card">
            <strong>{accuracyPct(totals)}%</strong>
            <span>{t.tiles.accuracy}</span>
          </div>
          <div className="ally-card">
            <strong>
              {totals.safety.passed}/{totals.safety.total}
            </strong>
            <span>{t.tiles.safety}</span>
          </div>
          <div className="ally-card">
            <strong>
              {totals.sources.total
                ? Math.round((totals.sources.passed / totals.sources.total) * 100)
                : 100}
              %
            </strong>
            <span>{t.tiles.sources}</span>
          </div>
        </div>
      )}
      <ul className="ally-checks" aria-live="polite" data-testid="checkup-rows">
        {(result?.results ?? []).map((row, index) => (
          <CheckRow
            key={row.caseId}
            index={index}
            question={row.question}
            status={statusOf(row)}
            labels={t.rows}
          />
        ))}
      </ul>
      {totals && !gaps.length && <p className="ally-body">{t.allClear}</p>}
      <div className="ally-btn-row">
        {totals && gaps.length > 0 ? (
          <PrimaryButton onClick={() => setAnswering(true)}>
            {gaps.length === 1 ? t.answerOne : fill(t.answerN, { n: gaps.length })}
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={onContinue} disabled={running && !error}>
            {COPY.make.continue}
          </PrimaryButton>
        )}
        <Button onClick={() => setTrying(true)} disabled={!bot.data || startState.isLoading}>
          {t.tryIt}
        </Button>
        {totals && gaps.length > 0 && (
          <Button variant="ghost" onClick={onContinue}>
            {t.skip}
          </Button>
        )}
      </div>
    </div>
  );
};
