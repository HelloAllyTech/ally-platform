import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContextRetrievalService } from '../../context-library/service/context-retrieval.service';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  ADVISORY_CHECKS,
  checkWeight,
  DebriefCards,
  keepOfferedPractice,
  renderCards,
  runDebriefChecks,
  SafetyReading,
  withPointIds,
} from '../util/debrief-cards.util';
import { guidancePassage, guidanceSearch } from '../util/debrief-guidance.util';
import { DebriefAggregatesService } from './debrief-aggregates.service';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefRunClaims } from './debrief-run-token.service';

/** At most this many moments are looked up per call, as the in-process runner did. */
const MAX_TOPICS = 3;
/** Ask Ally's history tool: at most this many earlier points. */
const MAX_HISTORY_POINTS = 10;

export interface GuidanceTopic {
  skill?: string;
  situation?: string;
  language?: string;
}

/**
 * The Debrief gateway's tools (CONTRACT.md §2): what ally-ai's debrief graph
 * asks ally-be to do mid-run because only ally-be has the data. Each one is a
 * thin call into the same functions the debrief has always used, scoped to
 * the run the token names. The controller authenticates; this only executes.
 */
@Injectable()
export class DebriefGatewayService {
  constructor(
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly context: DebriefContextRepository,
    private readonly guidance: ContextRetrievalService,
    private readonly aggregates: DebriefAggregatesService,
  ) {}

  /** The session the run is for, as the orchestrator's data tools scope to it. */
  private async session(run: DebriefRun) {
    return this.context.loadSession(run.scenarioSessionId);
  }

  /**
   * `get_org_protocols` (spec A4): the learner's organisation's own protocols
   * (Debrief Guidance entries with facet kind `protocol`, and the procedures
   * in its Guide profile). Scoped to the run's session, never to a body field.
   */
  async orgProtocols(run: DebriefRun) {
    const tenantId =
      run.tenantId ?? (await this.session(run))?.tenantId ?? null;
    return this.context.orgProtocols(tenantId);
  }

  /**
   * `get_learner_history` (spec A4): this learner's last debriefs (Work-on-this
   * points, strengths, skill words), newest first, without quotes.
   */
  async runLearnerHistory(run: DebriefRun, body: { limit?: number }) {
    const s = await this.session(run);
    if (!s?.counselorId) return { sessions: [] };
    const limit = Math.max(1, Math.min(Number(body?.limit ?? 8) || 8, 12));
    return {
      sessions: await this.context.learnerHistory(
        s.counselorId,
        s.tenantId,
        run.scenarioSessionId,
        limit,
      ),
    };
  }

  /**
   * `query_aggregates` (spec A4): one of a fixed family of parameterised
   * aggregate queries over redacted views, groups of five or more, through
   * the Analytics Agent's guard and executor. Never free SQL.
   */
  async queryAggregates(
    run: DebriefRun,
    body: { query?: string; params?: Record<string, unknown> },
  ) {
    return this.aggregates.run(
      run,
      String(body?.query ?? ''),
      body?.params && typeof body.params === 'object' ? body.params : {},
    );
  }

  /**
   * Debrief Guidance for up to three moments, as the learner's organisation
   * may read it. A moment with no confident match adds nothing rather than a
   * weak passage; unreachable guidance returns what was found so far.
   */
  async guidanceSearch(
    run: DebriefRun,
    body: { topics?: GuidanceTopic[]; per_moment?: number },
  ) {
    const perMoment = Math.max(0, Math.min(Number(body.per_moment ?? 2), 5));
    const topics = (body.topics ?? []).slice(0, MAX_TOPICS);
    const tenantId =
      run.tenantId ??
      (await this.context.loadSession(run.scenarioSessionId))?.tenantId ??
      null;
    const seen = new Set<string>();
    const passages: Array<{
      id: string;
      code: string;
      title: string;
      text: string;
      citation: string;
      band: string;
    }> = [];
    let confident = false;
    let unavailable = false;
    for (const t of topics) {
      // The Analyst's words about the moment, never the learner's.
      const query = (t?.situation || t?.skill || '').trim();
      if (!query || perMoment === 0) continue;
      try {
        const { results, noConfidentMatch } = await this.guidance.search(
          guidanceSearch(query, tenantId, perMoment, run.scenarioSessionId),
        );
        if (noConfidentMatch) continue;
        confident = true;
        for (const { chunk, band } of results) {
          if (seen.has(chunk.id)) continue;
          seen.add(chunk.id);
          const { title, text } = guidancePassage(chunk);
          passages.push({
            id: chunk.id,
            code: chunk.code,
            title,
            text,
            citation: title,
            band: String(band),
          });
        }
      } catch {
        // Empty or unreachable guidance never stops a debrief.
        unavailable = true;
        break;
      }
    }
    return {
      passages,
      no_confident_match: !confident,
      ...(unavailable ? { unavailable: true } : {}),
    };
  }

