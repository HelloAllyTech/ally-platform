import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { GuideMemoryView } from '../contract/generated/guide-contract';
import { GuideAppointment } from '../entity/guide-appointment.entity';
import { GuideLearnerMemory } from '../entity/guide-learner-memory.entity';
import { GuideMessage } from '../entity/guide-message.entity';
import { GuideNotebookEntry } from '../entity/guide-notebook-entry.entity';
import { GuideThread } from '../entity/guide-thread.entity';
import {
  GuideAppointmentStatus,
  GuideMemoryKind,
  GuideMemoryStatus,
  GuideMessageRole,
  GuideNotebookKind,
} from '../enum/guide.enum';

type Owner = { id: number; tenantId: string };

/** Active notes kept per learner; the oldest beyond it are let go. */
export const MEMORY_CAP = 100;
/** Source messages kept per note: the latest few are enough to explain it. */
export const MEMORY_SOURCES_CAP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Lower-case, collapsed, punctuation-free: the identity of a note. */
export const memoryKey = (text: string) =>
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

/** What happened to one curator edit or retirement. */
export type CurationOutcome =
  | 'applied'
  /** The note changed (or went) since the curator read it: skipped, never forced. */
  | 'stale'
  /** The rewrite matches a note the learner forgot. */
  | 'forgotten_before'
  /** The rewrite matches another note the learner already has. */
  | 'duplicate'
  | 'empty';

const cleanBody = (text: string, maxChars: number) =>
  text.trim().replace(/\s+/g, ' ').slice(0, maxChars);

/** Older sources first, newest last, without repeats, capped. */
export function mergeSources(
  existing: string[] | null | undefined,
  added: string[] | null | undefined,
): string[] | null {
  const merged = [...(existing ?? [])];
  for (const id of added ?? []) {
    if (id && !merged.includes(id)) merged.push(id);
  }
  return merged.length ? merged.slice(-MEMORY_SOURCES_CAP) : null;
}

const clipExcerpt = (text: string) => {
  const flat = text.trim().replace(/\s+/g, ' ');
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
};

const isoOrNull = (value: Date | string | undefined | null) =>
  value ? new Date(value).toISOString() : null;

/** A curator write lands only on the revision it read (optimistic). */
const CURRENT_REVISION_SQL =
  'id = :id AND "userId" = :userId AND "tenant_id" = :tenantId AND status = :active AND revision = :revision';

