import { Injectable } from '@nestjs/common';
import type { CoursePilotAnalysisRecord } from './course-pilot-analyst.service';
import {
  CoursePilotPublishRecord,
  publishQualityChecks,
} from '../util/course-pilot-publish.util';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
  CourseCopilotSessionStatus,
} from '../enum/course-copilot.enum';
import {
  CourseCopilotJobRepository,
  CourseCopilotMessageRepository,
} from '../repository/course-copilot.repository';
import { CourseBlueprint, CourseBrief } from '../type/course-copilot.type';
import { validateBlueprint } from '../util/course-blueprint.util';
import {
  lengthBounds,
  lengthProblems,
  realisticMinutes,
} from '../util/course-pilot-length.util';
import {
  briefHash,
  COURSE_PILOT_STAGES,
  CoursePilotStageId,
  CoursePilotState,
  resolveCoursePilotStage,
} from '../util/course-pilot-stages.util';
import { transferProblems } from '../util/course-pilot-transfer.util';
import { AppConfigService } from 'src/config/config.service';

/**
 * The Stages tab (platform admins): every stage of a Course Pilot session — the interview
 * stages, the plan, the build and the course — with what happens there, what code checked, and
 * why it passed or failed. Read-only and computed on request from what the session already
 * keeps (metadata.coursePilot, the transcript's per-turn records, the build jobs); the checks
 * are the same functions the pipeline runs, so the tab cannot disagree with the pipeline.
 */

export type StageStatus =
  | 'passed'
  | 'warning'
  | 'failed'
  | 'current'
  | 'not_reached';

export interface StageCheck {
  label: string;
  result: 'pass' | 'fail' | 'warn' | 'info';
  detail?: string;
}

export interface StageEvent {
  at: string;
  kind: 'question' | 'confirm' | 'sent_back' | 'refused' | 'job';
  text: string;
}

/** A sub-agent that worked in a stage, and what it did there. */
export interface StageAgent {
  name: string;
  /** What it does, one line. */
  role: string;
  state: 'ran' | 'running' | 'off' | 'not_run';
  /** What it did in this session ("3 cited points", "repair kept"). */
  detail?: string;
}

export interface CoursePilotStageRow {
  id: string;
  title: string;
  group: 'interview' | 'plan' | 'build' | 'course' | 'publish' | 'improve';
  status: StageStatus;
  /** One line: why this stage passed, failed or is waiting. */
  why: string;
  /** What happens in this stage. */
  what: string;
  enteredAt: string | null;
  leftAt: string | null;
  questions?: { asked: number; limit: number };
  checks: StageCheck[];
  /** The sub-agents that work in this stage. */
  agents: StageAgent[];
  research?: {
    question: string;
    summary: string;
    points: { text: string; sources: string[] }[];
    gaps: string[];
  } | null;
  /** Research for this stage: 'none' = it reads nothing; 'not_run' = never entered. */
  researchState?: 'found' | 'nothing_found' | 'not_run' | 'none';
  events: StageEvent[];
}

export interface CoursePilotStagesReport {
  /** Whether the stage machine ran for this session (COURSE_PILOT_STAGES). */
  staged: boolean;
  sessionStatus: CourseCopilotSessionStatus;
  stages: CoursePilotStageRow[];
}

/** Why a reply was sent back to the agent, by the problem's key. */
export const SENT_BACK_LABELS: Record<string, string> = {
  brief_path_in_reply:
    'Reply showed an internal field name or claimed an empty field was saved',
  choice_only: 'Question asked for typed text where only choices are allowed',
  claims_brief_ready: 'Reply said the brief was ready when it was not',
  claims_build_started: 'Reply said the build had started when it had not',
  claims_change: 'Reply claimed a change that was not made',
  empty_message: 'Reply was empty',
  empty_prompt: 'Question had no text',
  no_recommendation: 'Question had no recommended option',
  not_offered: 'Reply used a tool that was not on this stage',
  promised_question_without_card:
    'Reply promised a question but showed no card',
  question_too_long: 'Question was too long',
  reply_too_long: 'Reply was too long',
  too_many_options: 'Question had too many options',
  unapplied_message: 'Reply ignored what the trainer said',
  title: 'Course title problem',
  description: 'Course description problem',
  cover: 'Cover problem',
  sections: 'Sections problem',
  references: 'References problem',
};

