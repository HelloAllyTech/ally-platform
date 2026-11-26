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
import { assistantZone } from '../../chatbot/agent-tools/list-tools';
import { ERASED_TEXT } from '../../chatbot/privacy/erased';
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
import {
  safeCount,
  suppressBreakdown,
  topUnanswered,
  type UnansweredInput,
} from './overview-suppression';

export const OVERVIEW_RANGES = [7, 30, 90] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

/** The replies that are the assistant answering (not a crisis, a template or the consent gate). */
const ANSWER_KINDS = ['rag', 'declined', 'clarified'];
/** Most open items each Overview list shows. */
const LIST_LIMIT = 20;

/**
 * Whether an unanswered question `q` was a step of a list action (Q3d; prod 18 Nov): the assistant
 * used a list tool (find, create or change) in this turn, or in the turn before when this message
 * answers the assistant's question ("Shall I book it?" → "Yes go ahead."). Hand-overs don't count.
 */
const BOOKING_STEP = `EXISTS (
  SELECT 1
    FROM chatbot_messages m
    LEFT JOIN LATERAL (
      SELECT a.text FROM chatbot_messages a
       WHERE a.conversation_id = m.conversation_id AND a.direction = 'outbound'
         AND a."createdAt" < m."createdAt"
       ORDER BY a."createdAt" DESC LIMIT 1) asked ON true
    JOIN tool_runs t ON t.chatbot_id = c.chatbot_id
                    AND t.conversation_id = q.conversation_id::text
   WHERE m.id = q.message_id
     AND t.tool ~ '^(find|create|update)_'
     AND t."createdAt" >= CASE WHEN rtrim(asked.text) LIKE '%?' THEN COALESCE((
           SELECT p."createdAt" FROM chatbot_messages p
            WHERE p.conversation_id = m.conversation_id AND p.direction = 'inbound'
              AND p."createdAt" < m."createdAt"
            ORDER BY p."createdAt" DESC LIMIT 1), '-infinity') ELSE m."createdAt" END
     AND t."createdAt" < COALESCE((
           SELECT n."createdAt" FROM chatbot_messages n
            WHERE n.conversation_id = m.conversation_id AND n.direction = 'inbound'
              AND n."createdAt" > m."createdAt"
            ORDER BY n."createdAt" ASC LIMIT 1), 'infinity'))`;

/**
 * Every live number, per assistant per India day (chunk Q2a), in one query: the job writes it to
 * `chatbot_daily_stats` and the Overview runs it for today. A count's meaning is defined here and
 * nowhere else (`CHUNK-Q2A-NOTES.md` §2 lists them in plain words).
 */
