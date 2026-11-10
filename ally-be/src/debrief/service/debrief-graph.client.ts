import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppConfigService } from '../../config/config.service';
import { DebriefBundle } from '../constants/debrief-release.constants';
import { DebriefRunStepRecord } from '../entity/debrief-run.entity';
import { DebriefRunMode } from '../enum/debrief-run.enum';
import { DebriefCheckFailure } from '../util/debrief-cards.util';

/** Past the graph's own deadline: room for its last write and the response. */
export const GRAPH_MARGIN_MS = 60_000;

/** `POST /api/v1/debrief/runs` (docs/debrief-harness/CONTRACT.md §1). */
export interface DebriefGraphRequest {
  run_id: string;
  scenario_session_id: string;
  mode: DebriefRunMode;
  resume: boolean;
  release: { id: string | null; version: number | null };
  bundle: DebriefBundle;
  prompts: Record<string, string | null>;
  ceiling_usd: number;
  prices: Record<string, { input_per_m: number; output_per_m: number }>;
  session: Record<string, unknown>;
  transcript: Array<{ turn_index: number; role: string; text: string }>;
  context: {
    live_detections: unknown[];
    past_work_on_this: unknown[];
    cohort: unknown;
    case_memory: unknown;
    practice_options: unknown[];
  };
  run_token: string;
  gateway_url: string;
}

export interface DebriefGraphResponse {
  status: 'published' | 'below_bar' | 'needs_person' | 'skipped' | 'failed';
  skip_reason?: string | null;
  recipe_key?: string | null;
  cards?: Record<string, any> | null;
  steps?: DebriefRunStepRecord[];
  workspace?: Record<string, any>;
  estimated_cost_usd?: number;
  fallback_rung?: number;
  has_risk_cue?: boolean;
  learner_distress?: boolean;
  revision_rounds?: number;
  evaluator_overall?: number | null;
  evaluator_hard_fails?: Array<{ code: string; evidence: string }>;
  check_failures?: Array<DebriefCheckFailure | string>;
  resumed?: boolean;
  /** Set with status `failed`: what stopped the graph. */
  error?: string | null;
}

export class DebriefGraphError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Starts or resumes a debrief on ally-ai's graph and waits for its decision.
 * Same base URL and service key as every other ally-ai call.
 */
@Injectable()
export class DebriefGraphClient {
  constructor(private readonly config: AppConfigService) {}

  async run(
    body: DebriefGraphRequest,
    deadlineMs: number,
  ): Promise<DebriefGraphResponse> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    try {
      const res = await axios.post(`${apiUrl}/api/v1/debrief/runs`, body, {
        headers: { 'x-api-key': outboundApiKey },
        timeout: deadlineMs + GRAPH_MARGIN_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return res.data as DebriefGraphResponse;
    } catch (e) {
      const err = e as AxiosError<{ detail?: unknown }>;
      const detail = err.response?.data?.detail;
      throw new DebriefGraphError(
        err.response?.status ?? null,
        `debrief graph ${err.response?.status ?? 'network'}: ${
          typeof detail === 'string'
            ? detail
            : detail
              ? JSON.stringify(detail)
              : err.message
        }`,
      );
    }
  }
}