const STAGE_WHAT: Record<CoursePilotStageId, string> = {
  intake:
    'Records what the trainer wants and everything they have already said (length, language, ' +
    'ending); reads their files and similar example courses.',
  'brief.learners':
    'Who the learners are and which learner profile fits them; reads learner profiles.',
  'brief.outcomes':
    'The end-of-course outcome, competencies and skill targets (A = how well, B = how widely).',
  'brief.assessment':
    'How learners show the skill at the end (roleplay, quiz, annotated artifact or journal) and ' +
    'the pass mark.',
  'brief.constraints': 'Time, language and the shape of the course.',
  'brief.final':
    'The trainer sees the whole brief on one card and confirms it; any later change re-opens it.',
  blueprint:
    'The planner drafts the course from the confirmed brief. Code checks it (limits, skill-target ' +
    'practice, length) and sends it back once to repair; the critic reviews it when switched on.',
};

const KNOWLEDGE_NAMES: Record<string, string> = {
  sources: "the trainer's files",
  learning_design: 'Learning Design principles',
  learner_profiles: 'learner profiles',
  example_courses: 'example courses',
  learner_results: 'learner results',
};

/** Build job kinds, by the sub-agent that does them. */
const JOB_AGENTS: Record<string, { name: string; role: string }> = {
  article: {
    name: 'Article writer',
    role: 'Writes each article and its checks',
  },
  quiz: { name: 'Quiz writer', role: 'Writes each quiz' },
  journal: { name: 'Journal writer', role: 'Writes reflection prompts' },
  annotated_artifact: {
    name: 'Annotated transcript writer',
    role: 'Writes a transcript to mark up',
  },
  branching_scenario: {
    name: 'Scenario quiz writer',
    role: 'Writes branching scenarios',
  },
  bucket_sort: { name: 'Bucket sort writer', role: 'Writes sorting exercises' },
  roleplay_new: {
    name: 'Roleplay writer',
    role: 'Writes new roleplays and their characters',
  },
  case_new: { name: 'Case writer', role: 'Writes new cases' },
  cover_image: {
    name: 'Image maker',
    role: 'Makes the cover and article images',
  },
  article_image: {
    name: 'Image maker',
    role: 'Makes the cover and article images',
  },
  course_meta: {
    name: 'Course title and description',
    role: 'Polishes the title and description',
  },
  course_review: {
    name: 'Reviewer',
    role: 'Reads the whole course and leaves notes',
  },
};

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

@Injectable()
export class CoursePilotStagesReportService {
  constructor(
    private readonly messages: CourseCopilotMessageRepository,
    private readonly jobs: CourseCopilotJobRepository,
    private readonly config: AppConfigService,
  ) {}

  async report(
    session: CourseCopilotSession,
  ): Promise<CoursePilotStagesReport> {
    const [messages, jobs] = await Promise.all([
      this.messages.find({
        where: { sessionId: session.id },
        order: { seq: 'ASC' },
      }),
      this.jobs.find({
        where: { sessionId: session.id },
        order: { createdAt: 'ASC' },
      }),
    ]);
    return buildStagesReport({
      session,
      messages: messages.map((m) => ({
        role: String(m.role),
        seq: Number((m as any).seq ?? 0),
        createdAt: m.createdAt,
        metadata: (m as any).metadata ?? null,
      })),
      jobs: jobs.map((j) => ({
        kind: j.kind,
        status: j.status,
        title: j.input?.item?.title ?? null,
        error: j.error ?? null,
        summary: j.result?.summary ?? null,
        reviewFixes: Array.isArray((j.result as any)?.findings)
          ? (j.result as any).findings.filter((f: any) => f?.severity === 'fix')
              .length
          : undefined,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt ?? null,
      })),
      stagesSwitch: Boolean(this.config.courseCopilot?.stages),
    });
  }
}

export interface ReportMessage {
  role: string;
  /** Message order; absent in old fixtures. */
  seq?: number;
  createdAt: Date;
  metadata: Record<string, any> | null;
}

export interface ReportJob {
  kind: CourseCopilotJobKind | string;
  status: CourseCopilotJobStatus | string;
  title: string | null;
  error: string | null;
  summary: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  /** Reviewer findings marked "fix" (course_review jobs). */
  reviewFixes?: number;
}

