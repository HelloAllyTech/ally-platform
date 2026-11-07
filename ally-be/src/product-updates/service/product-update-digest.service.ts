import { Injectable } from '@nestjs/common';
import { And, IsNull, LessThan, MoreThanOrEqual, Not } from 'typeorm';

import { SESService } from 'src/aws/service/ses.service';
import dayjs, {
  BUSINESS_TIMEZONE,
  toBusinessDateString,
} from 'src/common/util/date.util';
import { RoadmapVotingAnalyticsService } from 'src/analytics/service/roadmap-voting-analytics.service';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';

import { LOW_CONFIDENCE } from '../constants/product-update.constants';
import { ProductUpdateSourceStatus } from '../entity/product-update-source.entity';
import { ProductUpdate } from '../entity/product-update.entity';
import { ProductUpdateSourceRepository } from '../repository/product-update-source.repository';
import { ProductUpdateRepository } from '../repository/product-update.repository';
import { ProductUpdateLivenessService } from './product-update-liveness.service';

/** Only updates this recent are reported; anything older (a backfill) is marked announced silently. */
const REPORT_WINDOW_MS = 36 * 60 * 60 * 1000;
const LAST_SENT_KEY = 'product-updates:digest:last-sent';

/** Email-safe design tokens: inline styles only, serif throughout. */
const FONT = "Georgia,'Times New Roman',Times,serif";
const INK = '#29261F';
const MUTED = '#6E6656';
const RULE = '#E3DBCE';
const ACCENT = '#8A4B14';
const linkStyle = `color:${ACCENT};text-decoration:underline`;

/** What a waiting deployable is called in an email a non-engineer reads. */
const DEPLOYABLE_LABELS: Record<string, string> = {
  'ally-be': 'backend',
  'ally-ai': 'AI service',
  'ally-ai-learn': 'voice agent',
  'ally-web:admin': 'admin console',
  'ally-web:helpline': 'web app',
  'ally-mobile': 'mobile store release',
};

const SURFACE_LABELS: Record<string, string> = {
  web_app: 'Web app',
  mobile_app: 'Mobile app',
  admin_console: 'Admin console',
  whatsapp: 'WhatsApp',
};

export type DigestOutcome =
  | 'disabled'
  | 'not-due'
  | 'already-sent'
  | 'not-production'
  | 'nothing-to-report'
  | 'sent'
  | 'failed';

export interface DigestContent {
  subject: string;
  html: string;
  live: ProductUpdate[];
  waiting: ProductUpdate[];
}

/**
 * The team's daily email: what reached users today, what merged but is still
 * waiting on a release, and anything worth a second look.
 *
 * The public page is highlights; this is the detail and the reasoning behind
 * them — Stacks' *Adapt stakeholder communication to their role and cadence*.
 * Sent once a day at a business-timezone hour, and only on a day with
 * something to say.
 */
