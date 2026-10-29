import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppConfigService } from '../../config/config.service';

/** Generous: the Writer on a long session can take a minute; the run's own deadline is the real limit. */
const STEP_TIMEOUT_MS = 120_000;

export class DebriefStepError extends Error {
  constructor(
    readonly step: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * HTTP client for ally-ai's stateless debrief steps (`/api/v1/debrief/*`) and
 * its knowledge search. ally-be decides what each step may see; this only
 * carries it.
 */
@Injectable()
export class DebriefAiClient {
  constructor(private readonly config: AppConfigService) {}

  async step<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    try {
      const res = await axios.post(`${apiUrl}/api/v1/debrief/${path}`, body, {
        headers: { 'x-api-key': outboundApiKey },
        timeout: STEP_TIMEOUT_MS,
      });
      return res.data as T;
    } catch (e) {
      const err = e as AxiosError<{ detail?: string }>;
      throw new DebriefStepError(
        path,
        err.response?.status ?? null,
        err.response?.data?.detail ?? err.message,
      );
    }
  }

  /**
   * Practice guidance for one moment from the Ally guide's library: global
   * material plus the tenant's own protocols, never another tenant's.
   */
  async searchGuidance(
    query: string,
    tenantId: string | null,
    limit: number,
    minSimilarity: number,
  ): Promise<
    Array<{
      chunk_id: string;
      document_title: string;
      text: string;
      similarity: number;
    }>
  > {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await axios.post(
      `${apiUrl}/api/v1/knowledge-chunks/search?corpus=ally_guide_library`,
      {
        query,
        limit,
        min_similarity: minSimilarity,
        audience: { tenant_id: tenantId, include_global: true },
      },
      { headers: { 'x-api-key': outboundApiKey }, timeout: 30_000 },
    );
    return res.data?.passages ?? [];
  }
}
