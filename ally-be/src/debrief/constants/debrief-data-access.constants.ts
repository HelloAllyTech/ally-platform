/**
 * What data each Debrief agent can read (2026-11-18): the one declared list the Settings › Agents
 * matrix shows. It is a mirror of the real wiring, never a second source: ally-ai's step bodies
 * (`app/core/debrief_graph/inputs.py`) are checked against it by
 * `ally-ai/tests/core/debrief_graph/test_data_access_matches_wiring.py`, and the PM agent's tools
 * against `PM_AGENT_ACCESS`, so adding an input to a step without declaring it fails a test.
 *
 * ally-ai reads the checked-in JSON mirror `docs/debrief-harness/data-access.json`
 * (`debrief-data-access.spec.ts` keeps it identical to this file; run it with
 * `UPDATE_DATA_ACCESS=1` after an edit).
 */
export type DataGroup =
  | 'this session'
  | 'the roleplay'
  | 'the learner'
  | 'other learners'
  | 'the library'
  | 'other agents';

export interface DataItem {
  key: string;
  label: string;
  description: string;
  group: DataGroup;
  /**
   * Who may change whether an agent reads it. `fixed`: nobody (safety needs it, or it is not
   * switchable yet). `setting`: a release setting, which a person or the PM agent may change
   * (`roleplayFields`). `owner`: personal or cross-learner data; only the owner, never the PM agent.
   */
  control: 'fixed' | 'setting' | 'owner';
  /** Personal data about a learner or learners. */
  personal?: boolean;
}

export const DATA_ITEMS: readonly DataItem[] = [
  {
    key: 'transcript',
    label: 'The conversation',
    description: 'What the learner and the client said, turn by turn.',
    group: 'this session',
    control: 'fixed',
    personal: true,
  },
  {
    key: 'language',
    label: 'Session language',
    description: 'The language the roleplay was held in.',
    group: 'this session',
    control: 'fixed',
  },
  {
    key: 'live_detections',
    label: 'Live detections',
    description:
      'The events the live detector watched for during the roleplay.',
    group: 'this session',
    control: 'fixed',
  },
  {
    key: 'roleplay_brief',
    label: 'Roleplay brief',
    description:
      'The roleplay’s title and description, plus the optional fields a release switches on.',
    group: 'the roleplay',
    control: 'setting',
  },
  {
    key: 'roleplay_behaviours',
    label: 'What the roleplay expects',
    description:
      'Its competencies and the helpful and unhelpful behaviours the author listed.',
    group: 'the roleplay',
    control: 'fixed',
  },
  {
    key: 'risk_cue_choice',
    label: 'Risk-cue choice',
    description: 'Whether handling a risk conversation is the skill practised.',
    group: 'the roleplay',
    control: 'fixed',
  },
  {
    key: 'risk_cue_definition',
    label: 'Risk-cue definition',
    description:
      'The one pinned definition of a clear and a possible risk cue.',
    group: 'the library',
    control: 'fixed',
  },
  {
    key: 'skill_framework',
    label: 'Skill framework',
    description:
      'The skills the organisation’s debrief assesses beyond the roleplay’s own.',
    group: 'the library',
    control: 'fixed',
  },
  {
    key: 'guidance_passages',
    label: 'Guidance passages',
    description: 'Debrief Guidance entries fetched for this session.',
    group: 'the library',
    control: 'fixed',
  },
  {
    key: 'practice_options',
    label: 'What to practise next',
    description:
      'The roleplays and course items the learner could practise next.',
    group: 'the library',
    control: 'fixed',
  },
  {
    key: 'learner_level',
    label: 'Learner level',
    description: 'The learner’s level, for the tone of the coaching.',
    group: 'the learner',
    control: 'owner',
    personal: true,
  },
  {
    key: 'learner_history',
    label: 'Learner history',
    description:
      'The learner’s earlier debriefs and the points they were working on.',
    group: 'the learner',
    control: 'owner',
    personal: true,
  },
  {
    key: 'case_memory',
    label: 'Case memory',
    description:
      'What the client remembers from the learner’s earlier sessions in the same case.',
    group: 'the learner',
    control: 'owner',
    personal: true,
  },
  {
    key: 'cohort',
    label: 'Other trainees’ results',
    description:
      'How other trainees did on this roleplay, in words, never a number.',
    group: 'other learners',
    control: 'owner',
    personal: true,
  },
  {
    key: 'earlier_findings',
    label: 'Earlier steps’ findings',
    description:
      'What the other agents already found or wrote for this session: the safety reading, the evidence, progress and the draft.',
    group: 'other agents',
    control: 'fixed',
  },
] as const;

