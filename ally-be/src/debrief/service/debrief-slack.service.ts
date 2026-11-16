import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { SlackService } from '../../notification/service/slack.service';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefSettingsService } from './debrief-settings.service';

/** How far back the safety sweep looks for a debrief nobody posted about. */
const SAFETY_SWEEP_HOURS = 48;

/**
 * Debrief v2 Slack posts (K1–K3). The owner names the channel
 * (`slackChannel`) and the person safety posts are for (`safetyContact`);
 * both are text owner settings. Posted:
 * - when a change is undone, or taken back from its learner try-out;
 * - when a measure falls past its limit (the nightly check's alerts);
 * - a weekly summary of what changed;
 * - safety: a debrief shown with a missed clear risk cue, and a learner in
 *   distress in Ask Ally, each once, naming the safety contact.
 * With no bot token or no channel set, nothing is posted and nothing fails.
 * No learner's words leave the platform: posts say what happened and where
 * to look, never a quote.
 */
@Injectable()
export class DebriefSlackService {
  private readonly logger = LoggerService.getInstance(DebriefSlackService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: DebriefSettingsService,
    @Optional() private readonly slack?: SlackService,
    @Optional() private readonly config?: AppConfigService,
  ) {}

  /** The channel to post to, or null when posting is off. */
  private async channel(): Promise<string | null> {
    if (!this.slack || !this.config?.slack?.botToken) return null;
    const { slackChannel } = await this.settings.get();
    const c = String(slackChannel ?? '').trim();
    return c || null;
  }

  /** A plain post to the owner's channel. True when Slack accepted it. */
  async post(text: string): Promise<boolean> {
    try {
      const channel = await this.channel();
      if (!channel || !this.slack) return false;
      const r = await this.slack.sendBlocks({
        channel,
        text,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
      });
      return r.ok;
    } catch (e) {
      this.logger.warn(`[debrief] Slack post failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** A safety post (K3): the same channel, naming the safety contact first. */
  async safety(text: string): Promise<boolean> {
    const { safetyContact } = await this.settings.get();
    const who = String(safetyContact ?? '').trim();
    return this.post(`:rotating_light: ${who ? `${who} ` : ''}${text}`);
  }

  /**
   * A debrief shown with a missed clear risk cue (K3): posted once per run.
   * The run is marked first (`workspace.safetyPost`), so two replicas or a
   * later sweep never post it twice.
   */
  async missedRiskCue(run: Pick<DebriefRun, 'id'>): Promise<boolean> {
    if (!(await this.channel())) return false;
    const res = await this.dataSource.query(
      `UPDATE debrief_runs
          SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{safetyPost}',
                jsonb_build_object('at', now(), 'kind', 'missed_risk_cue'), true)
        WHERE id = $1 AND mode = 'live' AND status IN ('published','below_bar')
          AND workspace->'decision'->>'reviewReason' = 'missed_risk_cue'
          AND NOT (coalesce(workspace, '{}'::jsonb) ? 'safetyPost')
        RETURNING "scenarioSessionId" AS session`,
      [run.id],
    );
    const rows: Array<{ session: string }> = Array.isArray(res?.[0])
      ? res[0]
      : (res ?? []);
    if (!rows.length) return false;
    return this.safety(
      `A learner was shown a debrief that missed a clear risk cue in their roleplay. Please check it today: Debrief console › Sessions, session ${rows[0].session}.`,
    );
  }

  /** A learner in distress in Ask Ally (K3), once per debrief. */
  async chatDistress(run: Pick<DebriefRun, 'id' | 'scenarioSessionId'>) {
    if (!(await this.channel())) return false;
    const res = await this.dataSource.query(
      `UPDATE debrief_runs
          SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{distressPost}',
                jsonb_build_object('at', now()), true)
        WHERE id = $1 AND NOT (coalesce(workspace, '{}'::jsonb) ? 'distressPost')
        RETURNING id`,
      [run.id],
    );
    const rows = Array.isArray(res?.[0]) ? res[0] : (res ?? []);
    if (!rows.length) return false;
    return this.safety(
      `A learner showed distress while asking Ally about their debrief. They were given the support lines. Please reach out: Debrief console › Sessions, session ${run.scenarioSessionId}.`,
    );
  }

  /**
   * Safety posts a publish path did not make (a restart, a held draft shown
   * later): every debrief shown in the last two days with a missed clear risk
   * cue and no post yet. Returns how many were posted.
   */
  async sweepSafety(): Promise<number> {
    if (!(await this.channel())) return 0;
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM debrief_runs
        WHERE mode = 'live' AND status IN ('published','below_bar')
          AND workspace->'decision'->>'reviewReason' = 'missed_risk_cue'
          AND NOT (coalesce(workspace, '{}'::jsonb) ? 'safetyPost')
          AND "createdAt" >= now() - make_interval(hours => $1)
        ORDER BY "createdAt" LIMIT 20`,
      [SAFETY_SWEEP_HOURS],
    );
    let n = 0;
    for (const r of rows) if (await this.missedRiskCue(r)) n++;
    return n;
  }
}
