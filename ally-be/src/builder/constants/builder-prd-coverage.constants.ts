import { BuilderPrdCoverageKey } from '../type/builder-prd.type';

/**
 * The coverage pass: the questions a PRD has to have faced before it can read ready.
 *
 * Section rows only check that something was written. In the PRDs that reached "ready" before
 * this list, the cold review kept raising the same gaps — no success metric, no permission or
 * toggle gating — and edge cases arrived later from the design review or a person. Each item
 * here needs one of three things: an answer the PRD holds (naming the section), a reason it does
 * not apply, or a question asked and still open. "Not applicable" is a fine answer; silence is
 * not. Naming every client platform up front, mobile included, follows [FP-2493].
 *
 * Fixed in code on purpose: the readiness rubric, the interview tool and the admin panel read the
 * same list, so the three cannot disagree about what "covered" means.
 */
export interface BuilderPrdCoverageDefinition {
  key: BuilderPrdCoverageKey;
  /** What a person reads in the PRD panel. */
  label: string;
  /** What the agent has to settle, in one or two sentences. */
  ask: string;
}

export const BUILDER_PRD_COVERAGE: BuilderPrdCoverageDefinition[] = [
  {
    key: 'admin_web',
    label: 'Admin web app',
    ask: 'Does the change reach the admin dashboard (ally-web admin)? If it does, which screens.',
  },
  {
    key: 'helpline_web',
    label: 'Helpline web app',
    ask: 'Does the change reach the learner/counsellor web app (ally-web helpline)? If it does, which screens.',
  },
  {
    key: 'mobile_app',
    label: 'Mobile app',
    ask:
      'Does the change reach the mobile app (ally-mobile, Flutter — Dart under lib/, not React ' +
      'Native)? A learner screen on the web usually has a mobile twin.',
  },
  {
    key: 'failure_empty_states',
    label: 'Failure and empty states',
    ask: 'What each new screen or call shows when there is no data, when it is loading, and when it fails.',
  },
  {
    key: 'permission_toggle',
    label: 'Permission and toggle',
    ask:
      'Who may see and do this (roles, permissions, capabilities), and whether it sits behind a ' +
      'feature toggle or setting — and its default.',
  },
  {
    key: 'success_metric',
    label: 'Success metric',
    ask: 'How anyone will know it worked: the measure, where it is read from, and the target.',
  },
  {
    key: 'existing_data_old_clients',
    label: 'Existing data and old clients',
    ask:
      'What happens to rows written before the change (backfill, migration) and to released ' +
      'clients that do not send or expect the new shape.',
  },
  {
    key: 'translations',
    label: 'Translations',
    ask: 'New user-facing text and the languages it needs (helpline and mobile ship several).',
  },
  {
    key: 'model_cost_registry',
    label: 'Model cost and AI task row',
    ask:
      'Whether it adds, removes or re-points a model call; if so, its cost and its row in the AI ' +
      'task registry.',
  },
  {
    key: 'other_readers',
    label: 'Other readers of changed fields',
    ask:
      'Every other place that reads a field, endpoint or enum this changes — other screens, ' +
      'services, mobile, analytics.',
  },
];

export const BUILDER_PRD_COVERAGE_KEYS: BuilderPrdCoverageKey[] =
  BUILDER_PRD_COVERAGE.map((item) => item.key);

/** A not-applicable reason shorter than this is a shrug, not a reason. */
export const COVERAGE_REASON_MIN_CHARS = 12;
