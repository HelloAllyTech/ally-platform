import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TokenUser } from 'src/auth/type/auth.types';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { Track } from 'src/track/entity/track.entity';
import { TrackEnrollmentService } from 'src/track/service/track-enrollment.service';
import { TrackLocalizationService } from 'src/track/service/track-localization.service';
import { CourseSpine } from '../conductor/course-spine';
import { GuideConductorService } from '../conductor/guide-conductor.service';
import {
  atmosphereOf,
  decideSteer,
  releaseWindowOpen,
} from '../conductor/pacing';
import {
  GuideAllowance,
  GuideAvailability,
  GuideBootstrap,
  GuideCard as GuideCardEvent,
  GuideCrisisState,
  GuideMessageView,
  GuideNextStep,
  GuidePrefs,
  GuidePresentedCard,
  GuideSpine,
} from '../contract/generated/guide-contract';
import { GuideCard } from '../entity/guide-card.entity';
import { GuideLearnerPrefs } from '../entity/guide-learner-prefs.entity';
import { GuideMessage } from '../entity/guide-message.entity';
import { GuideThread } from '../entity/guide-thread.entity';
import {
  GuideMessageRole,
  GuideMode,
  GuideThreadStatus,
} from '../enum/guide.enum';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_POLICY,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GuideSettingsService } from '../settings/guide-settings.service';

export const DEFAULT_GUIDE_PREFS: GuidePrefs = {
  guidance: 'walk',
  voiceEnabled: false,
  sideQuests: true,
  memoryEnabled: true,
  outreach: 'in_app',
  preferClassic: false,
};

/** Messages a reload shows; older ones page in through GET …/messages. */
export const BOOTSTRAP_MESSAGE_PAGE = 50;

/**
 * Everything the journey needs to draw itself (plans/ally-guide/plan.md §9.1
 * `GET tracks/:id/bootstrap`): availability, access, the thread, the Spine,
 * the last page of messages, every card with its current state, the
 * learner's preferences and the next step. Read-only — it never creates a
 * thread or enrolls; the client does those with their own calls.
 */
@Injectable()
export class GuideViewService {
  constructor(
    private readonly settings: GuideSettingsService,
    private readonly trackEnrollment: TrackEnrollmentService,
    private readonly localization: TrackLocalizationService,
    private readonly conductor: GuideConductorService,
    private readonly releases: AgentReleaseService,
    @InjectRepository(GuideThread)
    private readonly threads: Repository<GuideThread>,
    @InjectRepository(GuideMessage)
    private readonly messages: Repository<GuideMessage>,
    @InjectRepository(GuideCard)
    private readonly cards: Repository<GuideCard>,
    @InjectRepository(GuideLearnerPrefs)
    private readonly prefs: Repository<GuideLearnerPrefs>,
    @InjectRepository(Track)
    private readonly tracks: Repository<Track>,
  ) {}

  async availability(
    trackId: string,
    tenantId?: string | null,
  ): Promise<GuideAvailability> {
    const [reason, switches, languages] = await Promise.all([
      this.settings.unavailableReason(trackId, tenantId),
      this.settings.switches(),
      this.localization
        .listLearnerLanguages(trackId)
        .catch(() => [{ languageCode: 'en' }]),
    ]);
    const guided = reason === null;
    return {
      guided,
      anonymousChat: guided && switches.anonymousChat,
      voice: guided && switches.voice,
      languages: languages.map((language) => language.languageCode),
      reason,
    };
  }