/** Pure: the whole report from what the session keeps. */
export function buildStagesReport(input: {
  session: CourseCopilotSession;
  messages: ReportMessage[];
  jobs: ReportJob[];
  stagesSwitch: boolean;
}): CoursePilotStagesReport {
  const { session, messages, jobs } = input;
  const brief: CourseBrief = session.brief ?? {};
  const state: CoursePilotState = (session.metadata as any)?.coursePilot ?? {};
  const staged = input.stagesSwitch || Boolean(state.history?.length);
  const status = session.status as CourseCopilotSessionStatus;
  const blueprint = (session.blueprint as CourseBlueprint | null) ?? null;
  const pastInterview = status !== CourseCopilotSessionStatus.INTERVIEWING;

  // When each stage was entered and left, from the stage history (newest last).
  const history = state.history ?? [];
  const firstJobAt = jobs.length ? iso(jobs[0].createdAt) : null;
  const windowOf = (id: string) => {
    const index = history.findIndex((h) => h.stage === id);
    if (index < 0) return { enteredAt: null, leftAt: null };
    const next = history.slice(index + 1).find((h) => h.stage !== id);
    return {
      enteredAt: history[index].at,
      leftAt: next?.at ?? (id === 'blueprint' ? firstJobAt : null),
    };
  };
  const placed = stageEvents(messages, history, firstJobAt);
  const eventsFor = (id: string) => placed.get(id) ?? [];

  // The plan stage starts when the planner ran, if the history has no entry for it.
  const plannerAt: string | null = (state as any).planner?.at ?? null;
  const planWindow = windowOf('blueprint');
  if (!planWindow.enteredAt && plannerAt) planWindow.enteredAt = plannerAt;
  if (!planWindow.leftAt) planWindow.leftAt = firstJobAt;

  const position = resolveCoursePilotStage(brief, state);
  const currentIndex = COURSE_PILOT_STAGES.findIndex(
    (s) => s.id === position.stage.id,
  );

  const rows: CoursePilotStageRow[] = [];
  COURSE_PILOT_STAGES.forEach((stage, index) => {
    if (stage.id === 'blueprint') return;
    const missing = stage.exit(brief, state);
    const asked = state.questions?.[stage.id] ?? 0;
    const window = windowOf(stage.id);
    // The final check ends when the plan starts.
    if (stage.id === 'brief.final' && !window.leftAt && !missing.length) {
      window.leftAt = planWindow.enteredAt;
    }
    const checks: StageCheck[] = missing.length
      ? missing.map((m) => ({
          label: `Missing: ${m}`,
          result: 'fail' as const,
        }))
      : [
          {
            label:
              stage.id === 'brief.final'
                ? 'Trainer confirmed this exact brief'
                : 'Everything this stage needs is in the brief',
            result: 'pass' as const,
          },
        ];
    checks.push({
      label: `Questions: ${asked} of ${stage.questions}`,
      result: asked >= stage.questions && stage.questions > 0 ? 'warn' : 'info',
      detail:
        asked >= stage.questions && stage.questions > 0
          ? 'Limit reached: further questions in this stage are refused.'
          : undefined,
    });
    if (stage.id === 'brief.final') {
      checks.push(...confirmChecks(brief, state));
    }

    const research = state.research?.[stage.id];
    const researchState: CoursePilotStageRow['researchState'] = !stage.knowledge
      .length
      ? 'none'
      : research
        ? 'found'
        : stage.id in (state.research ?? {})
          ? 'nothing_found'
          : 'not_run';

    let rowStatus: StageStatus;
    let why: string;
    if (!missing.length) {
      rowStatus = 'passed';
      why = window.enteredAt
        ? asked
          ? `Passed after ${asked} question${asked === 1 ? '' : 's'}.`
          : 'Passed without a question: what the trainer had said covered it.'
        : 'Passed without a question: what the trainer had said covered it.';
      if (stage.id === 'brief.final') why = 'The trainer confirmed the brief.';
    } else if (index === currentIndex && !pastInterview) {
      rowStatus = 'current';
      why = `Waiting for: ${missing.join('; ')}.`;
    } else if (index === currentIndex) {
      rowStatus = 'failed';
      why = `The session moved on with this still missing: ${missing.join('; ')}.`;
    } else {
      rowStatus = 'not_reached';
      why = 'Not reached yet.';
    }

    const agents: StageAgent[] = [
      {
        name: 'Interviewer',
        role:
          stage.id === 'brief.final'
            ? 'Shows the whole brief on one confirm card'
            : 'Asks the trainer and records the answers in the brief',
        state:
          rowStatus === 'not_reached'
            ? 'not_run'
            : rowStatus === 'current'
              ? 'running'
              : 'ran',
        detail: `${asked} question${asked === 1 ? '' : 's'}`,
      },
    ];
    if (stage.knowledge.length) {
      agents.push({
        name: 'Researcher',
        role: `Reads ${stage.knowledge.map((k) => KNOWLEDGE_NAMES[k] ?? k).join(', ')} and gives cited points`,
        state: researchState === 'not_run' ? 'not_run' : 'ran',
        detail:
          researchState === 'found'
            ? `${research?.points.length ?? 0} cited point${research?.points.length === 1 ? '' : 's'}`
            : researchState === 'nothing_found'
              ? 'Nothing relevant found'
              : 'Not run (stage reached before the Researcher existed, or not entered)',
      });
    }

    rows.push({
      id: stage.id,
      title: stage.title,
      group: 'interview',
      agents,
      status: rowStatus,
      why,
      what: STAGE_WHAT[stage.id],
      ...window,
      questions: { asked, limit: stage.questions },
      checks,
      research: research
        ? {
            question: research.question,
            summary: research.summary,
            points: research.points,
            gaps: research.gaps,
          }
        : null,
      researchState,
      events: eventsFor(stage.id),
    });
  });

  const plan = planRow(
    session,
    state,
    blueprint,
    brief,
    planWindow,
    eventsFor('blueprint'),
  );
  rows.push({ ...plan, agents: planAgents(state, plan.status) });
  const build = buildRow(jobs, status);
  rows.push({ ...build, agents: buildAgents(jobs) });
  const course = courseRow(session, status, messages, eventsFor('course'));
  rows.push({
    ...course,
    agents:
      course.status === 'not_reached'
        ? []
        : [
            {
              name: 'Interviewer',
              role: "Changes the course on the trainer's request",
              state: 'ran',
              detail: `${messages.filter((m) => m.metadata?.coursePatches?.length).length} change(s)`,
            },
          ],
  });
  rows.push(publishRow(session, state, jobs));
  rows.push(improveRow(state, messages));
  return { staged, sessionStatus: status, stages: rows };
}

