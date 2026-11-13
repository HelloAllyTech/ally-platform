/**
 * Run the conversation basics (and a bot's own cases) against one chatbot, through the same path a
 * website visitor's message takes: the engine, then the hand-over bookkeeping, with real stored
 * conversations so history and "declined twice" behave as they do live.
 *
 *   npm run chatbot:basics -- --bot <chatbot id> [--cases <file.json>] [--only <id,id>]
 *                             [--out <report.json>] [--concurrency <n>] [--keep]
 *                             [--repeat <n>] [--classifier-only]
 *
 * Each case gets its own throwaway contact and conversation, deleted at the end unless `--keep`.
 * `--repeat <n>` runs every case n times, each in a fresh conversation; the report then counts
 * crisis misses and false alarms per case and per run, and names the crisis prompt's version
 * (chunk 15a). `--classifier-only` asks the crisis classifier alone, as the engine would (no
 * keyword rules, no reply, nothing stored): fast for iterating on its prompt. The gate runs use
 * the full engine.
 * It calls the bot's models, so it costs what the same chats would. No alert is sent: alerts are
 * the channel's job, and this runner is not a channel. Meant for local and staging stacks.
 *
 * Exits 1 when a must-pass case fails.
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import {
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
} from '../../whatsapp/enum/whatsapp.enum';
import { WEB_CHANNEL } from '../bot-page/bot-page-public.service';
import { ChatbotEngineService } from '../engine/chatbot-engine.service';
import { Chatbot } from '../entity/chatbot.entity';
import { ChatbotAccessMode } from '../enum/chatbot.enum';
import {
  ConversationChannel,
  ConversationMessageRole,
} from '../enum/conversation.enum';
import { HandoverService } from '../handover/handover.service';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import { ConversationService } from '../service/conversation.service';
import { PromptSharedService } from '../../prompt/service/prompt-shared.service';
import { PLATFORM_BASICS, type BasicsCase } from './basics-cases';
import {
  countCrisis,
  crisisTotals,
  failuresOf,
  type CrisisCount,
} from './basics-evaluate';

const CRISIS_PROMPT_CODE = 'ally_ai_knowledge_crisis_classify';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
}

interface TurnReport {
  user: string;
  reply: string;
  handledBy: string;
  turnType: string | null;
  runtime: string | null;
  latencyMs: number;
  failures: string[];
  crisis: boolean;
  /** Which layer sent the crisis reply: a keyword rule (it carries a template) or the classifier. */
  crisisLayer: 'keyword' | 'classifier' | null;
}

