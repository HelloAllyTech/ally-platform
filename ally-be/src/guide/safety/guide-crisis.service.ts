import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { GuideCrisisResponse } from '../entity/guide-crisis-response.entity';
import {
  GuideOrgProfileValue,
  GuideSupportLine,
} from '../entity/guide-org-profile.entity';
import { GuideSignal } from '../entity/guide-signal.entity';
import { GuideCrisisScope } from '../enum/guide.enum';
import { DEFAULT_CRISIS_TEXT, resolveSupportLines } from './fixed-responses';

/** The signal kind a crisis leaves behind: who and when, never what. */
export const CRISIS_SIGNAL_KIND = 'crisis_entered';

/**
 * The crisis flow's data (plans/ally-guide/plan.md §6.3): the approved fixed
 * copy for the learner's language, the support lines to show, and a minimal
 * record that a crisis happened — thread, time, language, no content —
 * which is what keeps the week after it quiet across every course.
 * Nothing here reaches the learner's organisation.
 */
@Injectable()
export class GuideCrisisService {
  constructor(
    @InjectRepository(GuideCrisisResponse)
    private readonly responses: Repository<GuideCrisisResponse>,
    @InjectRepository(GuideSignal)
    private readonly signals: Repository<GuideSignal>,
  ) {}

  /**
   * Approved copy, most specific first: the tenant's for this language, the
   * platform's for this language, then the same for English, then the code
   * default (a placeholder until the clinical reviewer approves copy).
   */
  async responseText(
    tenantId: string | null,
    language: string,
  ): Promise<{ text: string; language: string; approved: boolean }> {
    const candidates: Array<{ scope: GuideCrisisScope; lang: string }> = [];
    for (const lang of language === 'en' ? ['en'] : [language, 'en']) {
      if (tenantId) candidates.push({ scope: GuideCrisisScope.TENANT, lang });
      candidates.push({ scope: GuideCrisisScope.PLATFORM, lang });
    }
    for (const candidate of candidates) {
      const row = await this.responses.findOne({
        where: {
          scope: candidate.scope,
          languageCode: candidate.lang,
          active: true,
          tenantId:
            candidate.scope === GuideCrisisScope.TENANT
              ? (tenantId as string)
              : IsNull(),
        },
      });
      if (row?.body?.trim()) {
        return {
          text: row.body.trim(),
          language: candidate.lang,
          approved: true,
        };
      }
    }
    return { text: DEFAULT_CRISIS_TEXT, language: 'en', approved: false };
  }

  lines(
    profile: GuideOrgProfileValue | null,
    language: string,
  ): GuideSupportLine[] {
    return resolveSupportLines(profile, language);
  }

  async record(input: {
    threadId: string;
    userId: number | null;
    visitorId?: string | null;
    tenantId: string | null;
    releaseId: string | null;
    language: string;
    source: string;
  }): Promise<void> {
    await this.signals.save(
      this.signals.create({
        kind: CRISIS_SIGNAL_KIND,
        threadId: input.threadId,
        userId: input.userId,
        visitorId: input.visitorId ?? null,
        tenantId: input.tenantId,
        releaseId: input.releaseId,
        payload: { language: input.language, source: input.source },
        // Written from this process's clock, as it is read back by
        // lastCrisisAt and compared with it.
        occurredAt: new Date(),
      }),
    );
  }

  /** The learner's most recent crisis in any course, or null. */
  async lastCrisisAt(userId: number): Promise<Date | null> {
    const row = await this.signals.findOne({
      where: { kind: CRISIS_SIGNAL_KIND, userId },
      order: { occurredAt: 'DESC' },
    });
    return row?.occurredAt ?? null;
  }
}
