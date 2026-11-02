import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { DeviceTokenService } from '../../notification/service/device-token.service';
import { InAppNotificationService } from '../../notification/service/in-app-notification.service';
import { PushService } from '../../notification/service/push.service';
import { DebriefRun } from '../entity/debrief-run.entity';

export const DEBRIEF_READY_NOTIFICATION = 'DEBRIEF_READY';
export const DEBRIEF_REVIEWED_NOTIFICATION = 'DEBRIEF_REVIEWED';

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
