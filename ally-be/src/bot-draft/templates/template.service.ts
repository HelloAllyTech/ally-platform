import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ListOwnerService } from '../../chatbot/lists/list-owner.service';
import { ListRecordsService } from '../../chatbot/lists/list-records.service';
import { HEALTH_PACKS } from '../../chatbot/lists/ready-made-lists';
import { loadList } from '../../chatbot/lists/list-store';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import {
  planInstall,
  type InstallPlan,
  type SetupAnswers,
} from '../../chatbot/templates/template-plan';
import { listDefinition } from '../../chatbot/templates/template-lists';
import {
  TEMPLATE_GROUPS,
  TEMPLATES,
  templateById,
  type UseCaseTemplate,
} from '../../chatbot/templates/templates';
import type { ChatbotSettingsOverride } from '../../chatbot/type/chatbot.type';
import { LoggerService } from '../../logger/logger.service';
import { ChatbotCheckupCase } from '../entity/chatbot-checkup.entity';
import { ChatbotTemplateInstall } from '../entity/chatbot-template-install.entity';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import {
  BotDraftActor,
  PurposeId,
  type SafetyPackId,
} from '../enum/bot-draft.enum';
import {
  cantCombinePacksText,
  packFor,
  packRequest,
} from '../safety-pack/safety-packs';
import { BotDraftPublishService } from '../service/bot-draft-publish.service';
import { BotDraftService } from '../service/bot-draft.service';
import type { DraftEvent } from '../type/bot-draft.type';

/** What happened to the safety pack. */
export type PackOutcome =
  | { outcome: 'none' }
  | { outcome: 'raised'; pack: string }
  | { outcome: 'kept'; pack: string; asked: string }
  | { outcome: 'cant_combine'; pack: string; asked: string; message: string };

export interface InstallResult {
  template: { id: string; name: string };
  /** List names added, and the ones already there, left as they were. */
  added: string[];
  skipped: string[];
  pack: PackOutcome;
  checkups: number;
  examples: number;
  /** Where people message, when the owner said (Share opens on it). */
  channels: string[] | null;
}

/** Where an assistant came from, for Overview and How it works. */
export interface TemplateOrigin {
  id: string;
  name: string;
}

/** A template's example entries the owner hasn't changed yet, per list. */
export interface ExamplesLeft {
  total: number;
  lists: { key: string; name: string; count: number }[];
}

const EXTERNAL_ID = (templateId: string, caseId: string) =>
  `template:${templateId}:${caseId}`.slice(0, 64);

/**
 * Use-case templates (T1): the catalogue, and installing one on an assistant in one transaction.
 *
 * Installing never publishes: nothing here sets an assistant's status, so it never counts against
 * the plan's published-assistant limit (CR1), and it isn't an owner-side run. A pack is applied
 * only when it is stricter than the one the assistant has (Q3-fast's `packRequest`). Every add,
 * change or cancel the lists allow still needs the person's "yes" in a later message: H1 enforces
 * that in the gateway, whatever a list's line says.
 */
@Injectable()
export class TemplateService {
  private readonly logger = LoggerService.getInstance(TemplateService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    private readonly lists: ListOwnerService,
    private readonly records: ListRecordsService,
    private readonly drafts: BotDraftService,
    private readonly publish: BotDraftPublishService,
  ) {}

  // ---- the catalogue ---------------------------------------------------------------------------

  /** The cards, in two groups, the suggested one first in its group. */
  catalogue({
    industry,
    has = [],
  }: { industry?: string | null; has?: string[] } = {}) {
    const suggested =
      (industry && TEMPLATES.find((t) => t.suggested_for.includes(industry))) ||
      null;
    const card = (t: UseCaseTemplate) => ({
      id: t.id,
      group: t.group,
      name: t.name,
      one_liner: t.one_liner,
      for: t.for,
      icon: t.icon,
      purpose: t.purpose,
      pack: t.pack ? (packFor(t.pack)?.name ?? null) : null,
      hand_over: t.hand_over,
      memory: t.memory,
      lists: t.lists.map((use) => ({
        key: use.key,
        name: listName(use.key),
        optional: Boolean(use.only_if),
        has: has.includes(use.key),
      })),
      setup: t.setup.map((q) => ({
        key: q.key,
        ask: q.ask,
        kind: q.kind,
        ...(q.choices ? { choices: q.choices } : {}),
        ...(q.hint ? { hint: q.hint } : {}),
      })),
      checkups: t.checkups.length,
      suggested: suggested?.id === t.id,
    });
    return {
      suggested: suggested?.id ?? null,
      groups: TEMPLATE_GROUPS.map((group) => {
        const items = TEMPLATES.filter((t) => t.group === group.id);
        const first = items.filter((t) => t.id === suggested?.id);
        return {
          id: group.id,
          name: group.name,
          templates: [
            ...first,
            ...items.filter((t) => t.id !== suggested?.id),
          ].map(card),
        };
      }),
    };
  }