/**
 * The learner's own data around Ally (plans/ally-guide/plan.md §8.1, §8.2):
 * memory (visible, editable, forgettable), the notebook (the learner's
 * words and noticing moments, exportable) and the appointment they chose.
 *
 * Memory is per (learner, organisation) and never crosses orgs (plan D4).
 * Forgetting keeps only a hash, so the same note cannot quietly return, and
 * drops the text immediately. Every note remembers which of the learner's
 * messages it came from, so the learner can see why.
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
    @InjectRepository(GuideMessage)
    private readonly messages: Repository<GuideMessage>,
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
    /** The learner messages the note comes from (memory provenance). */
    sourceMessageIds?: string[];
  }): Promise<RememberResult> {
    const body = cleanBody(input.body, input.maxChars);
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
    const sourceMessageIds = mergeSources(
      existing?.sourceMessageIds,
      input.sourceMessageIds,
    );
    if (existing) {
      // Confirmed again — or, if the curator had retired it, true again.
      await this.memories.update(existing.id, {
        ...(existing.status === GuideMemoryStatus.RETIRED
          ? {
              status: GuideMemoryStatus.ACTIVE,
              body,
              kind: input.kind,
              sourceThreadId: input.threadId,
            }
          : {}),
        lastConfirmedAt: now,
        expiresAt,
        revision: existing.revision + 1,
        sourceMessageIds,
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
        sourceMessageIds,
        revision: 1,
        lastConfirmedAt: now,
        expiresAt,
      }),
    );
    await this.trimMemories(input.owner);
    return { stored: true, id: saved.id, updated: false };
  }

  /**
   * Rewrite a note the curator read at `expectedRevision` (plan §7.7). The
   * write lands only if nobody — the learner, another run — changed the
   * note since; otherwise it is skipped, never forced. A rewrite may not
   * take the shape of something the learner forgot.
   */
  async editMemory(input: {
    owner: Owner;
    id: string;
    expectedRevision: number;
    body: string;
    kind?: GuideMemoryKind;
    expiryDays: number;
    maxChars: number;
    sourceMessageIds?: string[];
  }): Promise<CurationOutcome> {
    const body = cleanBody(input.body, input.maxChars);
    if (!body) return 'empty';
    const bodyHash = memoryKey(body);
    const row = await this.memories.findOne({
      where: {
        id: input.id,
        userId: input.owner.id,
        tenantId: input.owner.tenantId,
      },
    });
    if (
      !row ||
      row.status !== GuideMemoryStatus.ACTIVE ||
      row.revision !== input.expectedRevision
    ) {
      return 'stale';
    }
    if (bodyHash !== row.bodyHash) {
      const clash = await this.memories.findOne({
        where: {
          userId: input.owner.id,
          tenantId: input.owner.tenantId,
          bodyHash,
        },
      });
      if (clash?.status === GuideMemoryStatus.DELETED) {
        return 'forgotten_before';
      }
      if (clash && clash.id !== row.id) return 'duplicate';
    }
    const now = new Date();
    const result = await this.memories
      .createQueryBuilder()
      .update()
      .set({
        body,
        bodyHash,
        ...(input.kind ? { kind: input.kind } : {}),
        revision: () => '"revision" + 1',
        lastConfirmedAt: now,
        expiresAt: new Date(now.getTime() + input.expiryDays * DAY_MS),
        sourceMessageIds: mergeSources(
          row.sourceMessageIds,
          input.sourceMessageIds,
        ) as never,
      })
      .where(CURRENT_REVISION_SQL, {
        id: row.id,
        userId: input.owner.id,
        tenantId: input.owner.tenantId,
        active: GuideMemoryStatus.ACTIVE,
        revision: input.expectedRevision,
      })
      .execute();
    return result.affected ? 'applied' : 'stale';
  }

  /**
   * Retire a note the curator read at `expectedRevision` as no longer true.
   * Its text goes at once; unlike a learner's forget it is not a tombstone,
   * so it may be written again if it becomes true again.
   */
  async retireMemory(input: {
    owner: Owner;
    id: string;
    expectedRevision: number;
  }): Promise<CurationOutcome> {
    const result = await this.memories
      .createQueryBuilder()
      .update()
      .set({
        status: GuideMemoryStatus.RETIRED,
        body: '',
        expiresAt: null,
        revision: () => '"revision" + 1',
      })
      .where(CURRENT_REVISION_SQL, {
        id: input.id,
        userId: input.owner.id,
        tenantId: input.owner.tenantId,
        active: GuideMemoryStatus.ACTIVE,
        revision: input.expectedRevision,
      })
      .execute();
    return result.affected ? 'applied' : 'stale';
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

  /**
   * The learner's notes with their provenance: each note names the messages
   * it was drawn from, in the learner's own words, so the memory screen can
   * show why Ally remembers it. A source the learner has since deleted is
   * simply absent.
   */
  async listMemories(owner: Owner): Promise<GuideMemoryView[]> {
    const rows = await this.activeMemories(owner, MEMORY_CAP);
    const ids = [...new Set(rows.flatMap((row) => row.sourceMessageIds ?? []))];
    const messages = ids.length
      ? await this.messages.find({
          where: {
            id: In(ids),
            tenantId: owner.tenantId,
            role: GuideMessageRole.LEARNER,
          },
        })
      : [];
    const byId = new Map(messages.map((message) => [message.id, message]));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      revision: row.revision,
      lastConfirmedAt: isoOrNull(row.lastConfirmedAt),
      expiresAt: isoOrNull(row.expiresAt),
      sources: (row.sourceMessageIds ?? [])
        .map((id) => byId.get(id))
        .filter((message): message is GuideMessage =>
          Boolean(message?.content?.trim()),
        )
        .map((message) => ({
          messageId: message.id,
          threadId: message.threadId,
          excerpt: clipExcerpt(message.content!),
          at: isoOrNull((message as { createdAt?: Date }).createdAt),
        })),
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
