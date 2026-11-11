import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { ChatbotMessageFeedback } from '../../chatbot/entity/chatbot-message-feedback.entity';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { WaUnansweredStatus } from '../../whatsapp/enum/whatsapp.enum';
import {
  addDays,
  CheckupTotals,
  dayOf,
  DayStats,
  sumDays,
  weekStart,
} from '../checkup/checkup-stats';
import { CheckupService } from '../checkup/checkup.service';
import type { CheckupRunView } from '../checkup/checkup.service';
import { DraftCheckupService } from '../checkup/draft-checkup.service';

/** The replies that are the assistant answering (not a crisis, a template or the consent gate). */
const ANSWER_KINDS = ['rag', 'declined', 'clarified'];
/** Most open items each Overview list shows. */
const LIST_LIMIT = 20;

/**
 * Every live number, per assistant per India day (chunk Q2a), in one query: the job writes it to
 * `chatbot_daily_stats` and the Overview runs it for today. A count's meaning is defined here and
 * nowhere else (`CHUNK-Q2A-NOTES.md` §2 lists them in plain words).
 */
const ROLLUP_SQL = `
WITH msg AS (
  SELECT c.chatbot_id,
         ((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS day,
         m.id, m.conversation_id, m.direction, m.handled_by, m.citations,
         m.retrieval_meta, m.latency_ms
    FROM chatbot_messages m
    JOIN chatbot_conversations c ON c.id = m.conversation_id
   WHERE c.chatbot_id = ANY($1::uuid[])
     AND m."createdAt" >= (($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
     AND m."createdAt" <  (($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
), answers AS (
  SELECT * FROM msg WHERE direction = 'outbound' AND handled_by = ANY($4::text[])
), thumbs AS (
  SELECT msg.chatbot_id, msg.day,
         COUNT(*) FILTER (WHERE f.rating = 'up') AS up,
         COUNT(*) FILTER (WHERE f.rating = 'down') AS down
    FROM chatbot_message_feedback f
    JOIN msg ON msg.id = f.message_id
   GROUP BY msg.chatbot_id, msg.day
)
SELECT d.chatbot_id, d.day::text AS day,
       COUNT(DISTINCT d.conversation_id) FILTER (WHERE d.direction = 'inbound') AS conversations,
       (SELECT COUNT(*) FROM answers a WHERE a.chatbot_id = d.chatbot_id AND a.day = d.day) AS answers,
       (SELECT COUNT(*) FROM answers a WHERE a.chatbot_id = d.chatbot_id AND a.day = d.day
           AND a.handled_by = 'rag' AND jsonb_typeof(a.citations) = 'array'
           AND jsonb_array_length(a.citations) > 0) AS answered_with_source,
       (SELECT COUNT(*) FROM answers a WHERE a.chatbot_id = d.chatbot_id AND a.day = d.day
           AND a.handled_by = 'declined') AS declined,
       (SELECT COUNT(*) FROM answers a WHERE a.chatbot_id = d.chatbot_id AND a.day = d.day
           AND a.handled_by = 'declined'
           AND (a.retrieval_meta->>'top_similarity')::float
               >= COALESCE((a.retrieval_meta->>'decline_similarity')::float, 1)) AS wrong_decline_suspected,
       COUNT(*) FILTER (WHERE d.direction = 'outbound' AND d.handled_by = 'human') AS handed_over,
       COUNT(*) FILTER (WHERE d.direction = 'outbound' AND d.handled_by = 'crisis') AS crisis,
       COALESCE(MAX(t.up), 0) AS thumbs_up,
       COALESCE(MAX(t.down), 0) AS thumbs_down,
       (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY a.latency_ms) FROM answers a
         WHERE a.chatbot_id = d.chatbot_id AND a.day = d.day AND a.latency_ms IS NOT NULL) AS reply_ms_p50,
       (SELECT percentile_disc(0.9) WITHIN GROUP (ORDER BY a.latency_ms) FROM answers a
         WHERE a.chatbot_id = d.chatbot_id AND a.day = d.day AND a.latency_ms IS NOT NULL) AS reply_ms_p90
  FROM msg d
  LEFT JOIN thumbs t ON t.chatbot_id = d.chatbot_id AND t.day = d.day
 GROUP BY d.chatbot_id, d.day`;

