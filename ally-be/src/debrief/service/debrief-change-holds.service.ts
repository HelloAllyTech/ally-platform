import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentRelease } from '../../llm-agent/entity/agent-release.entity';
import { DebriefChangeHold } from '../entity/debrief-change-hold.entity';
import { DEBRIEF_AGENT_KEY } from '../constants/debrief-release.constants';

/** Kinds of change a person can pause (C2): prompts, settings, and Builder / Bug Hunter hand-offs. */
export const PAUSABLE_KINDS = ['prompts', 'settings', 'code'] as const;
export type PausableKind = (typeof PAUSABLE_KINDS)[number];
/** A pause lasts at most this long; a longer one is a setting, not a pause. */
export const MAX_PAUSE_DAYS = 90;

/** A language code as sessions record it (`languages.value`): `hi`, `ta`, `en-IN`. */
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

export function normaliseLanguages(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = [
    ...new Set(
      v
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((x) => LANGUAGE.test(x)),
    ),
  ];
  return out.length ? out.slice(0, 20) : null;
}

/**
 * Per-language scope (V2_AUTONOMY A9) and pauses (C2), on
 * `debrief_change_holds`. A language pin sends that language's sessions to a
 * named release instead of the release in force; the runner honours it when it
 * resolves a session's release (`DebriefRunnerService.run`), and a session in a
 * pinned language never joins a learner try-out (its result would mix
 * releases). A pin stays until it is lifted (a retry for that language, or a
 * person), so a language undone stays undone even after later releases.
 */
@Injectable()
export class DebriefChangeHoldsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefChangeHold)
    private readonly holds: Repository<DebriefChangeHold>,
    private readonly releases: AgentReleaseService,
  ) {}

  // --- language pins ------------------------------------------------------------------

  /** The session's recorded language, or null when it recorded none. */
  async sessionLanguage(sessionId: string): Promise<string | null> {
    const [row] = await this.dataSource.query(
      `SELECT l.value AS language
         FROM scenario_sessions s
         LEFT JOIN languages l ON l.id = NULLIF(s.metadata->>'languageId', '')::int
        WHERE s.id = $1`,
      [sessionId],
    );
    return row?.language ? String(row.language).slice(0, 10) : null;
  }

  activePin(language: string): Promise<DebriefChangeHold | null> {
    return this.holds.findOne({
      where: { kind: 'language', language, liftedAt: IsNull() },
    });
  }

  /**
   * The release a session's language is pinned to, or null (the release in
   * force). A pin to a release that no longer exists is ignored, never fatal.
   */
  async releaseForSession(sessionId: string): Promise<AgentRelease | null> {
    const language = await this.sessionLanguage(sessionId);
    if (!language) return null;
    const pin = await this.activePin(language);
    if (!pin?.releaseId) return null;
    const release = await this.releases
      .getById(pin.releaseId)
      .catch(() => null);
    return release && release.agentKey === DEBRIEF_AGENT_KEY ? release : null;
  }

  /**
   * A learner try-out skips this session: its language is pinned, or the
   * try-out's change applies only to other languages.
   */
  async excludesCanary(
    sessionId: string,
    change: Record<string, any> | null | undefined,
  ): Promise<boolean> {
    const language = await this.sessionLanguage(sessionId);
    const scope = normaliseLanguages(change?.languages);
    if (scope && (!language || !scope.includes(language))) return true;
    return !!language && !!(await this.activePin(language));
  }

  /** Pin a language to a release; the language's earlier pin is lifted first. */
  async pin(input: {
    language: string;
    releaseId: string;
    ideaId: string | null;
    reason: 'held' | 'undone' | 'only';
    by: number | null;
    note?: string | null;
  }): Promise<DebriefChangeHold> {
    if (!LANGUAGE.test(input.language)) {
      throw new BadRequestException(`${input.language} is not a language code`);
    }
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(DebriefChangeHold);
      await repo.update(
        { kind: 'language', language: input.language, liftedAt: IsNull() },
        { liftedAt: new Date(), liftedBy: input.by },
      );
      return repo.save(
        repo.create({
          kind: 'language',
          language: input.language,
          releaseId: input.releaseId,
          ideaId: input.ideaId,
          reason: input.reason,
          note: input.note?.slice(0, 1000) ?? null,
          createdBy: input.by,
        }),
      );
    });
  }

  /** Lift a change's pins (all, or for these languages). Returns the languages lifted. */
  async lift(
    ideaId: string,
    languages: string[] | null,
    by: number | null,
  ): Promise<string[]> {
    const active = await this.holds.find({
      where: { kind: 'language', ideaId, liftedAt: IsNull() },
    });
    const lifted = active.filter(
      (h) => !languages || languages.includes(h.language!),
    );
    for (const h of lifted) {
      await this.holds.update(h.id, { liftedAt: new Date(), liftedBy: by });
    }
    return lifted.map((h) => h.language!);
  }

  /** The languages a change is scoped to, held from or undone for (the contract's `languages`). */
  async languagesFor(idea: {
    id: string;
    change?: Record<string, any> | null;
  }): Promise<{ languages: string[] | null; heldLanguages: string[] }> {
    const active = await this.holds.find({
      where: { kind: 'language', ideaId: idea.id, liftedAt: IsNull() },
    });
    const only = active.filter((h) => h.reason === 'only');
    return {
      languages: only.length
        ? only.map((h) => h.language!)
        : normaliseLanguages(idea.change?.languages),
      heldLanguages: active
        .filter((h) => h.reason !== 'only')
        .map((h) => h.language!),
    };
  }

  // --- pauses -----------------------------------------------------------------------

  async pause(
    changeKind: string,
    until: Date,
    by: number | null,
    note?: string | null,
  ): Promise<DebriefChangeHold> {
    if (!(PAUSABLE_KINDS as readonly string[]).includes(changeKind)) {
      throw new BadRequestException(
        `only ${PAUSABLE_KINDS.join(', ')} changes can be paused`,
      );
    }
    const now = Date.now();
    if (!Number.isFinite(until.getTime()) || until.getTime() <= now) {
      throw new BadRequestException('the pause must end in the future');
    }
    if (until.getTime() - now > MAX_PAUSE_DAYS * 86_400_000) {
      throw new BadRequestException(
        `a pause lasts at most ${MAX_PAUSE_DAYS} days`,
      );
    }
    return this.holds.save(
      this.holds.create({
        kind: 'pause',
        changeKind,
        until,
        reason: 'paused',
        note: note?.slice(0, 1000) ?? null,
        createdBy: by,
      }),
    );
  }

  /** When a pause on this kind of change ends, or null when none is in force. */
  async pausedUntil(changeKind: string | null): Promise<Date | null> {
    if (!changeKind) return null;
    const [row] = await this.dataSource.query(
      `SELECT max("until") AS until FROM debrief_change_holds
        WHERE kind = 'pause' AND "changeKind" = $1 AND "liftedAt" IS NULL AND "until" > now()`,
      [changeKind],
    );
    return row?.until ? new Date(row.until) : null;
  }
}
