import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { DeviceTokenService } from '../../notification/service/device-token.service';
import { InAppNotificationService } from '../../notification/service/in-app-notification.service';
import { PushService } from '../../notification/service/push.service';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { DebriefRun } from '../entity/debrief-run.entity';

const DEBRIEF_CLINICAL_SIGN_OFF_KEY =
  FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF;

export const DEBRIEF_READY_NOTIFICATION = 'DEBRIEF_READY';
export const DEBRIEF_REVIEWED_NOTIFICATION = 'DEBRIEF_REVIEWED';
export const DEBRIEF_ESCALATED_NOTIFICATION = 'DEBRIEF_ESCALATED';
/** FR-54 / spec C3: promotions, reverts, filings and route-D proposals, to the owner. */
export const DEBRIEF_OWNER_NOTIFICATION = 'DEBRIEF_OWNER_ALERT';
/** Approvals in their last 3 days and urgent flags past the review deadline, to the Ally team. */
export const DEBRIEF_TEAM_NOTIFICATION = 'DEBRIEF_TEAM_ALERT';
/** The owner permission (migration 1981900730000). */
const OWNER_PERMISSION = 'manage:admin:debrief-settings';

export interface DebriefStaffAlert {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** The person who did it is not told twice. */
  excludeUserId?: number | null;
}

export interface DebriefEscalation {
  what: 'flag' | 'run';
  scenarioSessionId: string;
  note: string | null;
  by: number;
}

type Kind = 'ready' | 'reviewed';

/** v9 §7.7 microcopy, in the debrief's language; `{s}` is the roleplay's title. */
const COPY: Record<string, Record<Kind, { title: string; body: string }>> = {
  en: {
    ready: {
      title: 'Your debrief is ready',
      body: 'Your debrief for {s} is ready.',
    },
    reviewed: {
      title: 'Ally updated your debrief',
      body: 'Ally updated your debrief for {s} after a review.',
    },
  },
  hi: {
    ready: {
      title: 'आपकी डीब्रीफ़ तैयार है',
      body: '{s} के लिए आपकी डीब्रीफ़ तैयार है।',
    },
    reviewed: {
      title: 'Ally ने आपकी डीब्रीफ़ अपडेट की',
      body: 'Ally ने समीक्षा के बाद {s} के लिए आपकी डीब्रीफ़ अपडेट की है।',
    },
  },
  kn: {
    ready: {
      title: 'ನಿಮ್ಮ ಡೀಬ್ರೀಫ್ ಸಿದ್ಧವಾಗಿದೆ',
      body: '{s}ಗಾಗಿ ನಿಮ್ಮ ಡೀಬ್ರೀಫ್ ಸಿದ್ಧವಾಗಿದೆ.',
    },
    reviewed: {
      title: 'ಆಲಿ ನಿಮ್ಮ ಡೀಬ್ರೀಫ್ ಅನ್ನು ನವೀಕರಿಸಿದ್ದಾರೆ',
      body: 'ಆಲಿ ಪರಿಶೀಲನೆಯ ನಂತರ {s}ಗಾಗಿ ನಿಮ್ಮ ಡೀಬ್ರೀಫ್ ಅನ್ನು ನವೀಕರಿಸಿದ್ದಾರೆ.',
    },
  },
  mr: {
    ready: {
      title: 'तुमची डीब्रीफ तयार आहे',
      body: '{s} साठी तुमची डीब्रीफ तयार आहे.',
    },
    reviewed: {
      title: 'अ‍ॅलीने तुमची डीब्रीफ अपडेट केली आहे',
      body: 'अ‍ॅलीने पुनरावलोकनानंतर {s} साठी तुमची डीब्रीफ अपडेट केली आहे.',
    },
  },
  ta: {
    ready: {
      title: 'உங்கள் டீப்ரீஃப் தயாராக உள்ளது',
      body: '{s}க்கான உங்கள் டீப்ரீஃப் தயாராக உள்ளது.',
    },
    reviewed: {
      title: 'ஆலி உங்கள் டீப்ரீஃப்பை புதுப்பித்துள்ளார்',
      body: 'ஆலி மதிப்பாய்வுக்குப் பிறகு {s}க்கான உங்கள் டீப்ரீஃப்பை புதுப்பித்துள்ளார்.',
    },
  },
};

/**
 * Tells the learner about their debrief (v9 FR-28, FR-31): when it is ready,
 * and when the Ally team changed it after a review. An in-app notification
 * (the bell, which also links to the session) and a phone push, both in the
 * debrief's language. Never throws: a missed notification must not undo a
 * publish or a review.
 */
@Injectable()
export class DebriefNotifier {
  private readonly logger = LoggerService.getInstance(DebriefNotifier.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly inApp: InAppNotificationService,
    private readonly push: PushService,
    private readonly tokens: DeviceTokenService,
  ) {}

  ready(run: DebriefRun): Promise<void> {
    return this.notify(run, 'ready');
  }

  reviewed(run: DebriefRun): Promise<void> {
    return this.notify(run, 'reviewed');
  }