interface RollupRow {
  chatbot_id: string;
  day: string;
  [count: string]: string | number | null;
}

const toDay = (row: RollupRow): DayStats => ({
  day: row.day,
  conversations: Number(row.conversations ?? 0),
  answers: Number(row.answers ?? 0),
  answeredWithSource: Number(row.answered_with_source ?? 0),
  declined: Number(row.declined ?? 0),
  wrongDeclineSuspected: Number(row.wrong_decline_suspected ?? 0),
  handedOver: Number(row.handed_over ?? 0),
  crisis: Number(row.crisis ?? 0),
  thumbsUp: Number(row.thumbs_up ?? 0),
  thumbsDown: Number(row.thumbs_down ?? 0),
  replyMsP50: row.reply_ms_p50 === null ? null : Number(row.reply_ms_p50),
  replyMsP90: row.reply_ms_p90 === null ? null : Number(row.reply_ms_p90),
});

/** "Last checkup: {passed} of {total} answered well": the latest finished run, if any. */
function checkupCard(latest: CheckupRunView | null) {
  const accuracy = (latest?.totals as Partial<CheckupTotals> | undefined)
    ?.accuracy;
  if (!latest || latest.run.status !== 'done' || !accuracy) return null;
  return {
    passed: accuracy.passed,
    total: accuracy.total,
    at: latest.run.finishedAt,
  };
}

const empty = (day: string): DayStats => ({
  day,
  conversations: 0,
  answers: 0,
  answeredWithSource: 0,
  declined: 0,
  wrongDeclineSuspected: 0,
  handedOver: 0,
  crisis: 0,
  thumbsUp: 0,
  thumbsDown: 0,
  replyMsP50: null,
  replyMsP90: null,
});

/**
 * The live scorecard (chunk Q2a): how an assistant is doing with real people, in the checkup's
 * plain words. One service computes every number; the Overview and any export read it. Past days
 * come from `chatbot_daily_stats` (refreshed hourly for today and yesterday); today is worked
 * out on read with the same query, so nothing heavy runs on page load.
 */
