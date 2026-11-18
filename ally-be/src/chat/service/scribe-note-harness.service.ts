import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Chat } from '../entity/chat.entity';
import { ScribeNoteDraft } from '../entity/scribe-note-draft.entity';
import { NoteDraftCallbackDto } from '../dto/note-draft.dto';
import { CustomFieldsService } from '../../custom-fields/service/custom-fields.service';
import { CustomFieldDefinition } from '../../custom-fields/entity/custom-field-definition.entity';
import { PreferenceService } from '../../settings/service/preference.service';
import {
  PreferenceName,
  PreferenceRelatedEntity,
} from '../../common/constants/user.constants';

/** What ally-ai's NoteHarnessRequest expects (snake_case on the wire). */
export interface NoteHarnessRequestMessage {
  shadow: boolean;
  note_spec: {
    fields: {
      id: string;
      label: string;
      type: string;
      section?: string;
      instruction?: string;
      options: { id: string; label: string }[];
    }[];
    note_language?: string;
  };
  budget_settings?: {
    base_words: number;
    per_minute_words: number;
    cap_words: number;
  };
  context: Record<string, string>;
}

/**
 * A session number is a count, not something said in a session: the model
 * invented one when asked. It is never sent to the harness (DESIGN §6.6).
 */
const SESSION_NUMBER_LABEL = /^\s*session\s*(no\.?|number|#)\s*$/i;

/**
 * Scribe v2 note harness, ally-be side (docs/scribe-v2/DESIGN.md §6):
 * builds the request ally-ai's harness runs on — the tenant's note format as
 * a NoteSpec — and stores what comes back. Shadow mode only for now: drafts
 * are stored for comparison and never shown.
 */
@Injectable()
export class ScribeNoteHarnessService {
  private readonly logger = LoggerService.getInstance(
    ScribeNoteHarnessService.name,
  );

  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(ScribeNoteDraft)
    private readonly draftRepository: Repository<ScribeNoteDraft>,
    @Inject(forwardRef(() => CustomFieldsService))
    private readonly customFieldsService: CustomFieldsService,
    private readonly preferenceService: PreferenceService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The harness request for a chat, or undefined when its tenant hasn't got
   * the harness on. Never throws: a failure here must not hold up the v1
   * transcription it rides along with.
   */
  async buildRequest(
    chatId: number,
  ): Promise<NoteHarnessRequestMessage | undefined> {
    try {
      const chat = await this.chatRepository.findOne({
        where: { id: chatId },
        select: ['id', 'tenantId', 'createdAt'],
      });
      if (!chat?.tenantId) return undefined;
      if (!(await this.isShadowEnabled(chat.tenantId))) return undefined;

      const definitions = await this.customFieldsService.getAiDefinitions(
        chat.tenantId,
      );
      return {
        shadow: true,
        note_spec: { fields: toSpecFields(definitions) },
        context: {
          session_date: chat.createdAt
            ? new Date(chat.createdAt).toISOString().slice(0, 10)
            : '',
        },
      };
    } catch (error) {
      this.logger.warn(
        `buildRequest: chatId=${chatId} skipped the note harness: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  async isShadowEnabled(tenantId: string): Promise<boolean> {
    const preference = await this.preferenceService.getPreference(
      PreferenceName.SCRIBE_NOTE_HARNESS_SHADOW_ENABLED,
      await this.tenantCode(tenantId),
      PreferenceRelatedEntity.ORGANIZATION,
    );
    return Boolean(
      (preference?.value as { enabled?: boolean } | undefined)?.enabled,
    );
  }

  /** Store one harness report. */
  async recordDraft(dto: NoteDraftCallbackDto): Promise<void> {
    const chat = await this.chatRepository.findOne({
      where: { id: dto.chatId },
      select: ['id', 'tenantId'],
    });
    if (!chat) {
      this.logger.warn(`recordDraft: chat ${dto.chatId} not found`);
      return;
    }
    const report = dto.report ?? {};
    const draft = report.draft ?? null;
    const narrative = draft?.narrative ?? [];
    await this.draftRepository.save(
      this.draftRepository.create({
        chatId: chat.id,
        tenantId: chat.tenantId,
        shadow: dto.shadow ?? true,
        mode: report.mode ?? null,
        path: report.path ?? null,
        segments: report.segments ?? 0,
        llmCalls: report.llm_calls ?? 0,
        repaired: report.repaired ?? false,
        durationMs: report.duration_ms ?? null,
        transcriptMinutes: report.budget?.transcript_minutes ?? null,
        transcriptWords: report.budget?.transcript_words ?? null,
        narrativeWordsTarget: report.budget?.narrative_words ?? null,
        narrativeWords: draft
          ? narrative.reduce(
              (n, p) =>
                n +
                String(p.text ?? '')
                  .split(/\s+/)
                  .filter(Boolean).length,
              0,
            )
          : null,
        narrativePoints: draft ? narrative.length : null,
        fieldsFilled: draft ? Object.keys(draft.fields ?? {}).length : null,
        budget: (report.budget as Record<string, unknown>) ?? null,
        validation: report.validation ?? null,
        draft: (draft as Record<string, unknown>) ?? null,
        error: report.error ?? null,
        correlationId: dto.correlationId ?? null,
      }),
    );
    this.logger.info(
      `recordDraft: chatId=${chat.id} path=${report.path} calls=${report.llm_calls} ` +
        `repaired=${report.repaired} error=${report.error ?? 'none'} ` +
        `correlationId=${dto.correlationId}`,
    );
  }

  /** Preference rows are keyed by tenant code; chats may carry the uuid. */
  private async tenantCode(tenantId: string): Promise<string> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        tenantId,
      )
    ) {
      return tenantId;
    }
    const rows = await this.dataSource.query(
      `SELECT code FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    return rows?.[0]?.code ?? tenantId;
  }
}

/** The tenant's AI-filled definitions as NoteSpec fields. */
export function toSpecFields(
  definitions: CustomFieldDefinition[],
): NoteHarnessRequestMessage['note_spec']['fields'] {
  return definitions
    .filter((d) => !SESSION_NUMBER_LABEL.test(d.name))
    .map((d) => ({
      id: d.id,
      label: d.name,
      type: d.fieldType,
      section: d.sectionKey || undefined,
      instruction: d.aiInstruction || undefined,
      options: [...(d.options ?? [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((o) => ({ id: o.id, label: o.label })),
    }));
}
