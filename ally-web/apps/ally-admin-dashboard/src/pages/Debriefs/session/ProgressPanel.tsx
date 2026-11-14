import React from "react";

import { Link } from "react-router-dom";

import { EmptyPanel } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import {
  DebriefProgressEvidence,
  DebriefProgressSkill,
  DebriefProgressTrend,
  DebriefProgressVeto,
  DebriefSessionProgress,
} from "@types";

import { codeWords } from "../consoleLabels";
import { TruncatedTitle } from "../consoleRows";
import { ConsoleTag, TagTone } from "../consoleUi";

const TREND_TONE: Record<DebriefProgressTrend, TagTone> = {
  more_consistent: "success",
  about_the_same: "neutral",
  worth_another_look: "warning",
  too_early: "neutral",
};

/** A foundational skill key ("empathy") in words; an unknown key falls back to words, never the code. */
export const progressSkillName = (key: string): string =>
  en.debriefs.session.progress.skillNames[key] ?? codeWords(key);

/** A hold-back as the plain sentence the console shows. */
export const heldBackSentence = (veto: DebriefProgressVeto["veto"]): string => {
  const p = en.debriefs.session.progress;
  return p.heldBack[veto] ?? p.heldBackOther;
};

const evidenceRun = (e: DebriefProgressEvidence) => e.run_id ?? e.runId ?? null;
const evidenceTurn = (e: DebriefProgressEvidence) => e.turn_index ?? e.turnIndex ?? null;

/**
 * One evidence link: a turn of this session scrolls the roleplay to it (like the "Read first"
 * jumps); a turn of an earlier session opens that session's page.
 */
const EvidenceLink: React.FC<{
  e: DebriefProgressEvidence;
  runId: string;
  onTurn: (turn: number) => void;
}> = ({ e, runId, onTurn }) => {
  const p = en.debriefs.session.progress;
  const run = evidenceRun(e);
  const turn = evidenceTurn(e);
  const here = !run || run === "this" || run === runId;
  if (here) {
    if (turn == null) return null;
    return (
      <button
        type="button"
        title={p.thisTurnHint}
        className="whitespace-nowrap text-primary-500 underline"
        data-testid="progress-turn-link"
        onClick={() => onTurn(turn)}
      >
        {p.thisTurn(turn)}
      </button>
    );
  }
  return (
    <Link
      to={ROUTES.DEBRIEF_SESSION(run)}
      title={p.pastRunHint}
      className="whitespace-nowrap text-primary-500 underline"
      data-testid="progress-run-link"
    >
      {p.pastRun(turn)}
    </Link>
  );
};

const Evidence: React.FC<{
  items: DebriefProgressEvidence[] | undefined;
  runId: string;
  onTurn: (turn: number) => void;
}> = ({ items, runId, onTurn }) => {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
      <span className="text-neutral-600">{en.debriefs.session.progress.evidence}</span>
      {items.map((e, i) => (
        <EvidenceLink key={i} e={e} runId={runId} onTurn={onTurn} />
      ))}
    </div>
  );
};