/**
 * Improve: the Analyst's last read of how learners did (code's signals, the model's suggestions)
 * and how many changes the trainer made after it.
 */
function improveRow(
  state: CoursePilotState,
  messages: ReportMessage[],
): CoursePilotStageRow {
  const analysis = (state as any).analysis as
    | CoursePilotAnalysisRecord
    | undefined;
  const base = {
    id: 'improve',
    title: 'Improve',
    group: 'improve' as const,
    what: 'Once learners have taken the course, code measures it in group numbers (who finished, where they stop, attempts, quiz questions most get wrong first time; never one learner) and raises signals; the Analyst explains them and suggests edits; the trainer picks and the copilot applies them.',
    enteredAt: analysis?.at ?? null,
    leftAt: null,
    events: [] as StageEvent[],
  };
  const analystRole =
    'Explains the signals code found and suggests edits; sees group numbers only';
  if (!analysis) {
    return {
      ...base,
      status: 'not_reached',
      why: 'Not run yet: ask the copilot how the course is going.',
      checks: [],
      agents: [{ name: 'Analyst', role: analystRole, state: 'not_run' }],
    };
  }
  const edits = messages.filter(
    (m) =>
      (m.seq ?? 0) > analysis.afterSeq && m.metadata?.coursePatches?.length,
  ).length;
  const checks: StageCheck[] = [
    {
      label: `${analysis.learners} learner${analysis.learners === 1 ? '' : 's'} enrolled, ${analysis.finished} finished`,
      result: analysis.enough ? 'info' : 'warn',
      detail: analysis.enough ? undefined : analysis.summary,
    },
    ...analysis.signals.map((signal) => ({
      label: signal.text,
      result: 'warn' as const,
    })),
    ...analysis.suggestions.map((suggestion) => ({
      label: `Suggested (${suggestion.kind}): ${suggestion.change}`,
      result: 'info' as const,
      detail: suggestion.cause || undefined,
    })),
  ];
  if (analysis.error) {
    checks.push({
      label: 'Analyst failed; the signals still stand',
      result: 'warn',
      detail: analysis.error,
    });
  }
  return {
    ...base,
    status: !analysis.enough
      ? 'not_reached'
      : edits
        ? 'passed'
        : analysis.signals.length
          ? 'current'
          : 'passed',
    why: !analysis.enough
      ? analysis.summary
      : edits
        ? `${edits} change${edits === 1 ? '' : 's'} made after the analysis.`
        : analysis.signals.length
          ? `${analysis.signals.length} signal${analysis.signals.length === 1 ? '' : 's'}, ${analysis.suggestions.length} suggestion${analysis.suggestions.length === 1 ? '' : 's'}; nothing changed yet.`
          : analysis.summary,
    checks,
    agents: [
      {
        name: 'Analyst',
        role: analystRole,
        state: !analysis.enough
          ? 'not_run'
          : analysis.suggestions.length || analysis.error
            ? 'ran'
            : 'not_run',
        detail: !analysis.enough
          ? 'not enough learners'
          : analysis.suggestions.length
            ? `${analysis.suggestions.length} suggestion(s)`
            : analysis.signals.length
              ? undefined
              : 'nothing to explain',
      },
    ],
  };
}

