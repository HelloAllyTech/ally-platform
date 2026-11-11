import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppConfigService } from '../../config/config.service';

/**
 * How long one Safety reader call may take: about one and a half times the
 * slowest healthy call in prod over 30 days (Oct–Nov 2026, longest 42 s), so a
 * stuck call is cut while a slow one still finishes.
 */
export const SAFETY_READER_TIMEOUT_MS = 60_000;

export class DebriefStepError extends Error {
  constructor(
    readonly step: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** What `POST /api/v1/debrief/safety-reader` answers. */
export interface SafetyReading {
  model?: string;
  risk_cues?: unknown[];
  learner_distress?: unknown[];
}

/**
 * HTTP client for ally-ai's Safety reader endpoint
 * (`POST /api/v1/debrief/safety-reader`), the one debrief step ally-be still
 * calls on its own: Ask Ally's distress check. A debrief run's steps run
 * inside ally-ai's debrief graph (`DebriefGraphClient`). ally-be decides what
 * the step may see; this only carries it.
 */
@Injectable()
export class DebriefAiClient {
  constructor(private readonly config: AppConfigService) {}

  async safetyReader(body: Record<string, unknown>): Promise<SafetyReading> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    try {
      const res = await axios.post(
        `${apiUrl}/api/v1/debrief/safety-reader`,
        body,
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: SAFETY_READER_TIMEOUT_MS,
        },
      );
      return res.data as SafetyReading;
    } catch (e) {
      const err = e as AxiosError<{ detail?: string }>;
      throw new DebriefStepError(
        'safety-reader',
        err.response?.status ?? null,
        err.response?.data?.detail ?? err.message,
      );
    }
  }
}
