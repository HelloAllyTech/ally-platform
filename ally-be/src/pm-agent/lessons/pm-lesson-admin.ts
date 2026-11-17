import { ConflictException } from '@nestjs/common';
import { PmAgentMemory, PmLessonEvent } from '../entity/pm-agent-memory.entity';
import { PmLessonStatus, PmMemorySource } from '../enum/pm-agent.enum';
import { PmLessonResponse } from '../dto/pm-agent.dto';
import { PM_LESSONS } from './pm-lessons.constants';

/**
 * Admin actions on a lesson, as pure patches (PmAgentMemoryService and PmAgentLessonsService
 * apply them), and the `Lesson` shape of docs/pm-agent.md. Every action appends to the row's
 * `lessonEvents` audit; lessons are not cards, so `pm_agent_card_events` (FK to a card) cannot
 * hold them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENTS_KEPT = 50;

const iso = (value?: Date | string | null): string | null =>
  value ? new Date(value).toISOString() : null;

export function appendLessonEvent(
  row: Pick<PmAgentMemory, 'lessonEvents'>,
  event: Omit<PmLessonEvent, 'at'>,
  now: Date,
): PmLessonEvent[] {
  return [
    ...(row.lessonEvents ?? []),
    { ...event, at: now.toISOString() },
  ].slice(-EVENTS_KEPT);
}

/** PATCH /memory/:id on a lesson: `{ value?, active? }`. */
export function lessonEditPatch(
  row: PmAgentMemory,
  dto: { value?: string; active?: boolean },
  userId: number,
  now: Date,
): Partial<PmAgentMemory> {
  const patch: Partial<PmAgentMemory> = { updatedBy: userId };
  const events: Omit<PmLessonEvent, 'at'>[] = [];
  if (dto.value !== undefined) {
    if (row.lessonStatus === PmLessonStatus.REMOVED && dto.active !== true) {
      throw new ConflictException('This lesson was removed; restore it first');
    }
    // An admin's words: manual, active, and no longer subject to the 60-day expiry.
    patch.value = dto.value.trim();
    patch.source = PmMemorySource.MANUAL;
    patch.lessonStatus = PmLessonStatus.ACTIVE;
    patch.active = true;
    patch.expiresAt = null;
    events.push({
      type: 'lesson_edited',
      actorUserId: userId,
      detail: {
        from: row.value.slice(0, 300),
        fromStatus: row.lessonStatus ?? null,
      },
    });
  }
  if (dto.active === false) {
    patch.lessonStatus = PmLessonStatus.REMOVED;
    patch.active = false;
    events.push({
      type: 'lesson_removed',
      actorUserId: userId,
      detail: { fromStatus: row.lessonStatus ?? null },
    });
  } else if (dto.active === true && dto.value === undefined) {
    patch.lessonStatus = PmLessonStatus.ACTIVE;
    patch.active = true;
    if (row.source !== PmMemorySource.MANUAL) {
      patch.expiresAt = new Date(
        now.getTime() + PM_LESSONS.EXPIRY_DAYS * DAY_MS,
      );
    }
    events.push({
      type:
        row.lessonStatus === PmLessonStatus.PROPOSED
          ? 'lesson_confirmed'
          : 'lesson_reactivated',
      actorUserId: userId,
      detail: { fromStatus: row.lessonStatus ?? null },
    });
  }
  let audit = row.lessonEvents ?? [];
  for (const event of events)
    audit = appendLessonEvent({ lessonEvents: audit }, event, now);
  if (events.length) patch.lessonEvents = audit;
  return patch;
}

/** DELETE /memory/:id on a lesson: soft, status `removed` (the job will not re-propose it). */
export function lessonRemovePatch(
  row: PmAgentMemory,
  userId: number | null,
  now: Date,
): Partial<PmAgentMemory> {
  return {
    lessonStatus: PmLessonStatus.REMOVED,
    active: false,
    updatedBy: userId,
    lessonEvents: appendLessonEvent(
      row,
      {
        type: 'lesson_removed',
        actorUserId: userId,
        detail: { fromStatus: row.lessonStatus ?? null },
      },
      now,
    ),
  };
}

export function toLessonResponse(row: PmAgentMemory): PmLessonResponse {
  return {
    id: row.id,
    text: row.value,
    scope: row.scope as PmLessonResponse['scope'],
    ...(row.category ? { category: row.category } : {}),
    ...(row.lane ? { lane: row.lane } : {}),
    status: (row.lessonStatus ??
      PmLessonStatus.PROPOSED) as PmLessonResponse['status'],
    source: row.source === PmMemorySource.MANUAL ? 'manual' : 'weekly_job',
    supportCount: row.supportCount ?? 0,
    supportRatio: row.supportRatio != null ? Number(row.supportRatio) : 0,
    evidenceCardIds: row.evidenceCardIds ?? [],
    ...(row.evalResult ? { evalResult: row.evalResult } : {}),
    requiresConfirm: Boolean(row.requiresConfirm),
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    lastSupportedAt: iso(row.lastSupportedAt),
    expiresAt: iso(row.expiresAt),
  };
}
