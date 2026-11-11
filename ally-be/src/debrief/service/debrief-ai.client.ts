import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppConfigService } from '../../config/config.service';

/**
 * How long one call to a step may take. About one and a half times the
 * slowest healthy call in prod over 30 days (Oct–Nov 2026): a stuck call is
 * cut while a slow one still finishes. The Safety reader's longest was 42 s.
 * Ask Ally's distress check is the one caller left; a debrief run's own steps
 * run inside ally-ai's debrief graph (`DebriefGraphClient`).
 */
export const STEP_TIMEOUT_MS: Record<string, number> = {
  'safety-reader': 60_000,
};
/** Any other step: generous; the caller's own deadline is the real limit. */
const DEFAULT_STEP_TIMEOUT_MS = 120_000;

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
 * HTTP client for ally-ai's stateless debrief steps (`/api/v1/debrief/*`):
 * Ask Ally's distress check. ally-be decides what
 * each step may see; this only carries it.
 */
@Injectable()
export class DebriefAiClient {
  constructor(private readonly config: AppConfigService) {}

  async step<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    try {
      const res = await axios.post(`${apiUrl}/api/v1/debrief/${path}`, body, {
        headers: { 'x-api-key': outboundApiKey },
        timeout: STEP_TIMEOUT_MS[path] ?? DEFAULT_STEP_TIMEOUT_MS,
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
}
