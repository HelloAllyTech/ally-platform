import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';
import {
  StatisticsLayoutsConstraint,
  StatisticsSubjectsConstraint,
} from './statistics-preferences.validators';

export class UpdateUserPreferencesDto {
  @IsOptional()
  @IsInt()
  default_language_id?: number;

  // Ordered list of admin-dashboard sidebar item ids (per-user nav ordering).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  admin_sidebar_order?: string[];

  // Consumer web app UI theme id (e.g. 'daylight', 'midnight', 'forest',
  // 'sunset', 'ocean'). The canonical value set + validity guard live in the
  // frontend (ally-web apps/ally-helpline-dashboard/src/theme/themes.ts); kept
  // loose here like the other keys so adding a theme needs no backend deploy.
  @IsOptional()
  @IsString()
  ui_theme?: string;

  // Per-user opt-out for the daily "your streak is at risk" email. Absent means
  // opted in; only an explicit false suppresses the reminder (see
  // StreakReminderService.getAtRiskRecipients).
  @IsOptional()
  @IsBoolean()
  streak_reminder_enabled?: boolean;

  // Per-user ordering of the Organization Metrics chart/table blocks
  // (ally-helpline-dashboard Statistics page, Org tab). Array of block ids
  // from ORG_METRICS_BLOCK_IDS in ally-web; validated loosely here (just
  // "array of strings") so adding/removing a block needs no backend deploy —
  // the frontend drops unknown/stale ids and appends any missing ones at the
  // end (see OrganizationMetrics.tsx's resolveLayout).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  org_metrics_layout?: string[];

  // Per-user layout of the Statistics dashboard chart library
  // (ally-helpline-dashboard Statistics page, Org tab): an ordered list of
  // chart ids from the tenant chart library (`TSQ-###`). Absent means "never
  // customised", so the default layout applies; an empty list means the admin
  // removed every chart. Validated loosely (array of strings) so adding or
  // retiring a chart needs no backend deploy: the frontend drops unknown ids.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @ArrayUnique()
  statistics_dashboard?: string[];

  // Per-user layouts of the Statistics tabs (ally-helpline-dashboard Statistics
  // page): { organisation, course, learner, pins }, each an ordered list of
  // card keys (`TSQ-003`, or `TSQ-003?course=<id>` with a filter set). Absent
  // means "never customised" for that tab, so its default layout applies; an
  // empty list means the person removed everything. `statistics_dashboard`
  // above is the older, single list: the page reads it as `organisation`.
  @IsOptional()
  @Validate(StatisticsLayoutsConstraint)
  statistics_layouts?: Record<string, string[]>;

  // The course and learner a person last chose on the Course and Learner tabs.
  @IsOptional()
  @Validate(StatisticsSubjectsConstraint)
  statistics_subjects?: Record<string, string>;
  // Per-user order of the Roadmap Queue's built-in tabs (admin-dashboard Roadmap → Queue), as view
  // ids: 'to-triage' | 'all' | 'leading' | 'for-you'. Loose like the other keys: the frontend drops
  // an id the person's role no longer offers and appends any it doesn't find, in the default order.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  roadmap_queue_tab_order?: string[];

  // Per-user sort for each Roadmap Queue view, by view id (the five defaults; a saved view keeps its
  // own sort), e.g. { building: 'activity' }. Values are loose strings: the frontend ignores a
  // sort it no longer offers, so retiring one needs no backend deploy.
  @IsOptional()
  @IsObject()
  roadmap_queue_sorts?: Record<string, string>;
}