@Injectable()
export class ScorecardService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(ScorecardService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly access: ChatbotAccessService,
    private readonly checkup: CheckupService,
    private readonly draftCheckup: DraftCheckupService,
    @InjectRepository(ChatbotMessageFeedback)
    private readonly feedback: Repository<ChatbotMessageFeedback>,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      'hourly',
      'assistant-daily-stats',
      async () => {
        await this.rollupRecent();
      },
    );
  }

  /** The numbers for `[from, to)` (India days), one entry per day, computed from messages. */
  async compute(
    chatbotIds: string[],
    from: string,
    to: string,
  ): Promise<Map<string, DayStats[]>> {
    const rows = (await this.dataSource.query(ROLLUP_SQL, [
      chatbotIds,
      from,
      to,
      ANSWER_KINDS,
    ])) as RollupRow[];
    const out = new Map<string, DayStats[]>();
    for (const row of rows) {
      out.set(row.chatbot_id, [...(out.get(row.chatbot_id) ?? []), toDay(row)]);
    }
    return out;
  }

  /** The job: today and yesterday, for every assistant with messages in them. */
  async rollupRecent(now = new Date()): Promise<number> {
    const today = dayOf(now);
    const from = addDays(today, -1);
    const ids = (
      (await this.dataSource.query(
        `SELECT DISTINCT c.chatbot_id FROM chatbot_conversations c
          WHERE c.last_message_at >= now() - interval '3 days'`,
      )) as { chatbot_id: string }[]
    ).map((r) => r.chatbot_id);
    if (!ids.length) return 0;
    const days = await this.compute(ids, from, addDays(today, 1));
    let written = 0;
    for (const [chatbotId, list] of days) {
      for (const d of list) {
        await this.dataSource.query(
          `INSERT INTO chatbot_daily_stats (chatbot_id, day, conversations, answers,
             answered_with_source, declined, wrong_decline_suspected, handed_over, crisis,
             thumbs_up, thumbs_down, reply_ms_p50, reply_ms_p90, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
           ON CONFLICT (chatbot_id, day) DO UPDATE SET
             conversations = EXCLUDED.conversations, answers = EXCLUDED.answers,
             answered_with_source = EXCLUDED.answered_with_source,
             declined = EXCLUDED.declined,
             wrong_decline_suspected = EXCLUDED.wrong_decline_suspected,
             handed_over = EXCLUDED.handed_over, crisis = EXCLUDED.crisis,
             thumbs_up = EXCLUDED.thumbs_up, thumbs_down = EXCLUDED.thumbs_down,
             reply_ms_p50 = EXCLUDED.reply_ms_p50, reply_ms_p90 = EXCLUDED.reply_ms_p90,
             updated_at = now()`,
          [
            chatbotId,
            d.day,
            d.conversations,
            d.answers,
            d.answeredWithSource,
            d.declined,
            d.wrongDeclineSuspected,
            d.handedOver,
            d.crisis,
            d.thumbsUp,
            d.thumbsDown,
            d.replyMsP50,
            d.replyMsP90,
          ],
        );
        written += 1;
      }
    }
    this.logger.info(`[SCORECARD] rolled up ${written} assistant-days`);
    return written;
  }

  /** `[from, to)` for one assistant: stored days, with today worked out now. */
  async days(chatbotId: string, from: string, to: string, now = new Date()) {
    const today = dayOf(now);
    const stored = (await this.dataSource.query(
      `SELECT chatbot_id, day::text AS day, conversations, answers, answered_with_source,
              declined, wrong_decline_suspected, handed_over, crisis, thumbs_up,
              thumbs_down, reply_ms_p50, reply_ms_p90
         FROM chatbot_daily_stats
        WHERE chatbot_id = $1 AND day >= $2::date AND day < $3::date AND day < $4::date`,
      [chatbotId, from, to, today],
    )) as RollupRow[];
    const byDay = new Map(stored.map((row) => [row.day, toDay(row)]));
    // Today, and any earlier day the job hasn't stored yet (a new assistant, or before the job's
    // first run), are worked out now with the same query, so a missing row never reads as zero.
    const end = to < addDays(today, 1) ? to : addDays(today, 1);
    const needed = (day: string) => day === today || !byDay.has(day);
    let first: string | null = null;
    for (let day = from; day < end && !first; day = addDays(day, 1)) {
      if (needed(day)) first = day;
    }
    if (first) {
      const live = new Map(
        (
          (await this.compute([chatbotId], first, end)).get(chatbotId) ?? []
        ).map((d) => [d.day, d]),
      );
      for (let day = first; day < end; day = addDays(day, 1)) {
        if (needed(day)) byDay.set(day, live.get(day) ?? empty(day));
      }
    }
    const out: DayStats[] = [];
    for (let day = from; day < to; day = addDays(day, 1)) {
      out.push(byDay.get(day) ?? empty(day));
    }
    return out;
  }

  /** The Overview: this week and last (Mon–Sun), the 7-day trend and what needs the owner. */
  async view(chatbotId: string, now = new Date()) {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    const today = dayOf(now);
    const thisWeek = weekStart(today);
    const lastWeek = addDays(thisWeek, -7);
    const trendFrom = addDays(today, -6);
    const from = trendFrom < lastWeek ? trendFrom : lastWeek;
    const days = await this.days(chatbotId, from, addDays(today, 1), now);
    const between = (a: string, b: string) =>
      days.filter((d) => d.day >= a && d.day < b);
    const [unanswered, unhappy, latest] = await Promise.all([
      this.openUnanswered(chatbotId),
      this.openThumbsDown(chatbotId),
      this.checkup.latestFor(chatbotId).catch(() => null),
    ]);
    return {
      thisWeek: sumDays(between(thisWeek, addDays(today, 1))),
      lastWeek: sumDays(between(lastWeek, thisWeek)),
      trend: between(trendFrom, addDays(today, 1)).map((d) => ({
        day: d.day,
        answeredPct: d.answers
          ? Math.round((d.answeredWithSource / d.answers) * 100)
          : null,
      })),
      unanswered,
      thumbsDown: unhappy,
      checkup: checkupCard(latest),
    };
  }

  private async openUnanswered(chatbotId: string) {
    return (await this.dataSource.query(
      `SELECT q.id, q.question_text AS question, q."createdAt" AS at
         FROM wa_unanswered_questions q
         JOIN chatbot_conversations c ON c.id = q.conversation_id
        WHERE c.chatbot_id = $1 AND q.status = $2
        ORDER BY q."createdAt" DESC LIMIT $3`,
      [chatbotId, WaUnansweredStatus.OPEN, LIST_LIMIT],
    )) as { id: string; question: string; at: Date }[];
  }

  /** Open thumbs-downs, newest first: what they asked, the reply, and why. */
  private async openThumbsDown(chatbotId: string) {
    return (await this.dataSource.query(
      `SELECT f.id, f.reason, f.note, f."createdAt" AS at,
              a.text AS reply, q.text AS question
         FROM chatbot_message_feedback f
         JOIN chatbot_messages a ON a.id = f.message_id
         LEFT JOIN chatbot_messages q ON q.id = a.in_reply_to_id
        WHERE f.chatbot_id = $1 AND f.rating = 'down' AND f.status = 'open'
        ORDER BY f."createdAt" DESC LIMIT $2`,
      [chatbotId, LIST_LIMIT],
    )) as {
      id: string;
      reason: string | null;
      note: string | null;
      at: Date;
      reply: string;
      question: string | null;
    }[];
  }

  /** "Answer it": the owner's answer to a question it didn't know. */
  async answerUnanswered(
    chatbotId: string,
    id: string,
    text: string,
    addToCheckup = true,
  ) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const [row] = (await this.dataSource.query(
      `SELECT q.id, q.question_text AS question FROM wa_unanswered_questions q
         JOIN chatbot_conversations c ON c.id = q.conversation_id
        WHERE q.id = $1 AND c.chatbot_id = $2`,
      [id, chatbotId],
    )) as { id: string; question: string }[];
    if (!row)
      throw new NotFoundException('That question isn’t one it was asked.');
    await this.draftCheckup.addOwnerAnswer(chatbotId, row.question, text, {
      addToCheckup,
      addedFrom: 'unanswered',
    });
    await this.dataSource.query(
      `UPDATE wa_unanswered_questions
          SET status = $2, resolution_note = 'Answered from the Overview',
              resolved_by = $3, resolved_at = now(), "updatedAt" = now()
        WHERE id = $1`,
      [id, WaUnansweredStatus.ANSWERED, this.userId()],
    );
    return { ok: true as const };
  }

  /** "Correct this" on a thumbs-down: the right answer to what they asked. */
  async correctFeedback(
    chatbotId: string,
    id: string,
    text: string,
    addToCheckup = true,
  ) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const item = await this.openFeedback(chatbotId, id);
    const [question] = (await this.dataSource.query(
      `SELECT q.text FROM chatbot_messages a
         JOIN chatbot_messages q ON q.id = a.in_reply_to_id
        WHERE a.id = $1`,
      [item.messageId],
    )) as { text: string }[];
    if (!question?.text) {
      throw new ConflictException(
        'We couldn’t find the question this answered.',
      );
    }
    await this.draftCheckup.addOwnerAnswer(chatbotId, question.text, text, {
      addToCheckup,
      addedFrom: 'thumbs_down',
    });
    await this.close(item, 'corrected');
    return { ok: true as const };
  }

  /** "It was fine": the thumbs-down leaves the list. */
  async markFine(chatbotId: string, id: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    await this.close(await this.openFeedback(chatbotId, id), 'fine');
    return { ok: true as const };
  }

  private async openFeedback(chatbotId: string, id: string) {
    const item = await this.feedback.findOne({
      where: { id, chatbotId, rating: 'down' },
    });
    if (!item) throw new NotFoundException('That rating isn’t there any more.');
    return item;
  }

  private async close(
    item: ChatbotMessageFeedback,
    status: 'fine' | 'corrected',
  ) {
    await this.feedback.update(
      { id: item.id },
      { status, handledBy: this.userId(), handledAt: new Date() },
    );
  }

  private userId(): number | null {
    return Number(ExecutionManager.getUserId() ?? 0) || null;
  }
}
