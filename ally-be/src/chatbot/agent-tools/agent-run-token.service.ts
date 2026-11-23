import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { AppConfigService } from '../../config/config.service';

/**
 * The longest a run token lives when the caller names no cap. A run's own token expires with the
 * run's cap (chunk H1 Part B): a write that arrives after the run was cut off is refused.
 */
export const AGENT_RUN_TOKEN_TTL_S = 2 * 60;

/** Seconds a token outlives its run's cap: clock skew and the gateway call already on its way. */
export const AGENT_RUN_TOKEN_GRACE_S = 1;

/** What one chatbot agent run may do through the gateway, and on whose behalf. */
export interface AgentRunClaims {
  kind: 'chatbot_run';
  chatbotId: string;
  /** A stored conversation's id, or Preview's `preview-…` thread. */
  conversationId: string;
  runId: string;
  /** Null in Preview, which has no contact. */
  contactId: string | null;
  tools: string[];
  /**
   * The offer the person said yes to in this turn (chunk H1 Part B), when they did: the only write
   * this run may make without asking first. Absent or null: every write asks.
   */
  consent?: string | null;
  exp: number;
}

/**
 * Signs and verifies the chatbot agent's run token (chunk 3b), modelled on
 * `DebriefRunTokenService` but sharing neither its secret nor its token type: HS256 with
 * AGENT_GATEWAY_SECRET, or one derived from the access secret under its own label, and a `kind`
 * that a Debrief token never carries. A user's JWT is never a run token, nor the reverse.
 */
@Injectable()
export class AgentRunTokenService {
  constructor(private readonly config: AppConfigService) {}

  private secret(): string {
    const own = this.config.agentGatewaySecret;
    if (own) return own;
    const access = this.config.jwt.accessToken.secret;
    if (!access) throw new Error('No secret to sign agent run tokens with');
    return createHmac('sha256', access)
      .update('agent-gateway-v1')
      .digest('hex');
  }

  /** `ttlSeconds`: the run's cap, so the token dies with the run (plus a second's grace). */
  sign(
    claims: Omit<AgentRunClaims, 'kind' | 'exp'>,
    ttlSeconds: number = AGENT_RUN_TOKEN_TTL_S,
  ): string {
    return jwt.sign(
      {
        kind: 'chatbot_run',
        chatbotId: claims.chatbotId,
        conversationId: claims.conversationId,
        runId: claims.runId,
        contactId: claims.contactId,
        tools: [...claims.tools],
        consent: claims.consent ?? null,
      },
      this.secret(),
      {
        algorithm: 'HS256',
        expiresIn: Math.max(
          1,
          Math.min(
            AGENT_RUN_TOKEN_TTL_S,
            Math.ceil(ttlSeconds) + AGENT_RUN_TOKEN_GRACE_S,
          ),
        ),
      },
    );
  }

  /** Where ally-ai calls the gateway back: `PUBLIC_API_BASE_URL`, as for Debrief. */
  gatewayUrl(): string {
    return `${this.config.publicApiBaseUrl.replace(/\/+$/, '')}/api/v1/internal/agent`;
  }

  /** The bearer token's claims; 401 when missing, badly signed, expired or not a chatbot run's. */
  verify(authorization: string | undefined): AgentRunClaims {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Run token missing');
    let claims: jwt.JwtPayload | string;
    try {
      claims = jwt.verify(token, this.secret(), { algorithms: ['HS256'] });
    } catch (e) {
      throw new UnauthorizedException(
        e instanceof jwt.TokenExpiredError
          ? 'Run token expired'
          : 'Invalid run token',
      );
    }
    if (
      typeof claims === 'string' ||
      claims.kind !== 'chatbot_run' ||
      typeof claims.chatbotId !== 'string' ||
      typeof claims.conversationId !== 'string' ||
      typeof claims.runId !== 'string' ||
      !(claims.contactId === null || typeof claims.contactId === 'string') ||
      !Array.isArray(claims.tools) ||
      !(
        claims.consent === undefined ||
        claims.consent === null ||
        typeof claims.consent === 'string'
      )
    ) {
      throw new UnauthorizedException('Invalid run token');
    }
    return claims as AgentRunClaims;
  }
}
