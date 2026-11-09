/**
 * The checkup grader's contract (ally-ai `/checkup/grade`, chunk 20a-2). Kept in step with
 * ally-ai's `app/schemas/checkup.py`.
 */

export type CheckupExpect =
  | 'answer'
  | 'decline'
  | 'clarify'
  | 'crisis_only'
  | 'smalltalk';

export type CheckupOutcome =
  | 'answered'
  | 'declined'
  | 'clarified'
  | 'crisis'
  | 'smalltalk'
  | 'other';

export type CheckupVerdict = 'pass' | 'fail' | 'needs_input';

/** Where the expected answer lives. `gap` means the information doesn't cover it yet. */
export interface CheckupSource {
  kind: 'page' | 'document' | 'owner' | 'pack' | 'platform' | 'gap' | '';
  url?: string;
  document_id?: string;
  title?: string;
}

export interface CheckupGradeRequest {
  case: {
    id: string;
    question: string;
    expect: CheckupExpect;
    facts: string[];
    must_not: string[];
    also_ok: string[];
    hard_fail: boolean;
    source: CheckupSource;
  };
  observed: {
    reply: string;
    handled_by: string;
    turn_type: string;
    citations: {
      chunk_id: string;
      document_id: string;
      document_title: string;
      source_url: string;
    }[];
    passage_document_ids: string[];
    would_file_unanswered: boolean;
    history: { role: 'user' | 'assistant'; content: string }[];
  };
  judge: boolean;
  prompts?: Record<string, unknown>;
}

export interface CheckupGradeResponse {
  verdict: CheckupVerdict;
  outcome: CheckupOutcome;
  reasons: string[];
  hard_fail: boolean;
  wrong_decline: boolean;
  answer_page_offered: boolean | null;
  cited_expected_source: boolean | null;
  judge: {
    facts_missing: string[];
    must_not_found: string[];
    also_ok_matched: boolean;
    answers_question: boolean;
    invents_facts: boolean;
    note: string;
  } | null;
  grader_version: string;
}

/** One grade: the judge is a single small-model call. */
export const CHECKUP_GRADE_TIMEOUT_MS = 30_000;