/**
 * Per agent: each key its step body carries mapped to a data item, or `null` for what is not data
 * (its instructions, the pass mark, flags). Conditional keys are listed too (marked in `when`).
 */
export interface AgentAccess {
  key: string;
  label: string;
  body: Record<string, string | null>;
  /** Keys that are only sent in some runs, in plain words. */
  when?: Record<string, string>;
}

export const AGENT_ACCESS: readonly AgentAccess[] = [
  {
    key: 'safety_reader',
    label: 'Safety reader',
    body: {
      transcript: 'transcript',
      language: 'language',
      system_prompt: null,
      risk_cue_definition: 'risk_cue_definition',
      risk_cue: 'risk_cue_choice',
      speaker_labels: null,
      scenario: 'roleplay_brief',
      roleplay_expectations: 'roleplay_behaviours',
    },
    when: {
      scenario: 'only when handling risk is the skill practised',
      roleplay_expectations: 'only when handling risk is the skill practised',
    },
  },
  {
    key: 'analyst',
    label: 'Analyst',
    body: {
      transcript: 'transcript',
      language: 'language',
      scenario: 'roleplay_brief',
      expected_behaviours: 'roleplay_behaviours',
      helpful_behaviours: 'roleplay_behaviours',
      unhelpful_behaviours: 'roleplay_behaviours',
      competencies: 'roleplay_behaviours',
      learner_level: 'learner_level',
      live_detections: 'live_detections',
      case_memory: 'case_memory',
      system_prompt: null,
      framework: 'skill_framework',
      speaker_labels: null,
    },
  },
  {
    key: 'progress_agent',
    label: 'Progress reader',
    body: {
      evidence: 'earlier_findings',
      profile: 'learner_history',
      this_session: 'learner_history',
      language: 'language',
      system_prompt: null,
      framework: 'skill_framework',
    },
  },
  {
    key: 'progress_reader',
    label: 'Progress reader (planned runs)',
    body: {
      evidence: 'earlier_findings',
      past_points: 'learner_history',
      language: 'language',
      system_prompt: null,
    },
  },
  {
    key: 'writer',
    label: 'Writer',
    body: {
      practice_options: 'practice_options',
      case_memory: 'case_memory',
      cohort: 'cohort',
      assessment: null,
      evidence: 'earlier_findings',
      safety: 'earlier_findings',
      transcript: 'transcript',
      passages: 'guidance_passages',
      progress: 'earlier_findings',
      language: 'language',
      learner_level: 'learner_level',
      short: null,
      system_prompt: null,
      risk_cue_definition: 'risk_cue_definition',
      risk_cue: 'risk_cue_choice',
      speaker_labels: null,
      findings: 'earlier_findings',
    },
    when: { findings: 'only in planned runs' },
  },
  {
    key: 'evaluator',
    label: 'Evaluator',
    body: {
      transcript: 'transcript',
      debrief: 'earlier_findings',
      rubric: null,
      history: 'earlier_findings',
      language: 'language',
      learner_level: 'learner_level',
      risk_cue_definition: 'risk_cue_definition',
      system_prompt: null,
      fix_prompt: null,
      pass_score: null,
      progress: 'earlier_findings',
      risk_cue: 'risk_cue_choice',
      speaker_labels: null,
      roleplay_expectations: 'roleplay_behaviours',
    },
    when: {
      roleplay_expectations: 'only when the roleplay lists expectations',
    },
  },
  {
    key: 'reviser',
    label: 'Reviser',
    body: {
      draft: 'earlier_findings',
      critique: 'earlier_findings',
      evidence: 'earlier_findings',
      excerpts: 'transcript',
      language: 'language',
      system_prompt: null,
      safety: 'earlier_findings',
      risk_cue_definition: 'risk_cue_definition',
      risk_cue: 'risk_cue_choice',
      speaker_labels: null,
      passages: 'guidance_passages',
      findings: 'earlier_findings',
    },
    when: {
      passages: 'only when it fetched guidance itself',
      findings: 'only in planned runs, after the evidence top-up',
    },
  },
] as const;

