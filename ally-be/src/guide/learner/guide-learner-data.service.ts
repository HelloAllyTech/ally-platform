import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { GuideAppointment } from '../entity/guide-appointment.entity';
import { GuideLearnerMemory } from '../entity/guide-learner-memory.entity';
import { GuideNotebookEntry } from '../entity/guide-notebook-entry.entity';
import { GuideThread } from '../entity/guide-thread.entity';
import {
  GuideAppointmentStatus,
  GuideMemoryKind,
  GuideMemoryStatus,
  GuideNotebookKind,
} from '../enum/guide.enum';

type Owner = { id: number; tenantId: string };

/** Active notes kept per learner; the oldest beyond it are let go. */
export const MEMORY_CAP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Lower-case, collapsed, punctuation-free: the identity of a note. */
const memoryKey = (text: string) =>
  createHash('sha256')
    .update(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .digest('hex');

export type RememberResult =
  | { stored: true; id: string; updated: boolean }
  | { stored: false; reason: 'forgotten_before' | 'empty' };

/**
 * The learner's own data around Ally (plans/ally-guide/plan.md §8.1, §8.2):
 * memory (visible, editable, forgettable), the notebook (the learner's
 * words and noticing moments, exportable) and the appointment they chose.
 *
 * Memory is per (learner, organisation) and never crosses orgs (plan D4).
 * Forgetting keeps only a hash, so the same note cannot quietly return, and
 * drops the text immediately.
 */
@Injectable()
export class GuideLearnerDataService {
  constructor(
    @InjectRepository(GuideLearnerMemory)
    private readonly memories: Repository<GuideLearnerMemory>,
    @InjectRepository(GuideNotebookEntry)
    private readonly notebook: Repository<GuideNotebookEntry>,
    @InjectRepository(GuideAppointment)
    private readonly appointments: Repository<GuideAppointment>,
  ) {}

  // ── Memory ─────────────────────────────────────────────────────────────

  /** Active, unexpired notes, most recently confirmed first. */
  activeMemories(owner: Owner, limit = 30): Promise<GuideLearnerMemory[]> {
    return this.memories.find({
      where: [
        {
          userId: owner.id,
          tenantId: owner.tenantId,
          status: GuideMemoryStatus.ACTIVE,
          expiresAt: MoreThan(new Date()),
        },
        {
          userId: owner.id,
          tenantId: owner.tenantId,
          status: GuideMemoryStatus.ACTIVE,
          expiresAt: IsNull(),
        },
      ],
      order: { lastConfirmedAt: 'DESC' },
      take: limit,
    });
  }

  async remember(input: {
    owner: Owner;
    kind: GuideMemoryKind;
    body: string;
    threadId: string | null;
    expiryDays: number;
    maxChars: number;
  }): Promise<RememberResult> {
    const body = input.body
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, input.maxChars);
    if (!body) return { stored: false, reason: 'empty' };
    const bodyHash = memoryKey(body);
    const existing = await this.memories.findOne({
      where: {
        userId: input.owner.id,
        tenantId: input.owner.tenantId,
        bodyHash,
      },
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiryDays * DAY_MS);
    if (existing?.status === GuideMemoryStatus.DELETED) {
      return { stored: false, reason: 'forgotten_before' };
    }
    if (existing) {
      await this.memories.update(existing.id, {
        lastConfirmedAt: now,
        expiresAt,
        revision: existing.revision + 1,
      });
      return { stored: true, id: existing.id, updated: true };
    }
    const saved = await this.memories.save(
      this.memories.create({
        userId: input.owner.id,
        tenantId: input.owner.tenantId,
        kind: input.kind,
        body,
        bodyHash,
        status: GuideMemoryStatus.ACTIVE,
        sourceThreadId: input.threadId,
        revision: 1,
        lastConfirmedAt: now,
        expiresAt,
      }),
    );
    await this.trimMemories(input.owner);
    return { stored: true, id: saved.id, updated: false };
  }

  private async trimMemories(owner: Owner): Promise<void> {
    const active = await this.memories.find({
      where: {
        userId: owner.id,
        tenantId: owner.tenantId,
        status: GuideMemoryStatus.ACTIVE,
      },
      order: { lastConfirmedAt: 'DESC' },
      select: { id: true },
    });
    for (const old of active.slice(MEMORY_CAP)) {
      await this.forgetRow(old.id);
    }
  }

  async listMemories(owner: Owner) {
    const rows = await this.activeMemories(owner, MEMORY_CAP);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      lastConfirmedAt: row.lastConfirmedAt ?? null,
      expiresAt: row.expiresAt ?? null,
    }));
  }

  async forgetMemory(owner: Owner, id: string): Promise<void> {
    const row = await this.memories.findOne({
      where: { id, userId: owner.id, tenantId: owner.tenantId },
    });
    if (!row) throw new NotFoundException('Memory not found');
    await this.forgetRow(row.id);
  }

  async forgetAllMemories(owner: Owner): Promise<number> {
    const rows = await this.memories.find({
      where: {
        userId: owner.id,
        tenantId: owner.tenantId,
        status: GuideMemoryStatus.ACTIVE,
      },
      select: { id: true },
    });
    for (const row of rows) await this.forgetRow(row.id);
    return rows.length;
  }

  /** Text gone at once; the hash stays so the note cannot come back. */
  private async forgetRow(id: string): Promise<void> {
    await this.memories.update(id, {
      status: GuideMemoryStatus.DELETED,
      body: '',
      expiresAt: null,
    });
  }

  // ── Notebook ───────────────────────────────────────────────────────────

  async addToNotebook(input: {
    owner: Owner;
    threadId: string;
    trackId: string;
    kind: GuideNotebookKind;
    text: string;
    sourceMessageId?: string | null;
  }): Promise<GuideNotebookEntry> {
    return this.notebook.save(
      this.notebook.create({
        userId: input.owner.id,
        tenantId: input.owner.tenantId,
        threadId: input.threadId,
        trackId: input.trackId,
        kind: input.kind,
        text: input.text.trim().slice(0, 2000),
        sourceMessageId: input.sourceMessageId ?? null,
      }),
    );
  }

  listNotebook(owner: Owner, trackId?: string) {
    return this.notebook.find({
      where: {
        userId: owner.id,
        tenantId: owner.tenantId,
        ...(trackId ? { trackId } : {}),
      },
      order: { createdAt: 'ASC' } as never,
    });
  }

  async hasNotebookKind(
    owner: Owner,
    trackId: string,
    kind: GuideNotebookKind,
  ): Promise<boolean> {
    return (
      (await this.notebook.count({
        where: { userId: owner.id, tenantId: owner.tenantId, trackId, kind },
      })) > 0
    );
  }

  async removeFromNotebook(owner: Owner, id: string): Promise<void> {
    const row = await this.notebook.findOne({
      where: { id, userId: owner.id, tenantId: owner.tenantId },
    });
    if (!row) throw new NotFoundException('Notebook entry not found');
    await this.notebook.softDelete(row.id);
  }

  /** The notebook as a Markdown document the learner can keep. */
  async exportNotebook(owner: Owner, trackId?: string): Promise<string> {
    const rows = await this.listNotebook(owner, trackId);
    return renderNotebookMarkdown(rows);
  }

  // ── Appointment ────────────────────────────────────────────────────────

  async setAppointment(
    thread: GuideThread,
    owner: Owner,
    input: { at: string; timezone: string },
    now = new Date(),
  ) {
    const at = new Date(input.at);
    if (Number.isNaN(at.getTime())) {
      throw new BadRequestException('`at` must be an ISO date-time');
    }
    if (!isValidTimezone(input.timezone)) {
      throw new BadRequestException('`timezone` must be an IANA time zone');
    }
    if (at.getTime() < now.getTime() + 5 * 60_000) {
      throw new BadRequestException(
        'Pick a time at least a few minutes from now',
      );
    }
    if (at.getTime() > now.getTime() + 30 * DAY_MS) {
      throw new BadRequestException('Pick a time within the next 30 days');
    }
    await this.appointments.update(
      { threadId: thread.id, status: GuideAppointmentStatus.SCHEDULED },
      { status: GuideAppointmentStatus.CANCELLED },
    );
    const saved = await this.appointments.save(
      this.appointments.create({
        threadId: thread.id,
        userId: owner.id,
        tenantId: owner.tenantId,
        at,
        timezone: input.timezone,
        status: GuideAppointmentStatus.SCHEDULED,
      }),
    );
    return appointmentView(saved);
  }

  async appointment(thread: GuideThread) {
    const row = await this.appointments.findOne({
      where: { threadId: thread.id, status: GuideAppointmentStatus.SCHEDULED },
    });
    return row ? appointmentView(row) : null;
  }

  async cancelAppointment(thread: GuideThread): Promise<void> {
    await this.appointments.update(
      { threadId: thread.id, status: GuideAppointmentStatus.SCHEDULED },
      { status: GuideAppointmentStatus.CANCELLED },
    );
  }
}

export function isValidTimezone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function appointmentView(row: GuideAppointment) {
  return {
    id: row.id,
    at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
    timezone: row.timezone,
    status: row.status,
  };
}

const NOTEBOOK_HEADINGS: Record<string, string> = {
  first_move: 'My first move',
  possible_self: 'The helper I want to become',
  journal_line: 'From my journal',
  rehearsed_line: 'Lines I practised',
  reflection: 'Reflections',
  noticing: 'Moments Ally noticed',
};

export function renderNotebookMarkdown(
  rows: Array<Pick<GuideNotebookEntry, 'kind' | 'text'> & { createdAt?: Date }>,
): string {
  const lines = ['# My notebook', ''];
  for (const kind of Object.keys(NOTEBOOK_HEADINGS)) {
    const entries = rows.filter((row) => row.kind === kind);
    if (!entries.length) continue;
    lines.push(`## ${NOTEBOOK_HEADINGS[kind]}`, '');
    for (const entry of entries)
      lines.push(`- ${entry.text.replace(/\n+/g, ' ')}`);
    lines.push('');
  }
  if (lines.length === 2) lines.push('Nothing here yet.');
  return lines.join('\n');
}