  /**
   * "Escalate to clinical advisor" (v9 FR-38): everyone who holds the
   * clinical sign-off toggle gets a bell notification that opens the Review
   * tab. Staff-facing, so English. The person escalating is not told twice.
   */
  async escalated(e: DebriefEscalation): Promise<void> {
    try {
      const advisors: { id: number; tenant_id: string }[] =
        await this.dataSource.query(
          `SELECT u.id, u.tenant_id
             FROM admin_feature_toggles t
             JOIN users u ON u.id = t."userId"
            WHERE t."featureKey" = $1 AND t.enabled = true AND u.id <> $2`,
          [DEBRIEF_CLINICAL_SIGN_OFF_KEY, e.by],
        );
      const what = e.what === 'flag' ? 'A flagged point' : 'A debrief';
      const body = e.note
        ? `${what} needs your clinical view: ${e.note}`
        : `${what} needs your clinical view.`;
      for (const a of advisors) {
        await this.inApp.create({
          userId: Number(a.id),
          tenantId: a.tenant_id,
          type: DEBRIEF_ESCALATED_NOTIFICATION,
          title: 'Escalated to you in Debriefs',
          body,
          data: {
            screen: 'DebriefReview',
            scenarioSessionId: e.scenarioSessionId,
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `[debrief] escalation notification for session ${e.scenarioSessionId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * FR-54 (spec C3): every promotion, revert (a canary's auto-revert too),
   * Builder or Bug Hunter filing and route-D proposal tells the owner — the
   * holders of `manage:admin:debrief-settings` — with an in-app notification
   * that opens the console. Staff-facing, so English. Never throws.
   */
  async owner(alert: DebriefStaffAlert): Promise<number> {
    return this.staff(
      `SELECT DISTINCT u.id, u.tenant_id
         FROM users u
         JOIN user_groups ug ON ug."userId" = u.id
         JOIN group_permissions gp ON gp."groupId" = ug."groupId"
         JOIN permissions p ON p.id = gp."permissionId"
        WHERE p.name = $1`,
      [OWNER_PERMISSION],
      DEBRIEF_OWNER_NOTIFICATION,
      alert,
    );
  }

  /**
   * The Ally team — everyone with the Debrief console (the Analytics toggle)
   * and platform access: approvals entering their last 3 days, urgent flags
   * past the review deadline. Never throws.
   */
  async team(alert: DebriefStaffAlert): Promise<number> {
    return this.staff(
      `SELECT DISTINCT u.id, u.tenant_id
         FROM admin_feature_toggles t
         JOIN users u ON u.id = t."userId"
         JOIN user_groups ug ON ug."userId" = u.id
         JOIN group_permissions gp ON gp."groupId" = ug."groupId"
         JOIN permissions p ON p.id = gp."permissionId"
        WHERE t."featureKey" = $1 AND t.enabled = true
          AND p.name = 'system:access'`,
      [FeatureToggleKey.ANALYTICS],
      DEBRIEF_TEAM_NOTIFICATION,
      alert,
    );
  }

  private async staff(
    sql: string,
    params: unknown[],
    type: string,
    alert: DebriefStaffAlert,
  ): Promise<number> {
    try {
      const people: Array<{ id: number; tenant_id: string | null }> =
        await this.dataSource.query(sql, params);
      let sent = 0;
      for (const p of people) {
        if (alert.excludeUserId && Number(p.id) === alert.excludeUserId) {
          continue;
        }
        await this.inApp.create({
          userId: Number(p.id),
          tenantId: p.tenant_id as string,
          type,
          title: alert.title.slice(0, 200),
          body: alert.body.slice(0, 1000),
          data: { screen: 'DebriefConsole', ...(alert.data ?? {}) },
        });
        sent++;
      }
      return sent;
    } catch (err) {
      this.logger.warn(
        `[debrief] ${type} notification failed: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  private async notify(run: DebriefRun, kind: Kind): Promise<void> {
    try {
      const [s] = await this.dataSource.query(
        `SELECT s."counselorId" AS user_id, s.tenant_id, sc.title
           FROM scenario_sessions s
           LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
          WHERE s.id = $1`,
        [run.scenarioSessionId],
      );
      if (!s?.user_id || !s.tenant_id) return;
      const lang = (run.language ?? 'en').slice(0, 2).toLowerCase();
      const copy = (COPY[lang] ?? COPY.en)[kind];
      const scenario = s.title ?? '';
      const body = copy.body.replace('{s}', scenario);
      const type =
        kind === 'ready'
          ? DEBRIEF_READY_NOTIFICATION
          : DEBRIEF_REVIEWED_NOTIFICATION;
      await this.inApp.create({
        userId: Number(s.user_id),
        tenantId: s.tenant_id,
        type,
        title: copy.title,
        body,
        data: {
          screen: 'SimulationFeedback',
          scenarioSessionId: run.scenarioSessionId,
        },
      });
      const tokens = await this.tokens.getTokensForUser(Number(s.user_id));
      await this.push.sendDataMessage(tokens, {
        type,
        title: copy.title,
        body,
        screen: 'SimulationFeedback',
        data: { scenarioSessionId: run.scenarioSessionId },
      });
    } catch (e) {
      this.logger.warn(
        `[debrief] ${kind} notification for run ${run.id} failed: ${(e as Error).message}`,
      );
    }
  }
}
