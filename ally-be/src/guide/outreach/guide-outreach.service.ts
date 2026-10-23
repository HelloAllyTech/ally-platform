import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { SESService } from 'src/aws/service/ses.service';
import { AppConfigService } from 'src/config/config.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ENGAGEMENT_REMINDER_TYPE } from 'src/engagement-reminder/constant/engagement-reminder.constant';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { LoggerService } from 'src/logger/logger.service';
import { DeviceTokenService } from 'src/notification/service/device-token.service';
import { InAppNotificationService } from 'src/notification/service/in-app-notification.service';
import { PushService } from 'src/notification/service/push.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { GuideConductorService } from '../conductor/guide-conductor.service';
import { GUIDE_AI_TASKS } from '../constants/guide-ai-tasks.constants';
import { GuideAppointment } from '../entity/guide-appointment.entity';
import { GuideLearnerPrefs } from '../entity/guide-learner-prefs.entity';
import { GuideOrgProfile } from '../entity/guide-org-profile.entity';
import { GuideOutreach } from '../entity/guide-outreach.entity';
import { GuideThread } from '../entity/guide-thread.entity';
import {
  GuideAppointmentStatus,
  GuideMode,
  GuideThreadStatus,
} from '../enum/guide.enum';
import {
  OUTREACH_OUTPUT_SCHEMA,
  OUTREACH_SYSTEM_PROMPT,
  OutreachFacts,
  buildOutreachUserMessage,
  outreachPassesLint,
  outreachTemplate,
} from '../prompts/outreach.prompt';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_POLICY,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GuideModelService } from '../runtime/guide-model.service';
import { GuideCrisisService } from '../safety/guide-crisis.service';

/** In-app notification type for Ally's reminders. */
export const GUIDE_OUTREACH_NOTIFICATION_TYPE = 'ALLY_GUIDE_OUTREACH';

/** Appendix A "Outreach". */
export const OUTREACH_RULES = {
  idleMinDays: 4,
  idleMaxDays: 21,
  perLearnerMinGapDays: 7,
  perCourseLifetime: 3,
  quietHoursStart: 10,
  quietHoursEnd: 19,
  engagementReminderGapDays: 3,
  /** An appointment more than this late (the server was down) is dropped. */
  appointmentStaleHours: 6,
  /** Where no appointment gave us their timezone (the platform's home). */
  defaultTimezone: 'Asia/Kolkata',
} as const;

const DAY_MS = 86_400_000;

type Skip = { ok: false; reason: string };
type Go = {
  ok: true;
  channels: { inApp: true; email: boolean; push: boolean };
  email: string | null;
};

/** The learner's local hour, for quiet hours (DST-correct via Intl). */
export function localHour(now: Date, timezone: string): number {
  try {
    const hour = new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(now);
    return Number(hour);
  } catch {
    return localHour(now, OUTREACH_RULES.defaultTimezone);
  }
}

/**
 * Ally's outreach (plans/ally-guide/plan.md §4.8, Appendix A, §11 I-1…I-5).
 *
 * - **The appointment** a learner set in the closing ritual gets one
 *   reminder at that time (checked every five minutes).
 * - **Without one**, one nudge per idle stretch: 4–21 days since they were
 *   last active, at most one a week per learner and three per course, only
 *   between 10:00 and 19:00 their time, and never within three days of the
 *   platform's own engagement reminder (checked hourly).
 *
 * Never to a visitor or a finished course, after a crisis (30 days) or a hard
 * moment (14 days), to a learner who opted out, or in an organisation that
 * turned outreach off. In-app always; email only when the learner chose it,
 * the organisation allows it and they have signed in with that address; push
 * best-effort. Written by a model from course facts only, linted for loss
 * and guilt, with a fixed template when either fails.
 */