async function main(): Promise<void> {
  const botId = arg('bot');
  if (!botId) throw new Error('--bot <chatbot id> is required');
  const extra: BasicsCase[] = arg('cases')
    ? JSON.parse(readFileSync(arg('cases')!, 'utf8'))
    : [];
  const only = arg('only')?.split(',');
  const cases = [...PLATFORM_BASICS, ...extra].filter(
    (c) => !only || only.includes(c.id),
  );
  const repeat = Math.max(1, Number(arg('repeat') ?? 1));
  const classifierOnly = process.argv.includes('--classifier-only');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const dataSource = app.get(DataSource);
  const engine = app.get(ChatbotEngineService, { strict: false });
  const handover = app.get(HandoverService, { strict: false });
  const conversations = app.get(ConversationService, { strict: false });
  const settingsService = app.get(ChatbotSettingsService, { strict: false });
  const created: { contactIds: string[]; conversationIds: string[] } = {
    contactIds: [],
    conversationIds: [],
  };

  const report: Record<string, unknown>[] = [];
  let mustPassFailed = 0;
  try {
    const stored = await dataSource
      .getRepository(Chatbot)
      .findOne({ where: { id: botId } });
    if (!stored) throw new Error(`Chatbot ${botId} not found`);
    // As the website does: the page's own gate decides who may chat, not the bot's list.
    const chatbot: Chatbot = {
      ...stored,
      accessMode: ChatbotAccessMode.ANYONE,
    };
    const settings = await settingsService.getForChatbot(chatbot);
    const runTag = randomUUID().slice(0, 8);
    const crisisPrompt = await crisisPromptVersion(
      app.get(PromptSharedService, { strict: false }),
    );
    console.log(
      `Basics for "${chatbot.name}" (${botId}), run ${runTag}, ×${repeat}` +
        `${classifierOnly ? ', classifier only' : ''}; crisis prompt ` +
        `v${crisisPrompt.version ?? '?'} (${crisisPrompt.contentHash ?? 'file default'})\n`,
    );

    const concurrency = Math.max(1, Number(arg('concurrency') ?? 4));

    /** The classifier alone on one case: each turn sees the earlier turns' messages. */
    const classifyCase = async (item: BasicsCase): Promise<TurnReport[]> => {
      const turns: TurnReport[] = [];
      const history: { role: string; content: string }[] = [];
      for (const turn of item.turns) {
        const startedAt = Date.now();
        const verdict = await engine.classifyCrisis({
          chatbot,
          settings,
          text: turn.user,
          history: [...history],
          sender: {
            externalId: `basics:${runTag}`,
            label: `basics ${item.id}`,
          },
          channel: WEB_CHANNEL,
        });
        history.push({ role: 'user', content: turn.user });
        const crisis = Boolean(verdict?.is_crisis);
        const failures: string[] = [];
        if (verdict?.failed) failures.push('the classifier did not run');
        if (turn.expect?.crisis === true && !crisis)
          failures.push('expected the crisis reply');
        if (turn.expect?.crisis === false && crisis)
          failures.push('got the crisis reply');
        turns.push({
          user: turn.user,
          reply: crisis ? `[crisis] ${verdict?.signal ?? ''}` : '',
          handledBy: crisis ? 'crisis' : 'not crisis',
          turnType: null,
          runtime: null,
          latencyMs: Date.now() - startedAt,
          failures,
          crisis,
          crisisLayer: crisis ? 'classifier' : null,
        });
      }
      return turns;
    };

    /** One case in its own throwaway conversation, turn by turn. */
    const runCase = async (
      item: BasicsCase,
      attempt: number,
    ): Promise<TurnReport[]> => {
      if (classifierOnly) return classifyCase(item);
      const externalId = `basics:${runTag}:${item.id}:${attempt}`;
      const contact = await conversations.resolveContact(
        { chatbotId: chatbot.id },
        ConversationChannel.WEB,
        externalId,
      );
      created.contactIds.push(contact.id);
      const conversation = await conversations.openConversation(
        chatbot.id,
        contact.id,
        ConversationChannel.WEB,
        { idleWindowMinutes: settings.conversationIdleMinutes },
      );
      created.conversationIds.push(conversation.id);

      const turns: TurnReport[] = [];
      for (const turn of item.turns) {
        const inbound = await conversations.appendMessage(conversation.id, {
          channel: ConversationChannel.WEB,
          direction: WaMessageDirection.INBOUND,
          role: ConversationMessageRole.USER,
          text: turn.user,
          status: WaMessageStatus.SENT,
        });
        const history = await conversations.recentHistory(conversation.id);
        const startedAt = Date.now();
        let decision = await engine.respond({
          chatbot,
          settings,
          text: turn.user,
          history,
          isFirstMessage: history.length <= 1,
          sender: { externalId, label: `basics ${item.id}` },
          channel: WEB_CHANNEL,
          conversationId: conversation.id,
          providerMessageId: inbound.id,
        });
        if (!decision.held) {
          decision = await handover.afterDecision(
            chatbot,
            conversation.id,
            decision,
          );
          await conversations.appendMessage(conversation.id, {
            channel: ConversationChannel.WEB,
            direction: WaMessageDirection.OUTBOUND,
            role: ConversationMessageRole.ASSISTANT,
            text: decision.body,
            status: WaMessageStatus.SENT,
            handledBy: decision.handledBy,
            retrievalMeta: decision.retrievalMeta ?? null,
            agentRunId: decision.agent?.runId ?? null,
            agentRuntime: decision.agent?.runtime ?? null,
            inReplyToId: inbound.id,
          });
        }
        const crisis = decision.handledBy === WaHandledBy.CRISIS;
        turns.push({
          user: turn.user,
          reply: decision.body,
          handledBy: decision.handledBy,
          turnType: decision.turnType ?? null,
          runtime: decision.agent?.runtime ?? null,
          latencyMs: Date.now() - startedAt,
          failures: failuresOf(decision, turn.expect),
          crisis,
          crisisLayer: crisis
            ? decision.templateId
              ? 'keyword'
              : 'classifier'
            : null,
        });
      }
      return turns;
    };

    // Cases are independent conversations, so several run at once; a case's own turns stay in order.
    const jobs = cases.flatMap((_, at) =>
      Array.from({ length: repeat }, (__, attempt) => ({ at, attempt })),
    );
    const results: TurnReport[][][] = cases.map(() => new Array(repeat));
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
        while (next < jobs.length) {
          const { at, attempt } = jobs[next++];
          results[at][attempt] = await runCase(cases[at], attempt);
        }
      }),
    );

    const counts: CrisisCount[] = [];
    cases.forEach((item, at) => {
      const runs = results[at];
      const failedRuns = runs.filter((turns) =>
        turns.some((t) => t.failures.length),
      ).length;
      const failed = failedRuns > 0;
      if (failed && item.mustPass) mustPassFailed++;
      const count = countCrisis(item, runs);
      counts.push(count);
      report.push({
        ...item,
        passed: !failed,
        failedRuns,
        crisis: count,
        runs,
      });
      const mark = failed ? (item.mustPass ? 'FAIL!' : 'fail ') : 'pass ';
      const tally =
        repeat > 1 ? ` [${repeat - failedRuns}/${repeat} runs passed]` : '';
      console.log(`${mark} ${item.id} (${item.kind})${tally}`);
      runs.forEach((turns, attempt) => {
        if (repeat > 1) console.log(`    run ${attempt + 1}`);
        for (const t of turns) {
          const layer = t.crisisLayer ? ` via ${t.crisisLayer}` : '';
          console.log(
            `      > ${t.user}\n      < [${t.handledBy}${layer}${t.turnType ? `/${t.turnType}` : ''}` +
              `${t.runtime ? ` ${t.runtime}` : ''} ${t.latencyMs}ms] ${t.reply.replace(/\s+/g, ' ').slice(0, 160)}` +
              (t.failures.length ? `\n      ✗ ${t.failures.join('; ')}` : ''),
          );
        }
      });
    });

    const passed = report.filter((r) => r.passed).length;
    const perRun = (pick: (c: CrisisCount) => number[]) =>
      Array.from({ length: repeat }, (_, run) =>
        counts.reduce((n, c) => n + pick(c)[run], 0),
      );
    const missesPerRun = perRun((c) => c.missesPerRun);
    const classifierFalseAlarmsPerRun = perRun(
      (c) => c.falseAlarmsPerRun.classifier,
    );
    const keywordFalseAlarmsPerRun = perRun((c) => c.falseAlarmsPerRun.keyword);
    const misses = counts.reduce((n, c) => n + c.misses, 0);
    const falseAlarms = {
      classifier: counts.reduce((n, c) => n + c.falseAlarms.classifier, 0),
      keyword: counts.reduce((n, c) => n + c.falseAlarms.keyword, 0),
    };
    const caughtBy = {
      keyword: counts.reduce((n, c) => n + c.caughtBy.keyword, 0),
      classifier: counts.reduce((n, c) => n + c.caughtBy.classifier, 0),
    };
    const named = (pick: (c: CrisisCount) => number) =>
      counts
        .filter((c) => pick(c) > 0)
        .map((c) => `${c.id} ×${pick(c)}`)
        .join(', ') || 'none';
    const ungraded = counts.filter((c) => c.ungradedCrisis > 0);
    console.log(
      `\n${passed}/${report.length} cases passed in every run; ${mustPassFailed} must-pass failed` +
        `\ncrisis misses ${misses} (per run ${missesPerRun.join(', ')}): ${named((c) => c.misses)}` +
        `\ncaught by keyword ${caughtBy.keyword}, by classifier ${caughtBy.classifier}` +
        `\nclassifier false alarms ${falseAlarms.classifier} (per run ${classifierFalseAlarmsPerRun.join(', ')}): ` +
        named((c) => c.falseAlarms.classifier) +
        `\nkeyword false alarms ${falseAlarms.keyword} (per run ${keywordFalseAlarmsPerRun.join(', ')}): ` +
        named((c) => c.falseAlarms.keyword) +
        (ungraded.length
          ? `\ncrisis replies on ungraded turns: ${ungraded.map((c) => `${c.id} ×${c.ungradedCrisis}`).join(', ')}`
          : ''),
    );
    const out = arg('out');
    if (out) {
      writeFileSync(
        out,
        JSON.stringify(
          {
            botId,
            runTag,
            at: new Date(),
            repeat,
            mode: classifierOnly ? 'classifier-only' : 'engine',
            crisisPrompt,
            crisis: {
              misses,
              missesPerRun,
              caughtBy,
              falseAlarms,
              falseAlarmsPerRun: {
                classifier: classifierFalseAlarmsPerRun,
                keyword: keywordFalseAlarmsPerRun,
              },
              byKind: crisisTotals(counts, 'kind'),
              byLanguage: crisisTotals(counts, 'lang'),
            },
            report,
          },
          null,
          2,
        ),
      );
      console.log(`Report: ${out}`);
    }
  } finally {
    if (!process.argv.includes('--keep')) {
      await removeRuns(dataSource, created);
    }
    await app.close();
  }
  // Exit explicitly: the app's queue and Redis clients keep the process alive after close().
  process.exit(mustPassFailed ? 1 : 0);
}

