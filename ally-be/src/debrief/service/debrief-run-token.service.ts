import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefRunStatus } from '../enum/debrief-run.enum';

/** The gateway tools ally-ai's debrief graph may call back (CONTRACT.md §2). */
export const DEBRIEF_GATEWAY_TOOLS = [
  'guidance_search',
  'run_checks',
  'render_cards',
  'finalise_cards',
  'progress',
] as const;
export type DebriefGatewayTool = (typeof DEBRIEF_GATEWAY_TOOLS)[number];

/** A run token lives this long: past any run's deadline, short enough to be useless later. */
export const RUN_TOKEN_TTL_S = 15 * 60;

export interface DebriefRunClaims {
  runId: string;
  sessionId: string;
  tools: string[];
  exp: number;
}

/**
 * Signs and verifies the run token: the only credential the Debrief gateway
 * accepts. HS256 with a secret only ally-be holds (DEBRIEF_GATEWAY_SECRET, or
 * one derived from the access secret, never the access secret itself), so a
 * user's JWT is never a run token and a run token is never a user's JWT.
 */
@Injectable()
export class DebriefRunTokenService {
  constructor(
    private readonly config: AppConfigService,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
  ) {}

  private secret(): string {
    const own = this.config.debriefGatewaySecret;
    if (own) return own;
    const access = this.config.jwt.accessToken.secret;
    if (!access) throw new Error('No secret to sign Debrief run tokens with');
    return createHmac('sha256', access)
      .update('debrief-gateway-v1')
      .digest('hex');
  }

  sign(
    runId: string,
    sessionId: string,
    tools: readonly string[] = DEBRIEF_GATEWAY_TOOLS,
  ): string {
    return jwt.sign({ runId, sessionId, tools: [...tools] }, this.secret(), {
      algorithm: 'HS256',
      expiresIn: RUN_TOKEN_TTL_S,
    });
  }

  /** The token's claims; 401 for a bad signature, an expired token or a malformed one. */
  verify(token: string): DebriefRunClaims {
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
      typeof claims.runId !== 'string' ||
      typeof claims.sessionId !== 'string' ||
      !Array.isArray(claims.tools)
    ) {
      throw new UnauthorizedException('Invalid run token');
    }
    return claims as DebriefRunClaims;
  }

  /**
   * Everything the gateway checks before a tool runs: a valid token in the
   * Authorization header, the tool among its `tools`, and its run still
   * `running` for the session it names. Returns the run.
   */
  async authorise(
    authorization: string | undefined,
    tool: string,
  ): Promise<{ claims: DebriefRunClaims; run: DebriefRun }> {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Run token missing');
    const claims = this.verify(token);
    if (!claims.tools.includes(tool)) {
      throw new ForbiddenException(`This run may not call ${tool}`);
    }
    const run = await this.runs.findOne({ where: { id: claims.runId } });
    if (
      !run ||
      run.scenarioSessionId !== claims.sessionId ||
      run.status !== DebriefRunStatus.RUNNING
    ) {
      throw new ForbiddenException('The run is not running');
    }
    return { claims, run };
  }
}