/**
 * Publish: the structural readiness checks (blocking) and what the build left unresolved
 * (warnings), from the last publish attempt; before one, the warnings as they stand now.
 */
function publishRow(
  session: CourseCopilotSession,
  state: CoursePilotState,
  jobs: ReportJob[],
): CoursePilotStageRow {
  const record = (state as any).publish as CoursePilotPublishRecord | undefined;
  const built = (session.metadata as any)?.buildCompletedAt ?? null;
  const base = {
    id: 'publish',
    title: 'Publish',
    group: 'publish' as const,
    what: 'Code checks the course can go live (title, description, cover, sections, published roleplays), then lists what the build left unresolved. The trainer confirms; warnings never block.',
    enteredAt: record?.at ?? null,
    leftAt: record?.published ? record.at : null,
    events: [] as StageEvent[],
  };
  const agent = (state: StageAgent['state'], detail?: string): StageAgent[] => [
    {
      name: 'Publish check',
      role: 'Code, not a model: readiness plus failed items, disputed answer keys, reviewer fixes and critic leftovers',
      state,
      ...(detail ? { detail } : {}),
    },
  ];
  if (!built && !record) {
    return {
      ...base,
      status: 'not_reached',
      why: 'Not reached yet.',
      checks: [],
      agents: agent('not_run'),
    };
  }
  const checks: StageCheck[] = record
    ? record.checks
    : publishQualityChecks({
        jobs: jobs.map((j) => ({
          kind: String(j.kind),
          status: String(j.status),
          title: j.title,
          summary: j.summary,
          reviewFixes: j.reviewFixes,
        })),
        critic: (state as any).critic ?? null,
      });
  const warnings = checks.filter((c) => c.result !== 'pass').length;
  if (record?.published) {
    return {
      ...base,
      status: warnings ? 'warning' : 'passed',
      why: warnings
        ? `Published with ${warnings} warning${warnings === 1 ? '' : 's'} on the card.`
        : 'Published; nothing was left unresolved.',
      checks,
      agents: agent('ran'),
    };
  }
  if (record && !record.ready) {
    return {
      ...base,
      status: 'failed',
      why: `Publishing was refused: ${checks.map((c) => c.label).join('; ')}.`,
      checks,
      agents: agent('ran', 'readiness failed'),
    };
  }
  return {
    ...base,
    status: 'current',
    why: record
      ? 'The publish card is waiting for the trainer.'
      : warnings
        ? `Not published yet; ${warnings} thing${warnings === 1 ? '' : 's'} to look at first.`
        : 'Not published yet; nothing unresolved.',
    checks,
    agents: agent(record ? 'running' : 'not_run'),
  };
}

function confirmChecks(
  brief: CourseBrief,
  state: CoursePilotState,
): StageCheck[] {
  const hash = briefHash(brief);
  if (state.confirmedBriefHash && state.confirmedBriefHash === hash) return [];
  if (state.confirmedBriefHash) {
    return [
      {
        label: 'Brief changed after it was confirmed',
        result: 'warn',
        detail:
          'The confirmation no longer matches; the trainer must confirm again.',
      },
    ];
  }
  if (state.pendingConfirm) {
    return [
      {
        label: 'Confirm card shown',
        result: 'info',
        detail:
          state.pendingConfirm.briefHash === hash
            ? 'Waiting for the trainer to confirm.'
            : 'The brief changed after the card was shown; a new card is needed.',
      },
    ];
  }
  return [];
}

