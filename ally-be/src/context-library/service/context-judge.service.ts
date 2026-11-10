import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  JUDGE_HTTP_TIMEOUT_MS,
  withJudgeSlot,
} from 'src/analytics/util/judge-concurrency.util';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { CL_JUDGE_DEFAULT_SAMPLE_RATE } from '../constants/context-library.constants';
import { getProfile } from '../profiles';
import { gradeFromJudge, splitForQuery } from '../util/loops.util';

/** The pooled candidates judged per search: everything shown plus the best of what wasn't. */
const JUDGE_POOL = 20;
/** Searches judged per run, across all collections. A cost bound, not a quality one. */
const JUDGE_MAX_PER_RUN = 300;
/** Only recent searches: the chunks they found may have changed since. */
const JUDGE_WINDOW_HOURS = 48;

interface PoolRow {
  retrieval_id: string;
  queries: string[];
  collections_searched: string[];
  chunk_id: string;
  collection_id: string;
  code: string;
  statement: string;
  body: string | null;
  situations: string[];
  rrf_score: number;
  final_rank: number | null;
}

/**
 * The judge loop: grades a sample of live searches, 0–3 per pooled candidate, with the
 * platform's RAG-quality judge in ally-ai — a different model family from the re-ranker, so a
 * blind spot the re-ranker has is not graded as correct by a judge that shares it.
 *
 * Every other loop reads these labels: the benchmark (learn/holdout split by query hash), query
 * learning, the curator, tuning and rollback. Admin preview and eval searches are never judged
 * (they're excluded from usage), and failed or refused searches have nothing to grade.
 */
@Injectable()
export class ContextJudgeService {
  private readonly logger = LoggerService.getInstance(ContextJudgeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  /** Judge recent unjudged searches. Returns how many searches were judged. */
  async run(): Promise<number> {
    const settings: Array<{ id: string; rate: number | null }> =
      await this.dataSource.query(
        `SELECT id, (loop_settings->>'judgeSampleRate')::real AS rate,
                COALESCE(loop_settings->'paused', '[]'::jsonb) ? 'judge' AS paused
         FROM cl_collections WHERE status = 'active'`,
      );
    const rates = new Map(
      settings
        .filter((s: any) => !s.paused)
        .map((s) => [s.id, s.rate ?? CL_JUDGE_DEFAULT_SAMPLE_RATE]),
    );
    if (!rates.size) return 0;

    // Deterministic sampling by id, so re-running the loop never changes which searches are in.
    const candidates: Array<{ id: string; collections_searched: string[] }> =
      await this.dataSource.query(
        `SELECT r.id, r.collections_searched
         FROM cl_retrievals r
         WHERE r."createdAt" > now() - ($1 || ' hours')::interval
           AND NOT r.failed AND NOT r.exclude_from_usage AND r.candidate_count > 0
           AND NOT EXISTS (SELECT 1 FROM cl_judgments j WHERE j.retrieval_id = r.id)
         ORDER BY r."createdAt" DESC
         LIMIT $2`,
        [String(JUDGE_WINDOW_HOURS), JUDGE_MAX_PER_RUN * 5],
      );
    const sampled = candidates
      .filter((r) => {
        const rate = Math.max(
          ...r.collections_searched.map((c) => rates.get(c) ?? 0),
        );
        return bucket(r.id) < rate;
      })
      .slice(0, JUDGE_MAX_PER_RUN);

    let judged = 0;
    for (const retrieval of sampled) {
      try {
        if (await this.judgeOne(retrieval.id)) judged++;
      } catch (error) {
        this.logger.warn(
          `Judge skipped retrieval ${retrieval.id}: ${(error as Error).message}`,
        );
      }
    }
    return judged;
  }

  async judgeOne(retrievalId: string): Promise<boolean> {
    const pool: PoolRow[] = await this.dataSource.query(
      `SELECT h.retrieval_id, r.queries, r.collections_searched, h.chunk_id, h.collection_id,
              c.code, c.statement, c.body, c.situations, h.rrf_score, h.final_rank
       FROM cl_retrieval_hits h
       JOIN cl_retrievals r ON r.id = h.retrieval_id
       JOIN cl_chunks c ON c.id = h.chunk_id
       WHERE h.retrieval_id = $1 AND c.status = 'active'
         AND (h.dropped_reason IS NULL OR h.dropped_reason NOT IN ('audience', 'inactive'))
       ORDER BY h.final_rank ASC NULLS LAST, h.rrf_score DESC
       LIMIT $2`,
      [retrievalId, JUDGE_POOL],
    );
    if (!pool.length) return false;
    const queries = pool[0].queries ?? [];
    if (!queries.length) return false;
    const collections = pool[0].collections_searched;
    const purpose = collections
      .map((c) => {
        const profile = getProfile(c);
        return profile ? `${profile.name}: ${profile.purpose}` : c;
      })
      .join('\n');

    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/rag-quality/judge`,
        {
          query: queries.join(' | '),
          corpus: 'context_library',
          corpus_purpose: purpose,
          min_similarity: 0,
          passages: pool.map((p) => ({
            chunk_id: p.chunk_id,
            document_title: p.code,
            section_path: getProfile(p.collection_id)?.name ?? p.collection_id,
            similarity: Number(p.rrf_score) || 0,
            text: [
              p.statement,
              p.body ? p.body.slice(0, 600) : '',
              (p.situations ?? []).length
                ? `Applies when: ${p.situations.join('; ')}`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          })),
        },
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
    );
    const data = res.data as {
      judge_model: string;
      judge_prompt_version: string;
      passages: Array<{
        chunk_id: string;
        relevance: string;
        superficial_match?: boolean;
      }>;
    };
    const byId = new Map(pool.map((p) => [p.chunk_id, p]));
    const split = splitForQuery(queries);
    const rows = (data.passages ?? []).filter((p) => byId.has(p.chunk_id));
    if (!rows.length) return false;
    for (const p of rows) {
      const hit = byId.get(p.chunk_id)!;
      await this.dataSource.query(
        `INSERT INTO cl_judgments (retrieval_id, chunk_id, collection_id, grade, superficial_match,
                                   split, final_rank, judge_model, judge_prompt_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (retrieval_id, chunk_id) DO NOTHING`,
        [
          retrievalId,
          p.chunk_id,
          hit.collection_id,
          gradeFromJudge(p.relevance, Boolean(p.superficial_match)),
          Boolean(p.superficial_match),
          split,
          hit.final_rank,
          String(data.judge_model ?? 'unknown').slice(0, 80),
          String(data.judge_prompt_version ?? 'unknown').slice(0, 40),
        ],
      );
    }
    return true;
  }
}

/** A stable number in [0, 1) from a uuid, for sampling. */
function bucket(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 8), 16) / 0x100000000;
}