/** The crisis prompt's live version in the Skills Store, or nulls when only ally-ai's file runs. */
async function crisisPromptVersion(
  prompts: PromptSharedService,
): Promise<{ version: number | string | null; contentHash: string | null }> {
  try {
    const [row] =
      (await prompts.getPromptsByOptions({
        promptCode: [CRISIS_PROMPT_CODE],
      })) ?? [];
    return {
      version: row?.version ?? null,
      contentHash: row?.contentHash ?? null,
    };
  } catch {
    return { version: null, contentHash: null };
  }
}

/** Delete this run's throwaway contacts and conversations, so the inbox and metrics never see them. */
async function removeRuns(
  dataSource: DataSource,
  {
    contactIds,
    conversationIds,
  }: { contactIds: string[]; conversationIds: string[] },
): Promise<void> {
  if (!conversationIds.length && !contactIds.length) return;
  await dataSource.transaction(async (tx) => {
    if (conversationIds.length) {
      await tx.query(
        `DELETE FROM chatbot_message_feedback WHERE conversation_id = ANY($1)`,
        [conversationIds],
      );
      await tx.query(
        `DELETE FROM chatbot_messages WHERE conversation_id = ANY($1)`,
        [conversationIds],
      );
      await tx.query(`DELETE FROM chatbot_conversations WHERE id = ANY($1)`, [
        conversationIds,
      ]);
    }
    if (contactIds.length) {
      await tx.query(
        `DELETE FROM chatbot_contact_identities WHERE contact_id = ANY($1)`,
        [contactIds],
      );
      await tx.query(`DELETE FROM chatbot_contacts WHERE id = ANY($1)`, [
        contactIds,
      ]);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
