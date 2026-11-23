import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { templateById } from '../../chatbot/templates/templates';
import { TEMPLATE_KNOWLEDGE_TAG } from '../../knowledge-base/constants/template-knowledge';
import {
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../../knowledge-base/enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { LoggerService } from '../../logger/logger.service';
import { ChatbotTemplateInstall } from '../entity/chatbot-template-install.entity';
import type { BotDraftEntity } from '../entity/bot-draft.entity';
import { BotDraftActor } from '../enum/bot-draft.enum';
import { BotDraftService } from '../service/bot-draft.service';
import type { BotDraft, DraftEvent } from '../type/bot-draft.type';
import type { SetupAnswers } from '../../chatbot/templates/template-plan';
import type { WorkingCopyContext } from '../working-copy/working-copy.service';
import {
  LIBRARY_TEMPLATES,
  libraryTemplateById,
  type LibraryTemplate,
} from './library-templates';
import { TemplateService } from './template.service';

/**
 * Ally template chatbots (stage 3): the catalogue and copying one onto a blank chatbot.
 *
 * Applying copies the persona, rules, lists and setup answers into the working copy (through the
 * T1 install of the template's base, which brings lists, the starter checkup and a stricter pack),
 * and copies each knowledge document as a private document owned by the chatbot, queued for
 * indexing. Indexing is Ally's cost (R4): the copies carry `TEMPLATE_KNOWLEDGE_TAG`, so their first
 * ingest is recorded as `template_index` with no payer. A template works at $0; testing it needs
 * credits (stage 6 enforces that on the test).
 */
@Injectable()
export class LibraryTemplateService {
  private readonly logger = LoggerService.getInstance(
    LibraryTemplateService.name,
  );

  constructor(
    private readonly drafts: BotDraftService,
    private readonly templates: TemplateService,
    private readonly knowledge: KnowledgeBaseService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** The cards, each with its setup questions as form fields. */
  catalogue() {
    return { templates: LIBRARY_TEMPLATES.map((t) => this.card(t)) };
  }

  card(t: LibraryTemplate) {
    const base = templateById(t.base);
    return {
      id: t.id,
      version: t.version,
      name: t.name,
      oneLiner: t.oneLiner,
      for: t.for,
      tone: t.persona.tone,
      languages: t.languages,
      suggestedQuestions: t.suggestedQuestions,
      documents: t.documents.map((d) => ({ title: d.title })),
      lists: (base?.lists ?? []).map((l) => l.key),
      /**
       * Setup questions as form fields. `kind`: text, long_text, yes_no or choices. Answers go in
       * `answers` keyed by `key`; `name` (the organisation's name) is asked for every template.
       */
      fields: [
        {
          key: 'name',
          label: 'Your organisation’s name', // COPY: needs approval
          kind: 'text' as const,
          required: true,
        },
        ...(base?.setup ?? []).map((q) => ({
          key: q.key,
          label: q.ask,
          kind: q.kind,
          required: false,
          ...(q.choices ? { choices: q.choices } : {}),
          ...(q.hint ? { hint: q.hint } : {}),
        })),
      ],
    };
  }

  /**
   * Whether a template may still be applied: the chatbot was created blank and nothing has been
   * chosen or added since (no template, no source, no owner edit). A test message doesn't count.
   */
  async isBlank(draft: BotDraftEntity): Promise<boolean> {
    if (!draft.blank || !draft.chatbotId) return false;
    if (draft.source?.template || draft.source?.website) return false;
    if ((draft.draftConfig.knowledgeDocumentIds ?? []).length) return false;
    if (draft.events.some((e) => e.kind === 'patch' || e.kind === 'template')) {
      return false;
    }
    const [row] = await this.dataSource.query(
      `SELECT
         EXISTS (SELECT 1 FROM chatbot_template_installs WHERE chatbot_id = $1) AS installed,
         EXISTS (SELECT 1 FROM chatbot_documents WHERE chatbot_id = $1) AS documents`,
      [draft.chatbotId],
    );
    return !row?.installed && !row?.documents;
  }

  async apply(
    ctx: WorkingCopyContext,
    templateId: string,
    rawAnswers: SetupAnswers,
  ) {
    const template = libraryTemplateById(templateId);
    if (!template) {
      throw new BadRequestException({
        errorCode: 'unknown_template',
        message: 'That template isn’t available.',
      });
    }
    if (ctx.live || !(await this.isBlank(ctx.draft))) {
      throw new ConflictException({
        errorCode: 'not_blank',
        message:
          'A template can only be used on a new, empty assistant. Create a new one to start from a template.',
      });
    }
    const name =
      String(rawAnswers.name ?? '')
        .trim()
        .slice(0, 80) || ctx.draft.draftConfig.name;
    const { name: _name, ...answers } = rawAnswers;
    void _name;
    await this.drafts.touch(ctx.draft.id);

    // Name first, so the base install writes "{name}" into its instructions and notes.
    let draft = await this.drafts.update(ctx.draft, {
      draftConfig: {
        ...ctx.draft.draftConfig,
        name,
        assistantName: name.slice(0, 60),
        branding: {
          ...ctx.draft.draftConfig.branding,
          title: name,
          assistantName: name.slice(0, 60),
        },
      },
    });
    // The base use-case template: lists, setup answers into notes, starter checkup, pack, purpose.
    const installed = await this.templates.installOnDraft(
      draft,
      template.base,
      answers,
    );
    draft = installed.draft;

    // The library template's own persona, rules and lists of questions, over the base's.
    const fill = (text: string) => text.replace(/\{name\}/g, name);
    const config: BotDraft = {
      ...draft.draftConfig,
      introduction: fill(template.persona.greeting).slice(0, 600),
      tone: template.persona.tone,
      instructions: fill(template.persona.instructions),
      extraNever: [
        ...new Set([
          ...(draft.draftConfig.extraNever ?? []),
          ...template.rules,
        ]),
      ].slice(0, 20),
      suggestedQuestions: template.suggestedQuestions,
      declineText: template.declineText,
      // A setup answer may have chosen languages already; otherwise the template's.
      languages: chosenLanguages(
        draft.draftConfig.languages,
        template.languages,
      ),
    };
    const event: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: BotDraftActor.OWNER,
      kind: 'template',
      summary: `Set up from the ${template.name} template`,
    };
    draft = await this.drafts.update(
      draft,
      {
        draftConfig: config,
        source: {
          ...draft.source,
          template: {
            id: template.id,
            version: template.version,
            name: template.name,
          },
        },
      },
      [event],
    );
    if (template.pack) {
      draft = await this.drafts.setSafety(draft, draft.industry, template.pack);
    }

    // The knowledge: each document copied as the chatbot's own, indexed at Ally's cost.
    const documentIds: string[] = [];
    for (const document of template.documents) {
      const created = await this.knowledge.createForChatbot(ctx.chatbot.id, {
        sourceType: KbDocumentSourceType.PASTE,
        title: document.title,
        text: fill(document.text).replace(
          /\[Organisation name\]|\[Clinic name\]/g,
          name,
        ),
        tags: ['onboarding', TEMPLATE_KNOWLEDGE_TAG],
      } as never);
      await this.drafts.addKnowledgeDocument(draft.id, created.id);
      await this.drafts.attachDocument(draft, created.id);
      documentIds.push(created.id);
    }

    await this.dataSource.getRepository(ChatbotTemplateInstall).save(
      this.dataSource.getRepository(ChatbotTemplateInstall).create({
        chatbotId: ctx.chatbot.id,
        templateId: template.id,
        templateVersion: template.version,
        templateKind: 'library',
        setupAnswers: rawAnswers as Record<string, unknown>,
        added: installed.result.added,
        skipped: installed.result.skipped,
        installedBy: Number(ExecutionManager.getUserId() ?? 0) || null,
      }),
    );
    this.logger.info(
      `Library template ${template.id}@${template.version} applied to chatbot ${ctx.chatbot.id}: ${documentIds.length} documents queued`,
    );

    const sourcesIndexing = await this.indexing(documentIds);
    return {
      applied: true,
      template: {
        id: template.id,
        version: template.version,
        name: template.name,
      },
      install: installed.result,
      sourcesIndexing,
      documents: documentIds,
      draft: (await this.drafts.findById(draft.id)) ?? draft,
    };
  }

  /** How many of these documents are still being indexed. */
  private async indexing(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    try {
      const [row] = await this.dataSource.query(
        `SELECT count(*)::int AS pending FROM kb_documents
          WHERE id = ANY($1) AND status <> $2`,
        [ids, KbDocumentStatus.INDEXED],
      );
      return Number(row?.pending ?? ids.length);
    } catch {
      return ids.length;
    }
  }
}

/** The languages a setup answer chose, or the template's when none were (a new draft has `en`). */
export function chosenLanguages(
  current: string[] | undefined,
  fromTemplate: string[],
): string[] {
  const untouched =
    !current?.length || (current.length === 1 && current[0] === 'en');
  return untouched ? [...fromTemplate] : [...current!];
}