  /** The catalogue for an assistant: what it already has, suggested from its setup's industry. */
  async catalogueFor(chatbotId: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    const [draft] = (await this.dataSource.query(
      `SELECT industry FROM bot_drafts WHERE chatbot_id = $1 ORDER BY "updatedAt" DESC LIMIT 1`,
      [chatbotId],
    )) as { industry: string | null }[];
    const has = (
      (await this.dataSource.query(
        `SELECT key FROM collections WHERE chatbot_id = $1 AND deleted_at IS NULL`,
        [chatbotId],
      )) as { key: string }[]
    ).map((r) => r.key);
    return this.catalogue({ industry: draft?.industry, has });
  }

  // ---- installing ------------------------------------------------------------------------------

  /** Tools → Add from a template: an existing assistant keeps everything it has. */
  async installOnAssistant(
    chatbotId: string,
    templateId: string,
    answers: SetupAnswers,
  ): Promise<InstallResult> {
    await this.access.assert(chatbotId, ChatbotMemberRole.OWNER);
    const template = this.templateOrRefuse(templateId);
    const draft = await this.draftOf(chatbotId);
    const { result, plan } = await this.install(chatbotId, template, answers, {
      setup: false,
    });
    // The setup answers the assistant answers from: in its owner's notes, as setup writes them.
    if (draft && plan.facts.length) {
      const config = {
        ...draft.draftConfig,
        ownerNotes: withNotes(draft.draftConfig.ownerNotes, plan.facts),
      };
      const saved = await this.drafts.update(draft, { draftConfig: config });
      const documentId = await this.publish.ownerNotes(saved, config);
      if (documentId !== (saved.source?.ownerNotesDocumentId ?? null)) {
        await this.drafts.update(saved, {
          source: { ...saved.source, ownerNotesDocumentId: documentId },
        });
      }
    }
    return result;
  }