  /** The rule checks on the session's transcript, loaded here, never sent by the graph. */
  async runChecks(
    run: DebriefRun,
    body: {
      cards: DebriefCards;
      safety: SafetyReading;
      language: string;
      short_form?: boolean;
      has_progress?: boolean;
    },
  ) {
    const transcript = await this.context.transcript(run.scenarioSessionId);
    const failures = runDebriefChecks({
      cards: body.cards,
      transcript,
      safety: {
        risk_cues: body.safety?.risk_cues ?? [],
        learner_distress: body.safety?.learner_distress ?? [],
      },
      language: body.language,
      shortForm: !!body.short_form,
      hasProgress: !!body.has_progress,
    });
    return {
      failures,
      weight: checkWeight(failures),
      advisory: [...ADVISORY_CHECKS],
    };
  }

  renderCards(body: { cards: DebriefCards }) {
    return { text: renderCards(body.cards) };
  }

  /** Point ids, and "Practise next" kept only when it links a roleplay the learner was offered. */
  finaliseCards(body: { cards: DebriefCards; offered?: number[] }) {
    const offered = new Set((body.offered ?? []).map(Number));
    return { cards: withPointIds(keepOfferedPractice(body.cards, offered)) };
  }

  /**
   * The learner's "working" panel (v9 FR-27): what the run is doing now, and
   * whether it found a risk cue. Only while the run is still running.
   */
  async progress(
    run: DebriefRun,
    body: {
      step: string;
      round?: number | null;
      topic?: string | null;
      has_risk_cue?: boolean;
      label_key?: string | null;
    },
  ) {
    const p = {
      step: String(body.step ?? ''),
      // A registry agent's keyed progress label (FR-27), translated by the apps.
      ...(typeof body.label_key === 'string' &&
      /^debrief\.progress\.[a-z_]{1,40}$/.test(body.label_key)
        ? { labelKey: body.label_key }
        : {}),
      ...(body.round ? { round: Number(body.round) } : {}),
      ...(typeof body.topic === 'string' && body.topic.trim()
        ? { topic: body.topic.trim().slice(0, 60) }
        : {}),
    };
    await this.runs.query(
      `UPDATE debrief_runs
          SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{liveProgress}', $2::jsonb),
              "hasRiskCue" = $3
        WHERE id = $1 AND status = 'running'`,
      [run.id, JSON.stringify(p), !!body.has_risk_cue],
    );
    return { ok: true };
  }

  /**
   * Ask Ally: the learner's earlier "Work on this" points, newest first. The
   * learner is the one the reply token names, never one the agent asks for.
   */
  async learnerHistory(
    run: DebriefRun,
    claims: DebriefRunClaims,
    body: { limit?: number },
  ) {
    const limit = Math.max(
      1,
      Math.min(Number(body.limit ?? MAX_HISTORY_POINTS), MAX_HISTORY_POINTS),
    );
    const points = await this.context.pastWorkOnThis(
      claims.userId as number,
      run.tenantId ?? null,
      run.scenarioSessionId,
      limit,
    );
    return { points };
  }

  /** Ask Ally: what the live detector recorded for each behaviour the scenario watches. */
  async liveDetections(run: DebriefRun) {
    const session = await this.context.loadSession(run.scenarioSessionId);
    const detections = await this.context.liveDetections(
      run.scenarioSessionId,
      session?.scenarioId ?? null,
    );
    return { detections };
  }
}
