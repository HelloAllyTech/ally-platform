import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { AppConfigService } from '../../config/config.service';

/** A run token outlives one agent run (15 s budget, 20 s cap) with room to spare, and no more. */
export const AGENT_RUN_TOKEN_TTL_S = 2 * 60;

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

  sign(claims: Omit<AgentRunClaims, 'kind' | 'exp'>): string {
    return jwt.sign(
      {
        kind: 'chatbot_run',
        chatbotId: claims.chatbotId,
        conversationId: claims.conversationId,
        runId: claims.runId,
        contactId: claims.contactId,
        tools: [...claims.tools],
      },
      this.secret(),
      { algorithm: 'HS256', expiresIn: AGENT_RUN_TOKEN_TTL_S },
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
      !Array.isArray(claims.tools)
    ) {
      throw new UnauthorizedException('Invalid run token');
    }
    return claims as AgentRunClaims;
  }
}
