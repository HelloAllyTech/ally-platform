import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import {
  GO_LIVE_REFUSED,
  evaluateGoLive,
  normLanguage,
  type GoLiveCheck,
} from './go-live-gate';
import { SafetyStateService } from './safety-state.service';
import { enabledLanguagesOf } from '../languages/reply-language-for';
import { SWITCHES, switchOn } from './switches';
import { purposeOf } from '../../bot-draft/enum/bot-draft.enum';

interface GateChatbotRow {
  id: string;
  purpose: string | null;
  settings: Record<string, unknown> | null;
  persona: {
    defaultLanguage?: string | null;
    languages?: string[] | null;
  } | null;
}

/**
 * THE go-live check (stage 4, D10), used by every path that makes a chatbot live: publishing a
 * draft (`BotDraftPublishService.publish`), the status switch (`ChatbotService.setStatus(LIVE)`)
 * and the bot page's on/off toggle (`AssistantHomeService.saveField('pageStatus')`). One place, so
 * no path can go round it.
 *
 * `ASSISTANT_GO_LIVE_GATE_ENABLED=false` stops enforcing it (the checklist still reads).
 */
@Injectable()
export class GoLiveGateService {
  private readonly logger = LoggerService.getInstance(GoLiveGateService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly state: SafetyStateService,
    private readonly config: ConfigService,
  ) {}

  enforced(): boolean {
    return switchOn(this.config, SWITCHES.goLiveGate);
  }

  /**
   * The checklist. `override` is what the caller is about to write with the go-live (publish sets
   * the purpose from the draft), so the check reads the chatbot as it will be.
   */
  async check(
    chatbotId: string,
    override: { purpose?: string | null } = {},
  ): Promise<GoLiveCheck> {
    const [row] = (await this.dataSource.query(
      `SELECT id, purpose, settings, persona FROM chatbots WHERE id = $1`,
      [chatbotId],
    )) as GateChatbotRow[];
    if (!row) throw new NotFoundException('That assistant was not found.');
    const state = await this.state.get(chatbotId);
    return evaluateGoLive({
      chatbot: {
        ...row,
        ...(override.purpose !== undefined
          ? { purpose: override.purpose }
          : {}),
      },
      state,
      enforced: this.enforced(),
    });
  }

  /**
   * The checklist the owner sees beside Go live (TF1 S1). Go live publishes the working copy, and
   * publishing writes the working copy's purpose, so the purpose chosen in the form counts here
   * before it reaches the live row. Without a working copy, or one without a purpose, the live row's.
   */
  async checklist(chatbotId: string): Promise<GoLiveCheck> {
    const [draft] = (await this.dataSource.query(
      `SELECT draft_config FROM bot_drafts
        WHERE chatbot_id = $1 AND status <> 'abandoned'
        ORDER BY "updatedAt" DESC LIMIT 1`,
      [chatbotId],
    )) as { draft_config: Record<string, unknown> | null }[];
    const purpose = draft?.draft_config
      ? purposeOf(draft.draft_config as Parameters<typeof purposeOf>[0])
      : null;
    return this.check(chatbotId, purpose ? { purpose } : {});
  }

  /** Refuses with the missing items, before anything is written. Clears a gate pause on success. */
  async assertCanGoLive(
    chatbotId: string,
    override: { purpose?: string | null } = {},
  ): Promise<GoLiveCheck> {
    const check = await this.check(chatbotId, override);
    if (!check.ok && check.enforced) {
      throw new ConflictException({
        errorCode: 'go_live_incomplete',
        message: GO_LIVE_REFUSED,
        details: { missing: check.missing, languages: check.languages },
      });
    }
    if (check.ok) {
      await this.state
        .clearPausedByGate(chatbotId)
        .catch((error: unknown) =>
          this.logger.warn(
            `Gate pause not cleared on ${chatbotId}: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
        );
    }
    return check;
  }

  /**
   * A failed language is turned off for customers (stage 4): it leaves the chatbot's enabled
   * languages while at least one other stays, so the others still go live. Never removes the last.
   */
  async turnOffLanguage(chatbotId: string, language: string): Promise<boolean> {
    return this.dataSource.transaction(async (m) => {
      const [row] = (await m.query(
        `SELECT settings, persona FROM chatbots WHERE id = $1 FOR UPDATE`,
        [chatbotId],
      )) as Pick<GateChatbotRow, 'settings' | 'persona'>[];
      if (!row) return false;
      const enabled = enabledLanguagesOf(row as never);
      const key = normLanguage(language);
      const rest = enabled.filter((l) => normLanguage(l) !== key);
      if (rest.length === enabled.length || !rest.length) return false;
      await m.query(
        `UPDATE chatbots SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{enabledLanguages}', $2::jsonb), "updatedAt" = now()
          WHERE id = $1`,
        [chatbotId, JSON.stringify(rest)],
      );
      return true;
    });
  }
}