  /**
   * What an anonymous visitor's journey draws (plan §3 stages 1–2, §5.14):
   * the public outline as a Spine preview, their conversation if they have
   * started one, and their allowance. Nothing learner-specific exists yet.
   */
  async bootstrapForVisitor(
    trackId: string,
    visitor: { id: string } | null,
    allowanceOf: (
      visitorId: string,
      policy: GuideReleaseBundle['policy'],
    ) => Promise<GuideAllowance>,
  ): Promise<GuideBootstrap> {
    const availability = await this.availability(trackId, null);
    const empty: GuideBootstrap = {
      availability,
      messages: [],
      cards: [],
      prefs: { ...DEFAULT_GUIDE_PREFS },
    };
    if (!availability.anonymousChat) return empty;
    const [course, track, thread, ga] = await Promise.all([
      this.conductor.loadPublicCourse(trackId),
      this.tracks.findOne({
        where: { id: trackId },
        select: { id: true, coverImageUrl: true },
      }),
      visitor
        ? this.threads.findOne({
            where: {
              trackId,
              visitorId: visitor.id,
              status: GuideThreadStatus.ACTIVE,
            },
          })
        : null,
      this.releases.getGa(ALLY_GUIDE_AGENT_KEY),
    ]);
    const policy =
      (ga?.bundle as unknown as GuideReleaseBundle | undefined)?.policy ??
      GUIDE_DEFAULT_POLICY;
    const spine = course.spine;
    const view: GuideBootstrap = {
      ...empty,
      access: { hasAccess: false, enrolled: false, reason: null },
      course: {
        id: trackId,
        title: course.title,
        description: course.description,
        languageCode: course.languageCode,
        estimatedMinutes: spine.items.reduce(
          (sum, item) => sum + item.estimatedMinutes,
          0,
        ),
        coverImageUrl: track?.coverImageUrl ?? null,
      },
      spine: spineView(spine),
      ...(visitor ? { allowance: await allowanceOf(visitor.id, policy) } : {}),
    };
    if (!thread) return view;
    const mode = thread.mode ?? GuideMode.NORMAL;
    const [messages, cards, crisis] = await Promise.all([
      this.recentMessages(thread.id),
      this.presentedCards(thread.id),
      mode === GuideMode.CRISIS ? this.crisisOnScreen(thread.id) : null,
    ]);
    return {
      ...view,
      thread: {
        id: thread.id,
        trackId,
        mode,
        atmosphere: atmosphereOf({
          mode,
          releaseWindowOpen: false,
          spine,
        }),
        lastEventSeq: thread.lastEventSeq,
        languageCode: thread.languageCode ?? null,
      },
      messages,
      cards,
      ...(crisis ? { crisis } : {}),
    };
  }

  /** Must run inside the learner's execution context (an HTTP request). */
  async bootstrap(trackId: string, user: TokenUser): Promise<GuideBootstrap> {
    const [availability, prefs] = await Promise.all([
      this.availability(trackId, user.tenantId),
      this.prefsFor(user),
    ]);
    const empty: GuideBootstrap = {
      availability,
      messages: [],
      cards: [],
      prefs,
    };
    if (!availability.guided) return empty;

    const access = await this.trackEnrollment.getTrackAccess(trackId);
    const withAccess: GuideBootstrap = {
      ...empty,
      access: {
        hasAccess: access.hasAccess,
        enrolled: access.enrolled,
        reason: access.reason ?? null,
      },
    };
    if (!access.hasAccess) return withAccess;

    const [course, track, thread, ga] = await Promise.all([
      this.conductor.loadCourse(trackId),
      this.tracks.findOne({
        where: { id: trackId },
        select: { id: true, coverImageUrl: true },
      }),
      this.threads.findOne({
        where: {
          trackId,
          userId: user.id,
          tenantId: user.tenantId,
          status: GuideThreadStatus.ACTIVE,
        },
      }),
      this.releases.getGa(ALLY_GUIDE_AGENT_KEY),
    ]);
    const policy =
      (ga?.bundle as unknown as GuideReleaseBundle | undefined)?.policy ??
      GUIDE_DEFAULT_POLICY;
    const spine = course.spine;
    const view: GuideBootstrap = {
      ...withAccess,
      course: {
        id: trackId,
        title: course.title,
        description: course.description,
        languageCode: course.languageCode,
        estimatedMinutes: spine.items.reduce(
          (sum, item) => sum + item.estimatedMinutes,
          0,
        ),
        coverImageUrl: track?.coverImageUrl ?? null,
      },
      spine: spineView(spine),
      nextStep: nextStepFor(spine, thread, policy),
    };
    if (!thread) return view;

    const mode = thread.mode ?? GuideMode.NORMAL;
    const [messages, cards, crisis] = await Promise.all([
      this.recentMessages(thread.id),
      this.presentedCards(thread.id),
      mode === GuideMode.CRISIS ? this.crisisOnScreen(thread.id) : null,
    ]);
    return {
      ...view,
      thread: {
        id: thread.id,
        trackId,
        mode,
        atmosphere: atmosphereOf({
          mode,
          releaseWindowOpen: releaseWindowOpen(
            thread.pacing ?? {},
            policy.releaseWindowMaxTurns,
          ),
          spine,
        }),
        lastEventSeq: thread.lastEventSeq,
        languageCode: thread.languageCode ?? null,
      },
      messages,
      cards,
      ...(crisis ? { crisis } : {}),
    };
  }

  /**
   * The crisis response still on screen, for a reload while the thread is in
   * CRISIS: the card, its lines and the two buttons come back, not a feed
   * that silently lost them.
   */
  private async crisisOnScreen(
    threadId: string,
  ): Promise<GuideCrisisState | null> {
    const rows: Array<{ payload: { data?: GuideCrisisState } }> =
      await this.threads.manager.query(
        `SELECT "payload" FROM "guide_thread_events"
          WHERE "threadId" = $1 AND "type" = 'crisis.response'
          ORDER BY "seq" DESC LIMIT 1`,
        [threadId],
      );
    return rows[0]?.payload?.data ?? null;
  }