const SkillBlock: React.FC<{
  skill: DebriefProgressSkill;
  vetoes: DebriefProgressVeto[];
  runId: string;
  onTurn: (turn: number) => void;
}> = ({ skill, vetoes, runId, onTurn }) => {
  const p = en.debriefs.session.progress;
  const name = progressSkillName(skill.skill);
  const line = skill.learnerLine?.trim();
  return (
    <div
      className="flex flex-col gap-2 rounded-sm bg-neutral-50 px-5 py-4"
      data-testid="progress-skill"
      data-skill={skill.skill}
    >
      {/* One row: the skill truncates, the trend word never wraps. */}
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        <TruncatedTitle text={name} className="text-[15px] font-semibold" />
        <ConsoleTag tone={TREND_TONE[skill.trend] ?? "neutral"} testId="progress-trend">
          {p.trend[skill.trend] ?? codeWords(skill.trend)}
        </ConsoleTag>
      </div>
      {skill.why && (
        <p className="m-0 text-sm leading-relaxed text-neutral-700">
          <span className="text-neutral-600">{p.why}</span> {skill.why}
        </p>
      )}
      <Evidence items={skill.evidence} runId={runId} onTurn={onTurn} />
      {skill.fhs && (
        <div className="text-[13px] text-neutral-700" data-testid="progress-cross-check">
          <span className="text-neutral-600">{p.crossCheck}</span>{" "}
          {p.crossCheckValue[skill.fhs] ?? p.crossCheckValue.absent}
        </div>
      )}
      {vetoes.map((v, i) => (
        <p
          key={i}
          className="m-0 text-[13px] text-[#8A3800]"
          data-testid="progress-held-back"
          title={v.detail ?? undefined}
        >
          {heldBackSentence(v.veto)}
        </p>
      ))}
      <div className="text-[13px]" data-testid="progress-learner-saw">
        {line && !skill.hiddenFromLearner ? (
          <>
            <span className="text-neutral-600">{p.learnerSaw}</span> “{line}”
          </>
        ) : (
          <span className="text-neutral-600">
            {skill.hiddenFromLearner && skill.trend === "worth_another_look"
              ? p.hiddenWorse
              : p.notShown}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * The Progress tab of a session (PROGRESS_CONTRACT §4): per skill the trend, why, evidence, the
 * Foundational Skills cross-check, what the learner saw and anything the code held back; then the
 * follow-ups on earlier points and the focus for next time.
 */
export const ProgressPanel: React.FC<{
  progress: DebriefSessionProgress | null | undefined;
  runId: string;
  /** Earlier debriefed sessions, when known: says why there is no reading. */
  pastSessions?: number | null;
  onTurn: (turn: number) => void;
}> = ({ progress, runId, pastSessions, onTurn }) => {
  const p = en.debriefs.session.progress;
  if (!progress) {
    return (
      <div data-testid="session-progress-empty">
        <EmptyPanel title={p.none} message={pastSessions === 0 ? p.noneFirst : p.noneHelp} />
      </div>
    );
  }
  const vetoesFor = (skill: string) => progress.vetoes.filter(v => v.skill === skill);
  // A held-back skill the agent dropped from the list still shows, so nothing is silently lost.
  const listed = new Set(progress.skills.map(s => s.skill));
  const unlisted = progress.vetoes.filter(v => !listed.has(v.skill));
  const focusLine = progress.focus?.learnerLine ?? progress.focus?.learner_line ?? null;
  const focusPractise = progress.focus?.practiseNext ?? progress.focus?.practise_next ?? false;
  return (
    <div className="flex flex-col gap-3" data-testid="session-progress">
      <div className="flex flex-col gap-1 text-[13px] text-neutral-700">
        <span>{p.intro(progress.sessions)}</span>
        {progress.shownAs && p.shownAs[progress.shownAs] && (
          <span data-testid="progress-shown-as">{p.shownAs[progress.shownAs]}</span>
        )}
      </div>

      <h3 className="m-0 text-xs tracking-[.32px] text-neutral-600">{p.skills}</h3>
      {progress.skills.length === 0 && unlisted.length === 0 && (
        <p className="m-0 text-sm text-neutral-600">{p.noSkills}</p>
      )}
      {progress.skills.map(skill => (
        <SkillBlock
          key={skill.skill}
          skill={skill}
          vetoes={vetoesFor(skill.skill)}
          runId={runId}
          onTurn={onTurn}
        />
      ))}
      {unlisted.map((v, i) => (
        <div
          key={`${v.skill}-${i}`}
          className="flex flex-col gap-1 rounded-sm bg-neutral-50 px-5 py-3"
          data-testid="progress-skill"
          data-skill={v.skill}
        >
          <TruncatedTitle text={progressSkillName(v.skill)} className="text-[15px] font-semibold" />
          <p
            className="m-0 text-[13px] text-[#8A3800]"
            data-testid="progress-held-back"
            title={v.detail ?? undefined}
          >
            {heldBackSentence(v.veto)}
          </p>
        </div>
      ))}

      <h3 className="m-0 mt-2 text-xs tracking-[.32px] text-neutral-600">{p.followups}</h3>
      {progress.followups.length === 0 ? (
        <p className="m-0 text-sm text-neutral-600">{p.noFollowups}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="progress-followups">
          {progress.followups.map((f, i) => (
            <li
              key={i}
              className="flex flex-col gap-1 rounded-sm bg-neutral-50 px-5 py-3 text-sm"
              data-testid="progress-followup"
            >
              <div className="flex min-w-0 flex-nowrap items-start gap-2">
                <span className="min-w-0 flex-1">{f.point}</span>
                <ConsoleTag
                  tone={
                    f.status === "done" ? "success" : f.status === "partly" ? "info" : "warning"
                  }
                >
                  {p.followupStatus[f.status] ?? codeWords(f.status)}
                </ConsoleTag>
              </div>
              <Evidence items={f.evidence} runId={runId} onTurn={onTurn} />
            </li>
          ))}
        </ul>
      )}

      {progress.focus && (
        <>
          <h3 className="m-0 mt-2 text-xs tracking-[.32px] text-neutral-600">{p.focus}</h3>
          <div
            className="flex flex-col gap-1.5 rounded-sm bg-neutral-50 px-5 py-4 text-sm"
            data-testid="progress-focus"
          >
            <div className="flex min-w-0 flex-nowrap items-center gap-2">
              <TruncatedTitle
                text={progressSkillName(progress.focus.skill)}
                className="text-[15px] font-semibold"
              />
              {focusPractise && <ConsoleTag tone="info">{p.practiseNext}</ConsoleTag>}
            </div>
            {progress.focus.why && (
              <p className="m-0 leading-relaxed text-neutral-700">
                <span className="text-neutral-600">{p.why}</span> {progress.focus.why}
              </p>
            )}
            <div className="text-[13px]">
              {focusLine?.trim() ? (
                <>
                  <span className="text-neutral-600">{p.learnerSaw}</span> “{focusLine.trim()}”
                </>
              ) : (
                <span className="text-neutral-600">{p.notShown}</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