function planRow(
  session: CourseCopilotSession,
  state: CoursePilotState,
  blueprint: CourseBlueprint | null,
  brief: CourseBrief,
  window: { enteredAt: string | null; leftAt: string | null },
  events: StageEvent[],
): Omit<CoursePilotStageRow, 'agents'> {
  const base = {
    id: 'blueprint',
    title: 'Plan',
    group: 'plan' as const,
    what: STAGE_WHAT.blueprint,
    ...window,
    events,
  };
  if (!blueprint) {
    const waiting =
      session.status === CourseCopilotSessionStatus.AWAITING_BLUEPRINT;
    return {
      ...base,
      status: waiting ? 'current' : 'not_reached',
      why: waiting ? 'The plan is being drafted.' : 'Not reached yet.',
      checks: [],
    };
  }

  const checks: StageCheck[] = [];
  const structure = validateBlueprint(blueprint, brief);
  checks.push(
    ...(structure.length
      ? structure.map((p) => ({
          label: 'Structure',
          result: 'fail' as const,
          detail: p,
        }))
      : [{ label: 'Structure and limits', result: 'pass' as const }]),
  );
  const transfer = transferProblems(blueprint, brief);
  checks.push(
    ...(transfer.length
      ? transfer.map((p) => ({
          label: 'Skill-target practice (B2/B3)',
          result: 'warn' as const,
          detail: p,
        }))
      : [{ label: 'Skill-target practice (B2/B3)', result: 'pass' as const }]),
  );
  const target = Number(brief.shape?.durationMinutes);
  const minutes = realisticMinutes(blueprint);
  if (target > 0) {
    const { min, max } = lengthBounds(target);
    checks.push({
      label: `Length: about ${minutes} min for ${target} asked (allowed ${min}–${max})`,
      result: lengthProblems(blueprint, brief).length ? 'warn' : 'pass',
    });
  }

  const planner = (state as any).planner as
    | {
        firstProblems: string[];
        repairTried: boolean;
        repairKept: boolean;
        repairNote?: string;
        exampleCourse?: string | null;
        principles?: string[];
      }
    | undefined;
  if (planner) {
    checks.push({
      label: planner.firstProblems.length
        ? `First draft had ${planner.firstProblems.length} problem${planner.firstProblems.length === 1 ? '' : 's'}`
        : 'First draft passed the code checks',
      result: planner.firstProblems.length ? 'info' : 'pass',
      detail: planner.firstProblems.join(' · ') || undefined,
    });
    if (planner.repairTried) {
      checks.push({
        label: planner.repairKept ? 'Repair kept' : 'Repair not kept',
        result: planner.repairKept ? 'pass' : 'warn',
        detail: planner.repairNote,
      });
    }
    if (planner.exampleCourse || planner.principles?.length) {
      checks.push({
        label: 'Planned with',
        result: 'info',
        detail: [
          planner.exampleCourse
            ? `example course "${planner.exampleCourse}"`
            : '',
          planner.principles?.length
            ? `principles ${planner.principles.join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('; '),
      });
    }
  }

  const critic = (state as any).critic as
    | {
        found: { severity: string; problem?: string; criterion?: string }[];
        repaired: boolean;
        patch?: { mode: string; restored: number; changed: number };
        repairNote?: string;
        remaining: { severity: string; problem?: string }[];
      }
    | undefined;
  if (critic) {
    const blocking = critic.found.filter(
      (f) => f.severity === 'blocking',
    ).length;
    const left = critic.remaining.filter((f) => f.severity === 'blocking');
    checks.push({
      label: `Critic: ${critic.found.length} finding${critic.found.length === 1 ? '' : 's'}, ${blocking} blocking${critic.repaired ? ', repaired' : ''}`,
      result: left.length ? 'warn' : 'pass',
      detail:
        [
          critic.repairNote ? `Repair not kept: ${critic.repairNote}` : '',
          ...left.map((f) => f.problem ?? ''),
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    });
  } else {
    checks.push({
      label: 'Critic',
      result: 'info',
      detail: 'Switched off (COURSE_PILOT_CRITIC).',
    });
  }

  const failed = checks.some((c) => c.result === 'fail');
  const warned = checks.some((c) => c.result === 'warn');
  return {
    ...base,
    status: failed ? 'failed' : warned ? 'warning' : 'passed',
    why: failed
      ? 'The plan breaks a structure rule; the trainer must fix it before approving.'
      : warned
        ? 'The plan was made, but some checks did not pass (shown to the trainer, not blocking).'
        : 'The plan passed every code check.',
    checks,
  };
}

function buildRow(
  jobs: ReportJob[],
  status: CourseCopilotSessionStatus,
): Omit<CoursePilotStageRow, 'agents'> {
  const base = {
    id: 'build',
    title: 'Build',
    group: 'build' as const,
    what:
      'One job per item writes the content (articles, quizzes with the answer-key check, ' +
      'roleplays, images), then the reviewer reads the whole course.',
    enteredAt: jobs.length ? iso(jobs[0].createdAt) : null,
    leftAt: null as string | null,
  };
  if (!jobs.length) {
    return {
      ...base,
      status: 'not_reached',
      why: 'Not reached yet.',
      checks: [],
      events: [],
    };
  }
  const count = (s: string) => jobs.filter((j) => j.status === s).length;
  const failed = jobs.filter((j) => j.status === CourseCopilotJobStatus.FAILED);
  const running =
    count(CourseCopilotJobStatus.QUEUED) +
    count(CourseCopilotJobStatus.RUNNING);
  const done = count(CourseCopilotJobStatus.DONE);
  const disputed = jobs.filter((j) => /disputed/i.test(j.summary ?? ''));
  const name = (j: ReportJob) =>
    j.title ? `${j.title} (${j.kind})` : String(j.kind);

  const checks: StageCheck[] = [
    {
      label: `${done} of ${jobs.length} jobs done`,
      result: done === jobs.length ? 'pass' : 'info',
    },
    ...failed.map((j) => ({
      label: `Failed: ${name(j)}`,
      result: 'fail' as const,
      detail: j.error ?? undefined,
    })),
    ...jobs
      .filter((j) => j.status === CourseCopilotJobStatus.SKIPPED)
      .map((j) => ({ label: `Skipped: ${name(j)}`, result: 'warn' as const })),
    ...disputed.map((j) => ({
      label: `Answer-key check: ${name(j)}`,
      result: 'warn' as const,
      detail: j.summary ?? undefined,
    })),
  ];
  const finished = jobs.map((j) => j.finishedAt).filter(Boolean) as Date[];
  return {
    ...base,
    leftAt: running
      ? null
      : iso(new Date(Math.max(...finished.map((d) => +d), 0))),
    status: running
      ? 'current'
      : failed.length
        ? 'failed'
        : checks.some((c) => c.result === 'warn')
          ? 'warning'
          : 'passed',
    why: running
      ? `${running} job${running === 1 ? '' : 's'} still running.`
      : failed.length
        ? `${failed.length} job${failed.length === 1 ? '' : 's'} failed${status === CourseCopilotSessionStatus.BUILD_FAILED ? '; the build stopped' : ''}.`
        : 'Every item was written.',
    checks,
    events: jobs
      .filter((j) => j.status === CourseCopilotJobStatus.FAILED || j.summary)
      .map((j) => ({
        at: iso(j.finishedAt ?? j.createdAt)!,
        kind: 'job' as const,
        text: `${name(j)}: ${j.status === CourseCopilotJobStatus.FAILED ? (j.error ?? 'failed') : j.summary}`,
      })),
  };
}

function courseRow(
  session: CourseCopilotSession,
  status: CourseCopilotSessionStatus,
  messages: ReportMessage[],
  events: StageEvent[],
): Omit<CoursePilotStageRow, 'agents'> {
  const built = (session.metadata as any)?.buildCompletedAt ?? null;
  const edits = messages.filter(
    (m) => m.metadata?.coursePatches?.length,
  ).length;
  const editing = status === CourseCopilotSessionStatus.EDITING;
  return {
    id: 'course',
    title: 'Course',
    group: 'course',
    what: 'The course exists; the copilot changes it on request and the trainer publishes it.',
    enteredAt: built ? iso(built) : null,
    leftAt: null,
    status: editing || built ? (editing ? 'current' : 'passed') : 'not_reached',
    why: editing
      ? `Course written${edits ? `; ${edits} change${edits === 1 ? '' : 's'} made since` : ''}.`
      : built
        ? 'Course written.'
        : 'Not reached yet.',
    checks: [],
    events,
  };
}

/**
 * Each turn's questions, confirm cards, replies sent back and refused tool calls, placed in the
 * stage they belong to. A question card names its stage; anything else goes to the stage the
 * turn ended in. The stage history is written as a turn ends, just after the turn's last write,
 * so a turn's stage is read just before the next message starts (or now, for the last turn).
 */
export function stageEvents(
  messages: ReportMessage[],
  history: { stage: string; at: string }[],
  firstJobAt: string | null,
): Map<string, StageEvent[]> {
  const known = new Set<string>(COURSE_PILOT_STAGES.map((s) => s.id));
  const stageAt = (time: number): string => {
    if (firstJobAt && time >= +new Date(firstJobAt)) return 'course';
    let current = 'intake';
    for (const h of history) if (+new Date(h.at) <= time) current = h.stage;
    return current;
  };
  const out = new Map<string, StageEvent[]>();
  const add = (stage: string, event: StageEvent) =>
    out.set(stage, [...(out.get(stage) ?? []), event]);
  messages.forEach((m, index) => {
    if (m.role !== 'assistant' || !m.metadata) return;
    const when = new Date(m.createdAt).toISOString();
    // The row's own record wins; times are a fallback for turns saved before it existed (and
    // assume the server and database share a clock, as in production).
    const next = messages[index + 1];
    const turnStage =
      typeof m.metadata.pilotStage === 'string' && m.metadata.pilotStage
        ? m.metadata.pilotStage
        : stageAt(
            next ? +new Date(next.createdAt) - 1 : Number.MAX_SAFE_INTEGER,
          );
    for (const q of m.metadata.questions ?? []) {
      const confirm =
        Array.isArray(q?.options) &&
        q.options.some((o: any) => o?.id === 'confirm_brief');
      add(known.has(q?.stage) ? q.stage : confirm ? 'brief.final' : turnStage, {
        at: when,
        kind: confirm ? 'confirm' : 'question',
        text: String(q?.prompt ?? '').slice(0, 200),
      });
    }
    for (const key of m.metadata.sentBack ?? []) {
      add(turnStage, {
        at: when,
        kind: 'sent_back',
        text: SENT_BACK_LABELS[key] ?? key,
      });
    }
    for (const r of m.metadata.refused ?? []) {
      add(turnStage, {
        at: when,
        kind: 'refused',
        text: `${r.tool} refused (${r.error})${r.message ? `: ${r.message}` : ''}`,
      });
    }
  });
  return out;
}

function planAgents(
  state: CoursePilotState,
  status: StageStatus,
): StageAgent[] {
  const planner = (state as any).planner as
    | { firstProblems: string[]; repairTried: boolean; repairKept: boolean }
    | undefined;
  const critic = (state as any).critic as
    | {
        found: { severity: string }[];
        repaired: boolean;
        patch?: { mode: string; restored: number; changed: number };
      }
    | undefined;
  const reached = status !== 'not_reached';
  return [
    {
      name: 'Planner',
      role: 'Drafts the course from the confirmed brief; repairs it once if code finds problems',
      state: !reached ? 'not_run' : status === 'current' ? 'running' : 'ran',
      detail: planner
        ? planner.firstProblems.length
          ? `First draft: ${planner.firstProblems.length} problem(s); repair ${planner.repairKept ? 'kept' : planner.repairTried ? 'not kept' : 'not tried'}`
          : 'First draft passed the code checks'
        : reached
          ? 'Ran (details not recorded for this session)'
          : undefined,
    },
    {
      name: 'Critic',
      role: 'Reviews the plan against the brief and design principles',
      state: critic ? 'ran' : 'off',
      detail: critic
        ? `${critic.found.length} finding(s), ${critic.found.filter((f) => f.severity === 'blocking').length} blocking${critic.repaired ? ', repaired' : ''}${critic.patch?.mode === 'patch' ? ` (edited ${critic.patch.changed} item(s), kept ${critic.patch.restored} unflagged)` : ''}`
        : 'Switched off (COURSE_PILOT_CRITIC)',
    },
  ];
}

function buildAgents(jobs: ReportJob[]): StageAgent[] {
  const groups = new Map<string, { role: string; jobs: ReportJob[] }>();
  for (const job of jobs) {
    const agent = JOB_AGENTS[String(job.kind)];
    if (!agent) continue; // games, videos and library picks: no model call
    const entry = groups.get(agent.name) ?? { role: agent.role, jobs: [] };
    entry.jobs.push(job);
    groups.set(agent.name, entry);
  }
  const agents: StageAgent[] = [...groups.entries()].map(([name, entry]) => {
    const done = entry.jobs.filter(
      (j) => j.status === CourseCopilotJobStatus.DONE,
    ).length;
    const failed = entry.jobs.filter(
      (j) => j.status === CourseCopilotJobStatus.FAILED,
    ).length;
    const running = entry.jobs.filter(
      (j) =>
        j.status === CourseCopilotJobStatus.QUEUED ||
        j.status === CourseCopilotJobStatus.RUNNING,
    ).length;
    return {
      name,
      role: entry.role,
      state: running ? 'running' : 'ran',
      detail: `${done} of ${entry.jobs.length} done${failed ? `, ${failed} failed` : ''}`,
    };
  });
  const quizzes = jobs.filter((j) => String(j.kind) === 'quiz');
  if (quizzes.length) {
    const disputed = quizzes.filter((j) =>
      /disputed/i.test(j.summary ?? ''),
    ).length;
    const at = agents.findIndex((a) => a.name === 'Quiz writer');
    agents.splice(at + 1, 0, {
      name: 'Answer-key checker',
      role: 'Answers each quiz question without the key; disputed questions are repaired or dropped',
      state: 'ran',
      detail: disputed
        ? `${disputed} quiz(zes) had disputed answers`
        : `${quizzes.length} quiz(zes) checked, no disputes reported`,
    });
  }
  return agents;
}