/**
 * The Debrief PM agent's own tools: what each reads (never a transcript), or `act` for the ones that
 * change something. Checked against the tools ally-ai actually gives it.
 */
export interface PmToolAccess {
  tool: string;
  kind: 'read' | 'act';
  reads: string;
}

export const PM_AGENT_ACCESS: readonly PmToolAccess[] = [
  {
    tool: 'reporting_query',
    kind: 'read',
    reads: 'Redacted debrief reporting views (no transcripts, no names)',
  },
  { tool: 'comments_read', kind: 'read', reads: 'Expert review comments' },
  {
    tool: 'metrics_view',
    kind: 'read',
    reads: 'Where the metrics are failing',
  },
  {
    tool: 'guidance_report',
    kind: 'read',
    reads: 'How the guidance lookup and agent are used',
  },
  {
    tool: 'questions_read',
    kind: 'read',
    reads: 'Questions people asked on its ideas',
  },
  {
    tool: 'change_read',
    kind: 'read',
    reads: 'One change in full, with its test results',
  },
  {
    tool: 'prompt_read',
    kind: 'read',
    reads: 'The live text of a debrief prompt (it cannot edit a pinned one)',
  },
  {
    tool: 'session_read',
    kind: 'read',
    reads: 'One session’s run summary (no transcript)',
  },
  {
    tool: 'idea_propose',
    kind: 'act',
    reads: 'Records an idea with its evidence',
  },
  {
    tool: 'release_draft',
    kind: 'act',
    reads: 'Drafts a prompt, setting or agent change (a draft, nothing live)',
  },
  {
    tool: 'ladder_start_quick_test',
    kind: 'act',
    reads: 'Starts the tests for a drafted change',
  },
  {
    tool: 'builder_handoff',
    kind: 'act',
    reads: 'Briefs Builder on code that is needed',
  },
  {
    tool: 'bug_hunter_report',
    kind: 'act',
    reads: 'Reports a defect to Bug Hunter',
  },
  {
    tool: 'person_ask',
    kind: 'act',
    reads: 'Asks the owner or the clinical advisor',
  },
  {
    tool: 'guidance_propose',
    kind: 'act',
    reads: 'Proposes a guidance entry for a person to approve',
  },
  {
    tool: 'question_answer',
    kind: 'act',
    reads: 'Answers a question on one of its ideas',
  },
  {
    tool: 'change_approve',
    kind: 'act',
    reads: 'Approves a change, only after a person says yes',
  },
  {
    tool: 'change_turn_down',
    kind: 'act',
    reads: 'Turns a change down, only after a person says yes',
  },
  { tool: 'change_stop', kind: 'act', reads: 'Stops a change being tried' },
  { tool: 'change_undo', kind: 'act', reads: 'Undoes a live change' },
  { tool: 'change_retry', kind: 'act', reads: 'Tries a stopped change again' },
  {
    tool: 'change_hold_language',
    kind: 'act',
    reads: 'Keeps one language on the previous release',
  },
  {
    tool: 'changes_pause',
    kind: 'act',
    reads: 'Pauses a kind of change until a date',
  },
] as const;

/** The whole declaration, as the JSON mirror holds it. */
export const DEBRIEF_DATA_ACCESS = {
  data: DATA_ITEMS,
  agents: AGENT_ACCESS,
  pmAgent: PM_AGENT_ACCESS,
};