  async prefsFor(
    user: Pick<TokenUser, 'id' | 'tenantId'>,
  ): Promise<GuidePrefs> {
    const row = await this.prefs.findOne({
      where: { userId: user.id, tenantId: user.tenantId },
    });
    return { ...DEFAULT_GUIDE_PREFS, ...pickPrefs(row?.prefs ?? {}) };
  }

  async updatePrefs(
    user: Pick<TokenUser, 'id' | 'tenantId'>,
    patch: Partial<GuidePrefs>,
  ): Promise<GuidePrefs> {
    const row = await this.prefs.findOne({
      where: { userId: user.id, tenantId: user.tenantId },
    });
    const prefs = { ...(row?.prefs ?? {}), ...pickPrefs(patch) };
    await this.prefs.save({
      userId: user.id,
      tenantId: user.tenantId,
      prefs,
    });
    return { ...DEFAULT_GUIDE_PREFS, ...pickPrefs(prefs) };
  }

  private async recentMessages(threadId: string): Promise<GuideMessageView[]> {
    const rows = await this.messages.find({
      where: {
        threadId,
        role: In([GuideMessageRole.LEARNER, GuideMessageRole.ALLY]),
      },
      order: { seq: 'DESC' },
      take: BOOTSTRAP_MESSAGE_PAGE,
    });
    return rows.reverse().map(messageView);
  }

  async presentedCards(threadId: string): Promise<GuidePresentedCard[]> {
    const rows = await this.cards.find({
      where: { threadId },
      order: { presentedSeq: 'ASC', createdAt: 'ASC' },
    });
    return rows
      .filter((row) => row.presentedSeq != null)
      .map((row) => ({ seq: row.presentedSeq!, card: cardView(row) }));
  }
}

const PREF_KEYS: Array<keyof GuidePrefs> = [
  'guidance',
  'voiceEnabled',
  'sideQuests',
  'memoryEnabled',
  'outreach',
  'preferClassic',
];

function pickPrefs(source: Record<string, any>): Partial<GuidePrefs> {
  const out: Record<string, unknown> = {};
  for (const key of PREF_KEYS) {
    if (source[key] !== undefined && source[key] !== null)
      out[key] = source[key];
  }
  return out as Partial<GuidePrefs>;
}

export function spineView(spine: CourseSpine): GuideSpine {
  return {
    sections: spine.sections.map((section) => ({
      id: section.id,
      index: section.index,
      title: section.title,
      items: section.itemIds
        .map((id) => spine.items.find((item) => item.id === id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => ({
          id: item.id,
          type: item.type as any,
          title: item.title,
          state: item.state,
          minutes: item.estimatedMinutes,
          boss: item.boss,
          tension: item.tension,
          hasWarnings: item.triggerWarnings.length > 0,
          completedAt: item.completedAt,
        })),
    })),
    completed: spine.completed,
    total: spine.total,
    currentItemId: spine.current?.id ?? null,
    finished: spine.finished,
  };
}

/** The dock as the Conductor would show it now (plan §5.7, steer level). */
export function nextStepFor(
  spine: CourseSpine,
  thread: Pick<GuideThread, 'mode' | 'pacing'> | null,
  policy: Pick<typeof GUIDE_DEFAULT_POLICY, 'steer' | 'releaseWindowMaxTurns'>,
): GuideNextStep {
  const steer = decideSteer({
    mode: thread?.mode ?? GuideMode.NORMAL,
    pacing: thread?.pacing ?? {},
    spine,
    policy,
    now: Date.now(),
  });
  const current = spine.current;
  return {
    hidden: !steer.dockVisible || !current,
    itemId: current?.id ?? null,
    title: current?.title ?? null,
    minutes: current?.estimatedMinutes ?? null,
  };
}

function messageView(row: GuideMessage): GuideMessageView {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role === GuideMessageRole.LEARNER ? 'learner' : 'ally',
    kind: row.kind as GuideMessageView['kind'],
    text: row.content ?? null,
    createdAt: (row as any).createdAt
      ? new Date((row as any).createdAt).toISOString()
      : new Date(0).toISOString(),
    turnId: row.turnId ?? (row.metadata?.turnId as string | undefined) ?? null,
    ...(row.metadata?.interrupted ? { interrupted: true } : {}),
  };
}

/** The card as it was presented, with its state as it is now. */
export function cardView(row: GuideCard): GuideCardEvent {
  const presented = row.payload?.card as GuideCardEvent | undefined;
  return {
    ...(presented ?? {
      cardId: row.id,
      kind: row.kind as GuideCardEvent['kind'],
      presentation: row.presentation as GuideCardEvent['presentation'],
      title: row.title,
      framing: (row.payload?.framing as string | undefined) ?? null,
    }),
    cardId: row.id,
    state: row.state as GuideCardEvent['state'],
  };
}