const ROLLUP_SQL = `
WITH bots AS (
  -- Each assistant's own day boundaries (its time zone setting, else its hand-over hours' zone,
  -- else Asia/Kolkata): a zone Postgres doesn't know falls back to India rather than failing.
  SELECT ch.id AS chatbot_id,
         COALESCE((SELECT z.name FROM pg_timezone_names z
                    WHERE z.name = COALESCE(NULLIF(ch.settings->>'timeZone', ''),
                                            NULLIF(ch.settings->'handover'->'hours'->>'timeZone', ''))
                    LIMIT 1), 'Asia/Kolkata') AS tz
    FROM chatbots ch
   WHERE ch.id = ANY($1::uuid[])
), msg AS (
  SELECT c.chatbot_id, c.contact_id, b.tz,
         ((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE b.tz)::date AS day,
         m.id, m.conversation_id, m.direction, m.handled_by, m.citations,
         m.retrieval_meta, m.latency_ms
    FROM chatbot_messages m
    JOIN chatbot_conversations c ON c.id = m.conversation_id
    JOIN bots b ON b.chatbot_id = c.chatbot_id
   WHERE m."createdAt" >= (($2::date)::timestamp AT TIME ZONE b.tz) AT TIME ZONE 'UTC'
     AND m."createdAt" <  (($3::date)::timestamp AT TIME ZONE b.tz) AT TIME ZONE 'UTC'
     -- TF1 round 2 (Sahyog P2): a message the person erased ("Forget me") is not counted: its
     -- citations are gone, so it read as an answer not from your information.
     AND m.text IS DISTINCT FROM '${ERASED_TEXT}'
), waits AS (
  -- Chats that needed a person (asked, declined twice, passed on, or a crisis flag) on that day,
  -- and the minutes until a person's first reply. Unanswered ones are left out, not counted as 0.
  SELECT c.chatbot_id,
         ((s.since AT TIME ZONE 'UTC') AT TIME ZONE b.tz)::date AS day,
         EXTRACT(EPOCH FROM (r.first_reply - s.since)) / 60.0 AS minutes
    FROM chatbot_conversations c
    JOIN bots b ON b.chatbot_id = c.chatbot_id
   CROSS JOIN LATERAL (SELECT LEAST(c.needs_person_since, c.safety_first_at) AS since) s
   CROSS JOIN LATERAL (
     SELECT MIN(h."createdAt") AS first_reply
       FROM chatbot_messages h
      WHERE h.conversation_id = c.id AND h.direction = 'outbound'
        AND h.handled_by = 'human' AND h."createdAt" >= s.since) r
   WHERE s.since IS NOT NULL AND r.first_reply IS NOT NULL
     AND s.since >= (($2::date)::timestamp AT TIME ZONE b.tz) AT TIME ZONE 'UTC'
     AND s.since <  (($3::date)::timestamp AT TIME ZONE b.tz) AT TIME ZONE 'UTC'
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
       COUNT(DISTINCT d.contact_id) FILTER (WHERE d.direction = 'inbound') AS people,
       (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY w.minutes))::int
          FROM waits w WHERE w.chatbot_id = d.chatbot_id AND w.day = d.day) AS handover_wait_p50,
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
       -- Chats handed to a person that day (chunk 6b): the assistant's hand-over message, sent
       -- when someone asked, when the assistant passed it on, or after a second "I don't know".
       -- Not the team's replies, which it counted before.
       COUNT(DISTINCT d.conversation_id) FILTER (
         WHERE d.direction = 'outbound' AND d.handled_by = 'handover') AS handed_over,
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
  people: Number(row.people ?? 0),
  handoverWaitP50:
    row.handover_wait_p50 == null ? null : Number(row.handover_wait_p50),
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
    // Q3-fast Part 3: "X need a fix" while below the publish gate, live assistants included.
    ready: latest.gate?.ready ?? null,
    needFix: latest.gate?.needFix ?? null,
  };
}

const empty = (day: string): DayStats => ({
  day,
  conversations: 0,
  people: 0,
  handoverWaitP50: null,
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
    // Every zone is within a day of India, so two days either side covers each assistant's
    // today and yesterday; later days are empty and written as nothing.
    const today = dayOf(now);
    const from = addDays(today, -2);
    const ids = (
      (await this.dataSource.query(
        `SELECT DISTINCT c.chatbot_id FROM chatbot_conversations c
          WHERE c.last_message_at >= now() - interval '3 days'`,
      )) as { chatbot_id: string }[]
    ).map((r) => r.chatbot_id);
    if (!ids.length) return 0;
    const days = await this.compute(ids, from, addDays(today, 2));
    let written = 0;
    for (const [chatbotId, list] of days) {
      for (const d of list) {
        await this.dataSource.query(
          `INSERT INTO chatbot_daily_stats (chatbot_id, day, conversations, answers,
             answered_with_source, declined, wrong_decline_suspected, handed_over, crisis,
             thumbs_up, thumbs_down, reply_ms_p50, reply_ms_p90, people, handover_wait_p50,
             updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
           ON CONFLICT (chatbot_id, day) DO UPDATE SET
             conversations = EXCLUDED.conversations, answers = EXCLUDED.answers,
             people = EXCLUDED.people, handover_wait_p50 = EXCLUDED.handover_wait_p50,
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
            d.people,
            d.handoverWaitP50,
          ],
        );
        written += 1;
      }
    }
    this.logger.info(`[SCORECARD] rolled up ${written} assistant-days`);
    return written;
  }

  /** The assistant's own time zone: its setting, else its hand-over hours' zone, else India. */
  async zoneOf(chatbotId: string): Promise<string> {
    const [row] = (await this.dataSource.query(
      `SELECT settings FROM chatbots WHERE id = $1`,
      [chatbotId],
    )) as { settings: Parameters<typeof assistantZone>[0] }[];
    return assistantZone(row?.settings);
  }

  /**
   * Conversations someone wrote in during `[from, to)` (the assistant's days), each counted once:
   * a chat that ran over two days is one conversation, not two, so the sum of the daily counts
   * isn't used for a period's total.
   */
  async conversationsBetween(
    chatbotId: string,
    zone: string,
    from: string,
    to: string,
  ): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT COUNT(DISTINCT m.conversation_id)::int AS n
         FROM chatbot_messages m JOIN chatbot_conversations c ON c.id = m.conversation_id
        WHERE c.chatbot_id = $1 AND m.direction = 'inbound'
          AND m.text IS DISTINCT FROM '${ERASED_TEXT}'
          AND m."createdAt" >= (($3::date)::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC'
          AND m."createdAt" < (($4::date)::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC'`,
      [chatbotId, zone, from, to],
    )) as { n: number | string }[];
    return Number(row?.n ?? 0);
  }

  /** `[from, to)` for one assistant: stored days, with today worked out now. */
  async days(chatbotId: string, from: string, to: string, now = new Date()) {
    const today = dayOf(now, await this.zoneOf(chatbotId));
    const stored = (await this.dataSource.query(
      `SELECT chatbot_id, day::text AS day, conversations, answers, answered_with_source,
              declined, wrong_decline_suspected, handed_over, crisis, thumbs_up,
              thumbs_down, reply_ms_p50, reply_ms_p90, people, handover_wait_p50
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
    const zone = await this.zoneOf(chatbotId);
    const today = dayOf(now, zone);
    const thisWeek = weekStart(today);
    const lastWeek = addDays(thisWeek, -7);
    const trendFrom = addDays(today, -6);
    const from = trendFrom < lastWeek ? trendFrom : lastWeek;
    const days = await this.days(chatbotId, from, addDays(today, 1), now);
    const between = (a: string, b: string) =>
      days.filter((d) => d.day >= a && d.day < b);
    const [
      unansweredAll,
      bookingAll,
      unhappyAll,
      latest,
      thisWeekChats,
      lastWeekChats,
    ] = await Promise.all([
      this.openUnanswered(chatbotId),
      this.openUnanswered(chatbotId, true),
      this.openThumbsDown(chatbotId),
      this.checkup.latestFor(chatbotId).catch(() => null),
      this.conversationsBetween(chatbotId, zone, thisWeek, addDays(today, 1)),
      this.conversationsBetween(chatbotId, zone, lastWeek, thisWeek),
    ]);
    // Ally staff without the owner's grant get the counts, never the customers' words.
    const quote = await this.access.mayReadCustomerText(chatbotId);
    const unanswered = quote ? unansweredAll : [];
    const bookingProblems = quote ? bookingAll : [];
    const unhappy = quote ? unhappyAll : [];
    return {
      ...(quote
        ? {}
        : {
            customerTextHidden: true,
            openCounts: {
              unanswered: unansweredAll.length,
              bookingProblems: bookingAll.length,
              thumbsDown: unhappyAll.length,
            },
          }),
      // A week's conversations are counted once each, not summed day by day.
      thisWeek: {
        ...sumDays(between(thisWeek, addDays(today, 1))),
        conversations: thisWeekChats,
      },
      lastWeek: {
        ...sumDays(between(lastWeek, thisWeek)),
        conversations: lastWeekChats,
      },
      trend: between(trendFrom, addDays(today, 1)).map((d) => ({
        day: d.day,
        answeredPct: d.answers
          ? Math.round((d.answeredWithSource / d.answers) * 100)
          : null,
      })),
      unanswered,
      bookingProblems,
      thumbsDown: unhappy,
      checkup: checkupCard(latest),
    };
  }

  /**
   * The Overview's "how it's doing" (stage 7): counts only, for the last `range` days in the
   * assistant's own time zone, with the small-number rule (D8) applied here so nothing under 5
   * people leaves the server: daily totals under 5, breakdown groups under 5 and top-unanswered
   * questions asked by fewer than 5 people come back as "fewer than 5" or as theme counts.
   */
  async overview(
    chatbotId: string,
    range: OverviewRange = 7,
    now = new Date(),
  ) {
    // Members need to be editors; Ally staff read it through their logged, read-only view.
    await this.access.assertOrStaffView(chatbotId, ChatbotMemberRole.EDITOR);
    const quote = await this.access.mayReadCustomerText(chatbotId);
    const zone = await this.zoneOf(chatbotId);
    const today = dayOf(now, zone);
    const from = addDays(today, -(range - 1));
    const to = addDays(today, 1);
    const days = await this.days(chatbotId, from, to, now);
    const window = [chatbotId, zone, from, to];
    const inWindow = (col: string) =>
      `${col} >= (($3::date)::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC'
       AND ${col} < (($4::date)::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC'`;
    const [conversations, people, channels, languages, asked] =
      await Promise.all([
        // The period's conversations, each counted once (a chat over two days is one).
        this.conversationsBetween(chatbotId, zone, from, to),
        this.dataSource.query(
          `SELECT COUNT(DISTINCT c.contact_id)::int AS n
           FROM chatbot_messages m JOIN chatbot_conversations c ON c.id = m.conversation_id
          WHERE c.chatbot_id = $1 AND m.direction = 'inbound' AND ${inWindow('m."createdAt"')}`,
          window,
        ) as Promise<{ n: number }[]>,
        this.dataSource.query(
          `SELECT c.channel AS key, COUNT(DISTINCT c.contact_id)::int AS count
           FROM chatbot_messages m JOIN chatbot_conversations c ON c.id = m.conversation_id
          WHERE c.chatbot_id = $1 AND m.direction = 'inbound' AND ${inWindow('m."createdAt"')}
          GROUP BY c.channel`,
          window,
        ) as Promise<{ key: string; count: number }[]>,
        this.dataSource.query(
          `SELECT m.language AS key, COUNT(DISTINCT c.contact_id)::int AS count
           FROM chatbot_messages m JOIN chatbot_conversations c ON c.id = m.conversation_id
          WHERE c.chatbot_id = $1 AND m.direction = 'inbound' AND m.language IS NOT NULL
            AND ${inWindow('m."createdAt"')}
          GROUP BY m.language`,
          window,
        ) as Promise<{ key: string; count: number }[]>,
        this.dataSource.query(
          `SELECT q.question_text AS text, q.reason, c.contact_id AS "contactId"
           FROM wa_unanswered_questions q JOIN chatbot_conversations c ON c.id = q.conversation_id
          WHERE c.chatbot_id = $1 AND ${inWindow('q."createdAt"')}`,
          window,
        ) as Promise<UnansweredInput[]>,
      ]);
    const sum = (pick: (d: DayStats) => number) =>
      days.reduce((n, d) => n + pick(d), 0);
    const answers = sum((d) => d.answers);
    const withSource = sum((d) => d.answeredWithSource);
    const handed = sum((d) => d.handedOver);
    const waits = days
      .map((d) => d.handoverWaitP50)
      .filter((w): w is number => w !== null)
      .sort((a, b) => a - b);
    return {
      range,
      timeZone: zone,
      from,
      to: today,
      conversations: safeCount(conversations),
      people: safeCount(people[0]?.n ?? 0),
      days: days.map((d) => ({
        day: d.day,
        conversations: safeCount(d.conversations),
        people: safeCount(d.people),
      })),
      answered: {
        // Answers that cited a source, of all answers (declines included).
        share: answers >= 5 ? Math.round((withSource / answers) * 100) : null,
        fewerThan5: answers < 5,
      },
      handedToPerson: {
        count: safeCount(handed),
        // A wait from fewer than 5 chats could be one person's: held back like the count.
        medianWaitMinutes:
          handed >= 5 && waits.length
            ? waits[Math.floor((waits.length - 1) / 2)]
            : null,
      },
      ratings: {
        up: safeCount(sum((d) => d.thumbsUp)),
        down: safeCount(sum((d) => d.thumbsDown)),
      },
      byChannel: suppressBreakdown(channels),
      byLanguage: suppressBreakdown(languages),
      topUnanswered: topUnanswered(asked, { quote }),
    };
  }

  /**
   * Open questions it didn't know, newest first. `booking`: the ones that were a step of a booking
   * or another list action ("Yes go ahead.", "11 works for me", "Please book…"), shown apart as
   * "Couldn't complete a booking" for the last 7 days, since there's nothing to Answer (Q3d).
   */
  private async openUnanswered(chatbotId: string, booking = false) {
    return (await this.dataSource.query(
      `SELECT q.id, q.question_text AS question, q."createdAt" AS at
         FROM wa_unanswered_questions q
         JOIN chatbot_conversations c ON c.id = q.conversation_id
        WHERE c.chatbot_id = $1 AND q.status = $2
          AND ${BOOKING_STEP} = $4
          AND ($4 = false OR q."createdAt" >= now() - interval '7 days')
        ORDER BY q."createdAt" DESC LIMIT $3`,
      [chatbotId, WaUnansweredStatus.OPEN, LIST_LIMIT, booking],
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