@Injectable()
export class GuideOutreachService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GuideOutreachService.name,
  );

  constructor(
    @InjectRepository(GuideOutreach)
    private readonly outreach: Repository<GuideOutreach>,
    @InjectRepository(GuideAppointment)
    private readonly appointments: Repository<GuideAppointment>,
    @InjectRepository(GuideThread)
    private readonly threads: Repository<GuideThread>,
    @InjectRepository(GuideLearnerPrefs)
    private readonly prefs: Repository<GuideLearnerPrefs>,
    @InjectRepository(GuideOrgProfile)
    private readonly orgProfiles: Repository<GuideOrgProfile>,
    private readonly dataSource: DataSource,
    private readonly conductor: GuideConductorService,
    private readonly models: GuideModelService,
    private readonly releases: AgentReleaseService,
    private readonly crisis: GuideCrisisService,
    private readonly inApp: InAppNotificationService,
    private readonly devices: DeviceTokenService,
    private readonly push: PushService,
    private readonly ses: SESService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('5min', 'ally-guide-appointments', () =>
      this.runAppointments().then(() => undefined),
    );
    scheduledTaskRegistry.register('hourly', 'ally-guide-idle-nudges', () =>
      this.runIdle().then(() => undefined),
    );
  }

  /** Appointments that are due: one reminder each, or a recorded skip. */
  async runAppointments(now = new Date()): Promise<number> {
    const due: GuideAppointment[] = await this.dataSource
      .getRepository(GuideAppointment)
      .createQueryBuilder('a')
      .where('a.status = :status', { status: GuideAppointmentStatus.SCHEDULED })
      .andWhere('a.at <= now()')
      .orderBy('a.at', 'ASC')
      .limit(100)
      .getMany();
    let sent = 0;
    for (const appointment of due) {
      const stale =
        now.getTime() - new Date(appointment.at).getTime() >
        OUTREACH_RULES.appointmentStaleHours * 3_600_000;
      const thread = await this.threads.findOne({
        where: { id: appointment.threadId },
      });
      const decision: Go | Skip = stale
        ? { ok: false, reason: 'stale' }
        : thread
          ? await this.eligibility(thread, 'appointment')
          : { ok: false, reason: 'no_thread' };
      if (!decision.ok || !thread) {
        await this.record(thread, appointment.userId, {
          kind: 'appointment',
          appointmentId: appointment.id,
          status: 'skipped',
          reason: decision.ok ? 'no_thread' : decision.reason,
        });
        await this.appointments.update(appointment.id, {
          status: GuideAppointmentStatus.CANCELLED,
        });
        continue;
      }
      const delivered = await this.deliver(thread, 'appointment', decision, {
        appointmentId: appointment.id,
      });
      await this.appointments.update(appointment.id, {
        status: delivered
          ? GuideAppointmentStatus.SENT
          : GuideAppointmentStatus.CANCELLED,
      });
      if (delivered) sent++;
    }
    return sent;
  }

  /** One nudge per idle stretch, for learners with no appointment ahead. */
  async runIdle(now = new Date()): Promise<number> {
    const rules = OUTREACH_RULES;
    const candidates: GuideThread[] = await this.dataSource
      .getRepository(GuideThread)
      .createQueryBuilder('t')
      .where('t.status = :active', { active: GuideThreadStatus.ACTIVE })
      .andWhere('t.userId IS NOT NULL')
      .andWhere('t.completedAt IS NULL')
      .andWhere(
        `t."lastLearnerActivityAt" < now() - (:min || ' days')::interval`,
        { min: String(rules.idleMinDays) },
      )
      .andWhere(
        `t."lastLearnerActivityAt" > now() - (:max || ' days')::interval`,
        { max: String(rules.idleMaxDays) },
      )
      // One per idle stretch: nothing sent since they were last active.
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM "guide_outreach" o WHERE o."threadId" = t."id"
           AND o."status" = 'sent' AND o."createdAt" > t."lastLearnerActivityAt")`,
      )
      // An appointment ahead takes the place of a nudge.
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM "guide_appointments" a WHERE a."threadId" = t."id"
           AND a."status" = 'scheduled')`,
      )
      .orderBy('t."lastLearnerActivityAt"', 'ASC')
      .limit(200)
      .getMany();
    let sent = 0;
    for (const thread of candidates) {
      const timezone = await this.timezoneOf(thread.userId!);
      const hour = localHour(now, timezone);
      if (hour < rules.quietHoursStart || hour >= rules.quietHoursEnd) {
        continue; // Not now; the next hourly run looks again.
      }
      const decision = await this.eligibility(thread, 'idle');
      if (!decision.ok) continue;
      if (await this.deliver(thread, 'idle', decision, {})) sent++;
    }
    return sent;
  }

  /** The rules both kinds share, plus the idle-only frequency limits. */
  async eligibility(
    thread: GuideThread,
    kind: 'appointment' | 'idle',
  ): Promise<Go | Skip> {
    if (!thread.userId || !thread.tenantId) {
      return { ok: false, reason: 'visitor' };
    }
    if (thread.status !== GuideThreadStatus.ACTIVE || thread.completedAt) {
      return { ok: false, reason: 'course_finished' };
    }
    const policy = GUIDE_DEFAULT_POLICY;
    if (
      thread.mode === GuideMode.CRISIS ||
      thread.mode === GuideMode.CRISIS_FOLLOWUP
    ) {
      return { ok: false, reason: 'crisis_recent' };
    }
    const lastCrisis = await this.crisis.lastCrisisAt(thread.userId);
    if (
      lastCrisis &&
      Date.now() - lastCrisis.getTime() <
        policy.safety.crisisOutreachSuppressDays * DAY_MS
    ) {
      return { ok: false, reason: 'crisis_recent' };
    }
    if (
      thread.mode === GuideMode.CARE ||
      (await this.hadCareWithin(
        thread.userId,
        policy.safety.careOutreachSuppressDays,
      ))
    ) {
      return { ok: false, reason: 'care_recent' };
    }
    const [prefsRow, org, user] = await Promise.all([
      this.prefs.findOne({
        where: { userId: thread.userId, tenantId: thread.tenantId },
      }),
      this.orgProfiles.findOne({ where: { tenantId: thread.tenantId } }),
      this.dataSource
        .query(
          `SELECT "email", "lastActiveAt", "status" FROM "users" WHERE "id" = $1`,
          [thread.userId],
        )
        .then(
          (
            rows: Array<{
              email: string | null;
              lastActiveAt: Date | null;
              status: string;
            }>,
          ) => rows[0] ?? null,
        ),
    ]);
    if (!user || user.status === 'SUSPENDED') {
      return { ok: false, reason: 'inactive_account' };
    }
    const choice = prefsRow?.prefs?.outreach ?? 'in_app';
    if (choice === 'off') return { ok: false, reason: 'opted_out' };
    if (org?.profile?.outreachEnabled === false) {
      return { ok: false, reason: 'org_off' };
    }

    if (kind === 'idle') {
      const [recent] = (await this.dataSource.query(
        `SELECT
           count(*) FILTER (WHERE o."createdAt" > now() - ($2 || ' days')::interval)::int AS "lastWeek",
           count(*) FILTER (WHERE o."threadId" = $3)::int AS "thisCourse",
           (SELECT count(*)::int FROM "in_app_notifications" n
             WHERE n."userId" = $1 AND n."type" = $4
               AND n."createdAt" > now() - ($5 || ' days')::interval) AS "engagement"
         FROM "guide_outreach" o
        WHERE o."userId" = $1 AND o."status" = 'sent'`,
        [
          thread.userId,
          String(OUTREACH_RULES.perLearnerMinGapDays),
          thread.id,
          ENGAGEMENT_REMINDER_TYPE,
          String(OUTREACH_RULES.engagementReminderGapDays),
        ],
      )) as Array<{ lastWeek: number; thisCourse: number; engagement: number }>;
      if (Number(recent?.lastWeek ?? 0) > 0) {
        return { ok: false, reason: 'weekly_limit' };
      }
      if (Number(recent?.thisCourse ?? 0) >= OUTREACH_RULES.perCourseLifetime) {
        return { ok: false, reason: 'course_limit' };
      }
      if (Number(recent?.engagement ?? 0) > 0) {
        return { ok: false, reason: 'engagement_reminder_recent' };
      }
    }

    // An address they have signed in with counts as verified (plan I-1).
    const email =
      choice === 'in_app_email' &&
      org?.profile?.emailEnabled !== false &&
      user.email &&
      user.lastActiveAt
        ? user.email
        : null;
    return {
      ok: true,
      channels: { inApp: true, email: Boolean(email), push: true },
      email,
    };
  }

  private async hadCareWithin(userId: number, days: number): Promise<boolean> {
    const rows: Array<{ hit: boolean }> = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM "guide_messages" m
           JOIN "guide_threads" t ON t."id" = m."threadId"
          WHERE t."userId" = $1 AND (m."flags"->>'care')::boolean IS TRUE
            AND m."createdAt" > now() - ($2 || ' days')::interval
       ) AS "hit"`,
      [userId, String(days)],
    );
    return Boolean(rows?.[0]?.hit);
  }

  /** The learner's timezone, from their latest appointment. */
  private async timezoneOf(userId: number): Promise<string> {
    const row = await this.appointments.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
      select: { timezone: true },
    });
    return row?.timezone || OUTREACH_RULES.defaultTimezone;
  }

  /** Write, send and record one reminder. False when nothing went out. */
  private async deliver(
    thread: GuideThread,
    kind: 'appointment' | 'idle',
    decision: Go,
    extra: { appointmentId?: string },
  ): Promise<boolean> {
    const facts = await this.facts(thread, kind);
    if (!facts) {
      await this.record(thread, thread.userId!, {
        kind,
        appointmentId: extra.appointmentId ?? null,
        status: 'skipped',
        reason: 'no_next_step',
      });
      return false;
    }
    const message = await this.compose(thread, facts);
    const link = `${this.config.app.baseUrl ?? ''}/journey/${thread.trackId}?src=${kind === 'appointment' ? 'appt' : 'nudge'}`;
    const channels = { inApp: false, email: false, push: false };
    try {
      await this.inApp.create({
        userId: thread.userId!,
        tenantId: thread.tenantId!,
        type: GUIDE_OUTREACH_NOTIFICATION_TYPE,
        title: message.title,
        body: message.body,
        data: { trackId: thread.trackId, threadId: thread.id, link, kind },
      });
      channels.inApp = true;
    } catch (error) {
      this.logger.error(`Ally outreach in-app failed for ${thread.id}`, error);
      await this.record(thread, thread.userId!, {
        kind,
        appointmentId: extra.appointmentId ?? null,
        status: 'failed',
        reason: 'in_app_failed',
      });
      return false;
    }
    if (decision.email) {
      channels.email = await this.ses
        .sendEmail({
          from: this.config.email.sourceEmail,
          to: decision.email,
          subject: message.title,
          body: [
            message.body,
            '',
            link,
            '',
            'You get these because you asked Ally to remind you by email.',
            `Stop these emails: ${this.unsubscribeLink(thread.userId!, thread.tenantId!)}`,
          ].join('\n'),
          isHtml: false,
          purpose: 'ally guide reminder',
        })
        .catch(() => false);
    }
    try {
      const tokens = await this.devices.getTokensForUser(thread.userId!);
      if (tokens.length) {
        await this.push.sendDataMessage(tokens, {
          title: message.title,
          body: message.body,
          type: GUIDE_OUTREACH_NOTIFICATION_TYPE,
        });
        channels.push = true;
      }
    } catch {
      // Push is best-effort (plan §4.8).
    }
    await this.record(thread, thread.userId!, {
      kind,
      appointmentId: extra.appointmentId ?? null,
      status: 'sent',
      channels,
      title: message.title,
      body: message.body,
      writer: message.writer,
    });
    return true;
  }

  /** Course facts only, read as the learner sees the course. */
  private async facts(
    thread: GuideThread,
    kind: 'appointment' | 'idle',
  ): Promise<OutreachFacts | null> {
    const course = await ExecutionManager.runWithContext(
      async () => {
        ExecutionManager.setAuthContext(
          String(thread.userId),
          thread.tenantId!,
        );
        return this.conductor.loadCourse(thread.trackId);
      },
      { path: 'guide-outreach' },
    ).catch(() => null);
    const next = course?.spine.current;
    if (!course || !next) return null;
    const done = course.spine.items.filter(
      (item) => item.state === 'completed',
    );
    return {
      kind,
      courseTitle: course.title,
      languageCode: course.languageCode,
      completed: course.spine.completed,
      total: course.spine.total,
      lastCompletedTitle: done.length ? done[done.length - 1].title : null,
      nextTitle: next.title,
      nextMinutes: next.estimatedMinutes,
    };
  }

  private async compose(
    thread: GuideThread,
    facts: OutreachFacts,
  ): Promise<{ title: string; body: string; writer: 'model' | 'template' }> {
    try {
      const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
      const bundle = ga?.bundle as unknown as GuideReleaseBundle | undefined;
      if (bundle) {
        const { result } = await this.models.complete({
          role: 'outreach_writer',
          bundle,
          task: LlmTask.GUIDE_OUTREACH,
          aiTaskId: GUIDE_AI_TASKS.OUTREACH,
          attribution: {
            threadId: thread.id,
            userId: thread.userId,
            tenantId: thread.tenantId,
            releaseId: ga!.id,
          },
          request: {
            system: [
              {
                text:
                  bundle.prompts.outreach_writer?.text ??
                  OUTREACH_SYSTEM_PROMPT,
                cache: true,
              },
            ],
            messages: [
              { role: 'user', content: buildOutreachUserMessage(facts) },
            ],
            // Room for thinking before a two-sentence answer: a reasoning
            // model spent all of 1,500 on thinking and wrote nothing.
            maxTokens: 4_000,
            outputSchema: OUTREACH_OUTPUT_SCHEMA as unknown as Record<
              string,
              unknown
            >,
            timeoutMs: 20_000,
          },
        });
        if (result.stopReason !== 'end_turn') {
          throw new Error(`writer stopped with ${result.stopReason}`);
        }
        const text = result.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('');
        const parsed = JSON.parse(text) as { title?: string; body?: string };
        const candidate = {
          title: String(parsed.title ?? '').trim(),
          body: String(parsed.body ?? '').trim(),
        };
        if (outreachPassesLint(candidate)) {
          return { ...candidate, writer: 'model' };
        }
        this.logger.warn(`Ally outreach text failed the lint for ${thread.id}`);
      }
    } catch (error) {
      this.logger.warn(`Ally outreach writer failed: ${String(error)}`);
    }
    return { ...outreachTemplate(facts), writer: 'template' };
  }

  private async record(
    thread: GuideThread | null,
    userId: number,
    row: Partial<GuideOutreach> & {
      kind: 'appointment' | 'idle';
      status: 'sent' | 'skipped' | 'failed';
    },
  ): Promise<void> {
    if (!thread) return;
    await this.outreach.save(
      this.outreach.create({
        threadId: thread.id,
        userId,
        trackId: thread.trackId,
        tenantId: thread.tenantId ?? null,
        channels: {},
        ...row,
      }),
    );
  }

  // ── The signed unsubscribe link (plan §11 I-2) ─────────────────────────

  private signature(userId: number, tenantId: string): string {
    return createHmac(
      'sha256',
      `ally-guide-unsubscribe:${this.config.jwt.accessToken.secret ?? ''}`,
    )
      .update(`${userId}:${tenantId}`)
      .digest('base64url');
  }

  unsubscribeLink(userId: number, tenantId: string): string {
    const query = new URLSearchParams({
      u: String(userId),
      t: tenantId,
      s: this.signature(userId, tenantId),
    });
    return `${this.config.publicApiBaseUrl}/api/v1/guide/public/outreach/unsubscribe?${query.toString()}`;
  }

  /** Turn reminders off from the email link. Nothing to sign in to. */
  async unsubscribe(input: {
    u: string;
    t: string;
    s: string;
  }): Promise<boolean> {
    const userId = Number(input.u);
    if (!Number.isInteger(userId) || !input.t || !input.s) return false;
    const expected = Buffer.from(this.signature(userId, input.t));
    const given = Buffer.from(input.s);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return false;
    }
    const existing = await this.prefs.findOne({
      where: { userId, tenantId: input.t },
    });
    await this.prefs.save({
      ...(existing ?? { userId, tenantId: input.t }),
      prefs: { ...(existing?.prefs ?? {}), outreach: 'off' },
    } as GuideLearnerPrefs);
    return true;
  }
}