@Injectable()
export class ProductUpdateDigestService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdateDigestService.name,
  );

  constructor(
    private readonly updateRepository: ProductUpdateRepository,
    private readonly sourceRepository: ProductUpdateSourceRepository,
    private readonly liveness: ProductUpdateLivenessService,
    private readonly sesService: SESService,
    private readonly configService: AppConfigService,
    private readonly redisService: RedisService,
    private readonly roadmapVoting: RoadmapVotingAnalyticsService,
  ) {}

  /** The hourly tick: sends once, in the configured business hour, if there is anything to report. */
  async sendIfDue(now: Date = new Date()): Promise<DigestOutcome> {
    const { digestTo, digestHour, digestAllowed } =
      this.configService.productUpdates;
    if (digestTo.length === 0) return 'disabled';
    if (dayjs(now).tz(BUSINESS_TIMEZONE).hour() !== digestHour)
      return 'not-due';
    if (!digestAllowed) {
      // After the hour check, so this is one line a day, not one an hour.
      this.logger.warn(
        '[PRODUCT-UPDATES] Digest skipped: PRODUCT_UPDATES_DIGEST_TO is set but this is not the production database (*_prd).',
      );
      return 'not-production';
    }

    const lockKey = `product-updates:digest:${toBusinessDateString(now)}`;
    if (!(await this.redisService.acquireLock(lockKey, 20 * 60 * 60))) {
      return 'already-sent';
    }

    try {
      const outcome = await this.send(now, digestTo);
      if (outcome === 'failed') await this.redisService.releaseLock(lockKey);
      return outcome;
    } catch (error) {
      await this.redisService.releaseLock(lockKey);
      throw error;
    }
  }

  /** Builds and sends a digest now, regardless of the hour. Used by the hourly tick and by tests. */
  async send(now: Date, to: string[]): Promise<DigestOutcome> {
    await this.silenceStale(now);
    const content = await this.build(now);
    if (!content) return 'nothing-to-report';

    try {
      await this.sesService.sendEmail({
        from: this.configService.email.sourceEmail,
        to,
        subject: content.subject,
        body: content.html,
        isHtml: true,
        purpose: 'product updates digest',
      });
    } catch (error) {
      this.logger.error(
        `[PRODUCT-UPDATES] Digest failed to send: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'failed';
    }

    for (const update of content.live) {
      update.announcedAt = now;
      update.announcedLive = true;
    }
    for (const update of content.waiting) update.announcedAt = now;
    await this.updateRepository.save([...content.live, ...content.waiting]);
    await this.redisService.set(LAST_SENT_KEY, now.toISOString());
    return 'sent';
  }

  /**
   * Marks as announced everything too old to report. Without this the first
   * digest after a backfill would list seven weeks of updates as "live today".
   */
  private async silenceStale(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - REPORT_WINDOW_MS);
    await this.updateRepository.update(
      { announcedLive: false, liveAt: And(Not(IsNull()), LessThan(cutoff)) },
      { announcedLive: true, announcedAt: now },
    );
    await this.updateRepository.update(
      {
        announcedAt: IsNull(),
        liveAt: IsNull(),
        lastMergedAt: LessThan(cutoff),
      },
      { announcedAt: now },
    );
  }

  async build(now: Date): Promise<DigestContent | null> {
    const cutoff = new Date(now.getTime() - REPORT_WINDOW_MS);
    const live = await this.updateRepository.find({
      where: { announcedLive: false, liveAt: MoreThanOrEqual(cutoff) },
      relations: { sources: true },
      order: { liveAt: 'ASC' },
    });
    const waiting = await this.updateRepository.find({
      where: {
        announcedAt: IsNull(),
        liveAt: IsNull(),
        lastMergedAt: MoreThanOrEqual(cutoff),
      },
      relations: { sources: true },
      order: { lastMergedAt: 'ASC' },
    });
    if (live.length === 0 && waiting.length === 0) return null;

    const lastSent = await this.redisService.get(LAST_SENT_KEY);
    const since = lastSent
      ? new Date(lastSent)
      : new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const noise = await this.sourceRepository.countNoiseSince(since);
    const counts = await this.sourceRepository.countByStatus();
    const backlog =
      counts[ProductUpdateSourceStatus.PENDING] +
      counts[ProductUpdateSourceStatus.ENRICHED];
    const pending = await this.liveness.pendingDeployablesFor(
      waiting.map((update) => update.id),
    );

    const livePublic = live.filter(
      (update) => update.audience === 'public' && !update.hidden,
    );
    const liveInternal = live.filter((update) => !livePublic.includes(update));
    const worthALook = livePublic.filter(
      (update) => update.confidence < LOW_CONFIDENCE,
    );

    const date = dayjs(now).tz(BUSINESS_TIMEZONE).format('ddd D MMM');
    const subject = `Ally product updates · ${date} — ${live.length} live, ${waiting.length} waiting`;
    const adminBase = this.configService.adminBaseUrl.replace(/\/$/, '');
    const editLink = (update: ProductUpdate) =>
      `${adminBase}/product-updates?update=${encodeURIComponent(update.id)}`;

    // Votes lead the email: getting more of the team voting is the point of
    // putting them here at all, and a section below the release cards is one
    // most readers never scroll to.
    const sections: string[] = [];
    const votes = await this.roadmapVotesSection(now);
    if (votes) sections.push(votes);
    sections.push(
      section(
        'Live for customers',
        livePublic,
        'Nothing new reached customers.',
        (update) => card(update, editLink(update), { showPublicSummary: true }),
      ),
    );
    if (worthALook.length) {
      sections.push(
        section(
          'Worth a second look',
          worthALook,
          '',
          (update) =>
            `<p style="margin:0 0 10px;font-size:15px;line-height:1.6"><a href="${editLink(update)}" style="${linkStyle}">${escapeHtml(update.title)}</a>, published automatically with low confidence (${Math.round(update.confidence * 100)}%). ${escapeHtml(update.decisionReason ?? '')}</p>`,
        ),
      );
    }
    sections.push(
      section(
        'Live for the team only',
        liveInternal,
        'Nothing internal went live.',
        (update) =>
          card(update, editLink(update), { showPublicSummary: false }),
      ),
    );
    sections.push(
      section(
        'Merged, waiting on a release',
        waiting,
        'Nothing waiting.',
        (update) =>
          card(update, editLink(update), {
            showPublicSummary: update.audience === 'public',
            waitingOn: (pending.get(update.id) ?? []).map(
              (deployable) => DEPLOYABLE_LABELS[deployable] ?? deployable,
            ),
          }),
      ),
    );

    const footer = [
      noise
        ? `${noise} change(s) since the last digest were tests, docs, lint or version bumps.`
        : null,
      backlog
        ? `${backlog} merge(s) are still being read and grouped; they will appear in a later digest.`
        : null,
      `Public updates appear on the changelog as soon as they are live. Edit or hide any of them in <a href="${adminBase}/product-updates" style="${linkStyle}">Admin → Product updates</a>.`,
    ]
      .filter(Boolean)
      .map(
        (line) =>
          `<p style="margin:0 0 8px;color:${MUTED};font-size:13px;line-height:1.6">${line}</p>`,
      )
      .join('');

    const html = `<div style="background:#FAF7F1;padding:24px 12px;font-family:${FONT}">
<div style="font-family:${FONT};color:${INK};max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid ${RULE};border-radius:6px;padding:32px 36px;line-height:1.6">
<p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT}">Ally · Product updates</p>
<h1 style="font-family:${FONT};font-size:26px;line-height:1.25;font-weight:normal;margin:0 0 6px">${escapeHtml(date)}</h1>
<p style="margin:0;color:${MUTED};font-size:15px">${live.length} live · ${waiting.length} waiting on a release</p>
<hr style="border:none;border-top:2px solid ${INK};margin:20px 0 0">
${sections.join('\n')}
<hr style="border:none;border-top:1px solid ${RULE};margin:32px 0 16px">
${footer}
</div>
</div>`;

    return { subject, html, live, waiting };
  }

  /**
   * "Roadmap votes this month", by name — so the team sees who is shaping the
   * roadmap, the same figures as Analytics → Highlights → Priority (AAQ-254),
   * which reads the same service.
   *
   * Voters lead, highest first, as recognition (Stacks: *Social Presence and
   * Recognition in Crowdsourced Work*). Admins who have not voted are listed
   * after, to encourage participation.
   *
   * First section of the email, but a rider on one that is going out anyway: it never makes a digest send
   * on its own, and a failure here drops the section rather than the email.
   */
  private async roadmapVotesSection(now: Date): Promise<string> {
    try {
      const data = await this.roadmapVoting.getRoadmapVoting(now);
      const month = data.months.find((m) => m.partial);
      if (!month || month.users.length === 0) return '';

      const nameOf = new Map(data.users.map((u) => [u.userId, u.name]));
      const name = (userId: number) => nameOf.get(userId) ?? `Admin #${userId}`;
      const voters = month.users
        .filter((u) => u.votes > 0)
        .sort(
          (a, b) =>
            b.votes - a.votes || name(a.userId).localeCompare(name(b.userId)),
        );
      const notYet = month.users
        .filter((u) => u.votes === 0)
        .map((u) => name(u.userId))
        .sort((a, b) => a.localeCompare(b));

      const monthName = dayjs(now).tz(BUSINESS_TIMEZONE).format('MMMM');
      const th = (label: string, align: 'left' | 'right') =>
        `<th style="padding:0 ${align === 'left' ? '16px' : '0'} 6px ${align === 'left' ? '0' : '16px'};border-bottom:1px solid ${RULE};text-align:${align};font-size:12px;font-weight:normal;color:${MUTED}">${label}</th>`;
      const cell = (content: string, last = false) =>
        `<td style="padding:7px ${last ? '0' : '16px'} 7px 0;border-bottom:1px solid ${RULE};text-align:right;font-size:15px;font-variant-numeric:tabular-nums">${content}</td>`;
      const rows = voters
        .map((u) => {
          // Share of this person's votes that went to colleagues' ideas.
          const othersShare = `${Math.round(
            ((u.votesOnOthers ?? u.votes) / u.votes) * 100,
          )}%`;
          return `<tr><td style="padding:7px 16px 7px 0;border-bottom:1px solid ${RULE};font-size:15px">${escapeHtml(name(u.userId))}</td>${cell(u.votes.toLocaleString('en-IN'))}${cell(othersShare, true)}</tr>`;
        })
        .join('');
      const table = rows
        ? `<table style="border-collapse:collapse;width:100%;font-family:${FONT}"><tr>${th('Name', 'left')}${th('Votes cast', 'right')}${th('Voters voted others share', 'right')}</tr>${rows}</table>`
        : `<p style="margin:0;color:${MUTED}">No votes cast yet this month.</p>`;
      const notYetHtml =
        notYet.length > 0
          ? `<p style="margin:12px 0 0;font-size:14px;color:${MUTED}">Not yet voted: ${escapeHtml(notYet.join(', '))}</p>`
          : '';

      return `${heading(`Roadmap votes in ${monthName} so far:`)}
${table}${notYetHtml}`;
    } catch (error) {
      this.logger.error(
        `[PRODUCT-UPDATES] Roadmap votes section skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }
}

function heading(text: string): string {
  return `<h2 style="font-family:${FONT};font-size:13px;font-weight:normal;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};margin:32px 0 6px;padding-bottom:8px;border-bottom:1px solid ${RULE}">${escapeHtml(text)}</h2>`;
}

function section<T>(
  title: string,
  items: T[],
  empty: string,
  render: (item: T) => string,
): string {
  if (items.length === 0 && !empty) return '';
  const body = items.length
    ? items.map(render).join('\n')
    : `<p style="margin:12px 0 0;color:${MUTED};font-style:italic">${escapeHtml(empty)}</p>`;
  return `${heading(`${title}${items.length ? ` (${items.length})` : ''}`)}\n${body}`;
}

/** One update: no box, just a hairline above every entry after the heading's own rule. */
function card(
  update: ProductUpdate,
  editLink: string,
  options: { showPublicSummary: boolean; waitingOn?: string[] },
): string {
  const surfaces = update.surfaces
    .map((surface) => SURFACE_LABELS[surface] ?? surface)
    .join(', ');
  const meta = [capitalise(update.kind), surfaces, update.area]
    .filter(Boolean)
    .join(' · ');
  const notes = update.teamNotes
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => `<li style="margin:0 0 4px">${escapeHtml(line)}</li>`)
    .join('');
  const links = (update.sources ?? [])
    .map((source) => {
      const label =
        source.prNumber !== null
          ? `${source.repo}#${source.prNumber}`
          : `${source.repo} push`;
      return source.prUrl
        ? `<a href="${escapeHtml(source.prUrl)}" style="${linkStyle}">${escapeHtml(label)}</a>`
        : escapeHtml(label);
    })
    .join(' · ');
  return `<div style="padding:18px 0;border-bottom:1px solid ${RULE}">
<p style="margin:0 0 2px;font-size:18px;line-height:1.35;font-weight:bold">${escapeHtml(update.title)}</p>
<p style="margin:0 0 10px;color:${MUTED};font-size:13px;font-style:italic">${escapeHtml(meta)}${
    options.waitingOn?.length
      ? ` · waiting on the ${escapeHtml(options.waitingOn.join(' and '))}`
      : ''
  }</p>
${options.showPublicSummary ? `<p style="margin:0 0 10px;font-size:16px">${escapeHtml(update.summary)}</p>` : ''}
${notes ? `<ul style="margin:0 0 10px;padding-left:20px;font-size:14px;color:#4A4538">${notes}</ul>` : ''}
<p style="margin:0;font-size:13px;color:${MUTED}">${links}${links ? ' · ' : ''}<a href="${escapeHtml(editLink)}" style="${linkStyle}">Edit</a></p>
</div>`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