  /** Setup: the draft takes the template's purpose, pack, instructions and languages too. */
  async installOnDraft(
    draft: BotDraftEntity,
    templateId: string,
    answers: SetupAnswers,
  ): Promise<{ result: InstallResult; draft: BotDraftEntity }> {
    if (!draft.chatbotId)
      throw new NotFoundException('That setup was not found.');
    const template = this.templateOrRefuse(templateId);
    await this.access.assert(draft.chatbotId, ChatbotMemberRole.OWNER);
    const { result, plan } = await this.install(
      draft.chatbotId,
      template,
      answers,
      {
        setup: true,
        draftPack: draft.safetyPack ? draft.draftConfig.safetyPackId : null,
      },
    );

    let fresh = (await this.drafts.findById(draft.id)) ?? draft;
    const config = fresh.draftConfig;
    const instructions = template.instructions.replace(
      /\{name\}/g,
      config.name || 'the organisation',
    );
    const event: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: BotDraftActor.OWNER,
      kind: 'template',
      summary: `Set up from ${template.name}`,
    };
    fresh = await this.drafts.update(
      fresh,
      {
        draftConfig: {
          ...config,
          purpose: template.purpose,
          purposeNote:
            template.purpose === PurposeId.CUSTOM ? config.purposeNote : '',
          instructions: config.instructions?.includes(instructions)
            ? config.instructions
            : [instructions, config.instructions?.trim()]
                .filter(Boolean)
                .join('\n\n'),
          ...(plan.languages ? { languages: plan.languages } : {}),
          ownerNotes: withNotes(config.ownerNotes, plan.facts),
          ...(template.organisation_only &&
          config.access.mode === 'invite' &&
          !config.access.emails.length &&
          !config.access.organisationIds.length
            ? { access: { ...config.access, mode: 'organisation' } }
            : {}),
        },
      },
      [event],
    );
    if (result.pack.outcome === 'raised' && plan.pack) {
      fresh = await this.drafts.setSafety(fresh, fresh.industry, plan.pack);
    }
    return { result, draft: fresh };
  }

  /**
   * Writes the plan in one transaction: the lists the assistant doesn't have yet (with their
   * switches, lines, choices and entries), hand-over, memory and the helpline number, a stricter
   * pack, the starter checkup questions and the install's record. Lists already there are named
   * and left exactly as they are.
   */
  private async install(
    chatbotId: string,
    template: UseCaseTemplate,
    answers: SetupAnswers,
    {
      setup,
      draftPack = null,
    }: { setup: boolean; draftPack?: SafetyPackId | null },
  ): Promise<{ result: InstallResult; plan: InstallPlan }> {
    const chatbot = await this.dataSource
      .getRepository(Chatbot)
      .findOneOrFail({ where: { id: chatbotId } });
    const zone = await this.lists.timeZone(chatbot);
    const plan = planInstall(template, answers, { zone });
    const userId = Number(ExecutionManager.getUserId() ?? 0) || null;

    const result = await this.dataSource.transaction(async (m) => {
      const [row] = (await m.query(
        `SELECT settings, safety_pack AS "safetyPack", rules FROM chatbots WHERE id = $1 FOR UPDATE`,
        [chatbotId],
      )) as {
        settings: ChatbotSettingsOverride | null;
        safetyPack: string | null;
        rules: Chatbot['rules'] | null;
      }[];

      // The pack: only ever stricter. On a draft, the draft's own pack is what counts.
      const current = setup
        ? draftPack
        : (row.safetyPack as SafetyPackId | null);
      const pack = this.packOutcome(current, plan.pack);
      const effectivePack =
        pack.outcome === 'raised' ? plan.pack : (current ?? null);

      // Lists: the ones already there are skipped and named, never changed.
      const fresh: InstallPlan['lists'] = [];
      const skipped: string[] = [];
      for (const list of plan.lists) {
        if (await loadList(m, chatbotId, list.use.key))
          skipped.push(list.use.key);
        else fresh.push(list);
      }
      await this.lists.createLists(
        m,
        chatbotId,
        fresh.map((l) => l.definition),
        {
          health: HEALTH_PACKS.has(effectivePack ?? ''),
          options: plan.options,
        },
      );
      let examples = 0;
      for (const { use } of fresh) {
        await this.lists.setAbilitiesIn(
          m,
          chatbotId,
          use.key,
          { find: use.find, create: use.create, update: use.update },
          use.line,
        );
      }
      for (const { use } of fresh) {
        for (const entry of plan.entries[use.key] ?? []) {
          await this.records.create(
            chatbotId,
            use.key,
            {
              kind: 'template',
              templateId: template.id,
              example: entry.example,
            },
            entry.values,
            { manager: m },
          );
          if (entry.example) examples += 1;
        }
      }

      // Settings, read again: the list switches above wrote abilities.
      const [now] = (await m.query(
        `SELECT settings FROM chatbots WHERE id = $1`,
        [chatbotId],
      )) as { settings: ChatbotSettingsOverride | null }[];
      const settings: ChatbotSettingsOverride = { ...(now?.settings ?? {}) };
      // Hand-over is only ever turned on; on an existing assistant memory stays as the owner set it.
      if (template.hand_over) {
        settings.abilities = {
          ...(settings.abilities ?? {}),
          hand_over: 'do_it',
        };
      }
      if (setup) {
        settings.memory = { ...(settings.memory ?? {}), on: template.memory };
      }
      if (plan.helpline && (setup || !settings.helplineNumbers?.trim())) {
        settings.helplineNumbers = plan.helpline;
        // Q4 G7: a template's answer isn't used in crisis replies until the owner confirms it.
        settings.helplineSource = 'template';
        settings.helplineConfirmedAt = null;
      }
      await m.query(`UPDATE chatbots SET settings = $2::jsonb WHERE id = $1`, [
        chatbotId,
        JSON.stringify(settings),
      ]);
      if (!setup && pack.outcome === 'raised' && plan.pack) {
        const next = packFor(plan.pack)!;
        await m.getRepository(Chatbot).update({ id: chatbotId }, {
          safetyPack: next.id,
          safetyPackVersion: next.version,
          rules: {
            ...(row.rules ?? { never: [] }),
            packChange: {
              from: current ?? null,
              to: next.id,
              reason: null,
              lessStrict: false,
              at: new Date().toISOString(),
              by: userId,
            },
          },
        } as never);
      }

      // Starter checkup questions: the assistant's own, kept when questions are generated again.
      const cases = m.getRepository(ChatbotCheckupCase);
      const ids = plan.cases.map((c) => EXTERNAL_ID(template.id, c.id));
      const had = new Set(
        (
          await cases.find({ where: { chatbotId }, select: ['externalId'] })
        ).map((c) => c.externalId),
      );
      const rows = plan.cases
        .filter((c, i) => !had.has(ids[i]))
        .map((c, i) =>
          cases.create({
            chatbotId,
            question: c.question,
            expect: c.expect,
            facts: c.facts,
            mustNot: c.mustNot,
            alsoOk: c.alsoOk,
            source: { kind: '' } as never,
            origin: 'generated',
            confirmed: true,
            status: 'active',
            hardFail: c.hardFail,
            tier: c.hardFail ? 'must_pass' : 'nice_to_pass',
            position: 100 + i,
            externalId: EXTERNAL_ID(template.id, c.id),
            createdBy: userId,
          }),
        );
      if (rows.length) await cases.save(rows);

      await m.getRepository(ChatbotTemplateInstall).save(
        m.getRepository(ChatbotTemplateInstall).create({
          chatbotId,
          templateId: template.id,
          setupAnswers: answers as Record<string, unknown>,
          added: fresh.map((l) => l.use.key),
          skipped,
          installedBy: userId,
        }),
      );

      return {
        template: { id: template.id, name: template.name },
        added: fresh.map((l) => l.definition.name),
        skipped: skipped.map(listName),
        pack,
        checkups: rows.length,
        examples,
        channels: plan.channels,
      } satisfies InstallResult;
    });
    this.logger.info(
      `Template ${template.id} installed on chatbot ${chatbotId}: ${result.added.length} lists added, ${result.skipped.length} kept, pack ${result.pack.outcome}`,
    );
    return { result, plan };
  }

  private packOutcome(
    current: SafetyPackId | null,
    asked: SafetyPackId | null,
  ): PackOutcome {
    if (!asked) return { outcome: 'none' };
    if (!current) return { outcome: 'raised', pack: packFor(asked)!.name };
    const decision = packRequest(current, asked);
    const now = packFor(current)!.name;
    const wanted = packFor(asked)!.name;
    if (decision === 'apply') return { outcome: 'raised', pack: wanted };
    if (decision === 'cant_combine') {
      return {
        outcome: 'cant_combine',
        pack: now,
        asked: wanted,
        message: cantCombinePacksText(current, asked),
      };
    }
    if (current === asked) return { outcome: 'none' };
    return { outcome: 'kept', pack: now, asked: wanted };
  }

  // ---- read-outs -------------------------------------------------------------------------------

  /** Overview, How it works and Share: where it came from, and the examples left. */
  async originView(chatbotId: string): Promise<{
    template: TemplateOrigin | null;
    examples_left: ExamplesLeft;
  }> {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    const [template, examples] = await Promise.all([
      this.originOf(chatbotId),
      this.examplesLeft(chatbotId),
    ]);
    return { template, examples_left: examples };
  }

  /** The template an assistant was set up from: the first one installed. */
  async originOf(
    chatbotId: string,
    m?: EntityManager,
  ): Promise<TemplateOrigin | null> {
    const [row] = (await (m ?? this.dataSource.manager).query(
      `SELECT template_id FROM chatbot_template_installs WHERE chatbot_id = $1
        ORDER BY installed_at ASC LIMIT 1`,
      [chatbotId],
    )) as { template_id: string }[];
    const template = row ? templateById(row.template_id) : undefined;
    return template ? { id: template.id, name: template.name } : null;
  }

  /** Example entries still to replace: written by a template, never changed since. */
  async examplesLeft(chatbotId: string): Promise<ExamplesLeft> {
    const rows = (await this.dataSource.query(
      `SELECT c.key, c.name, count(*)::int AS count
         FROM collection_records r JOIN collections c ON c.id = r.collection_id
        WHERE r.chatbot_id = $1 AND r.deleted_at IS NULL AND c.deleted_at IS NULL
          AND r.version = 1 AND r.created_by->>'kind' = 'template'
          AND (r.created_by->>'example')::boolean IS TRUE
        GROUP BY c.key, c.name ORDER BY c.name`,
      [chatbotId],
    )) as { key: string; name: string; count: number }[];
    return {
      total: rows.reduce((n, r) => n + r.count, 0),
      lists: rows,
    };
  }

  // ---- helpers ---------------------------------------------------------------------------------

  private templateOrRefuse(id: string): UseCaseTemplate {
    const template = templateById(id);
    if (!template) {
      throw new BadRequestException({
        errorCode: 'unknown_template',
        message: 'That template isn’t available.',
      });
    }
    return template;
  }

  private async draftOf(chatbotId: string): Promise<BotDraftEntity | null> {
    const [row] = (await this.dataSource.query(
      `SELECT id FROM bot_drafts WHERE chatbot_id = $1 ORDER BY "updatedAt" DESC LIMIT 1`,
      [chatbotId],
    )) as { id: string }[];
    return row ? this.drafts.findById(row.id) : null;
  }
}

/** A list's name by key. */
function listName(key: string): string {
  return listDefinition(key)?.name ?? key;
}

/** The owner's notes with these lines added once each. */
export function withNotes(notes: string, lines: string[]): string {
  const have = notes ?? '';
  const add = lines.filter((line) => !have.includes(line));
  return [have.trim(), ...add].filter(Boolean).join('\n');
}
