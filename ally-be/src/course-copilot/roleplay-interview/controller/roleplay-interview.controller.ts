import {
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import {
  ApproveRoleplayInterviewPlanDto,
  CreateRoleplayInterviewSessionDto,
  LinkRoleplayInterviewScenarioDto,
  RoleplayInterviewMessageDto,
} from '../dto/roleplay-interview.dto';
import {
  ROLEPLAY_INTERVIEW_SSE_PING_INTERVAL_MS,
  ROLEPLAY_INTERVIEW_TURN_LOCK_PREFIX,
  ROLEPLAY_INTERVIEW_TURN_LOCK_TTL_SECONDS,
} from '../constants/roleplay-interview.constants';
import { RoleplayInterviewSessionService } from '../service/roleplay-interview-session.service';
import { RoleplayInterviewOrchestratorService } from '../service/roleplay-interview-orchestrator.service';

const STREAM_FAILED_MESSAGE =
  'That turn could not be started. Your answers are all still here — send your message ' +
  'again. If it keeps happening, ask an administrator to check the server logs.';

/**
 * Studio's Agent Builder Copilot as a chat: interviews the trainer, keeps a
 * roleplay brief, proposes a plan, and on approval returns the inputs the
 * web's existing generation pipeline builds the roleplay from. Sessions are
 * private to their creator.
 */
@ApiTags('Agent Builder')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'learn/roleplay-interview', version: '1' })
export class RoleplayInterviewController {
  private readonly logger = LoggerService.getInstance(
    RoleplayInterviewController.name,
  );

  constructor(
    private readonly sessionService: RoleplayInterviewSessionService,
    private readonly orchestrator: RoleplayInterviewOrchestratorService,
    private readonly redisService: RedisService,
  ) {}

  @ApiOperation({
    summary:
      "Resume the caller's open roleplay chat for this roleplay (or unsaved roleplay), or start one",
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('sessions')
  createSession(
    @Body() dto: CreateRoleplayInterviewSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.createOrResume(
      user.id,
      user.tenantId ?? null,
      dto.scenarioId ?? null,
    );
  }

  @ApiOperation({ summary: 'A roleplay chat with its transcript' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Get('sessions/:id')
  getSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.getWithMessages(id, user.id);
  }

  @ApiOperation({ summary: 'Link the chat to the roleplay the trainer saved' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Patch('sessions/:id')
  linkScenario(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkRoleplayInterviewScenarioDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.linkScenario(id, user.id, dto.scenarioId);
  }

  @ApiOperation({
    summary:
      'Approve the plan (409 when stale); returns the inputs for the web generation pipeline',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('sessions/:id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveRoleplayInterviewPlanDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.approve(id, user.id, dto.planVersion);
  }

  @ApiOperation({ summary: 'Start over: the chat is no longer resumed' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('sessions/:id/abandon')
  abandon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.abandon(id, user.id);
  }

  @ApiOperation({
    summary:
      'Stream one turn (SSE: tool_call / tool_result / brief / plan / token / question / receipt / error / done / ping)',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('sessions/:id/messages/stream')
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RoleplayInterviewMessageDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let clientGone = false;
    res.on('close', () => {
      if (!res.writableEnded) clientGone = true;
    });
    const safeWrite = (event: string, data: Record<string, any>): void => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientGone = true;
      }
    };

    const lockKey = `${ROLEPLAY_INTERVIEW_TURN_LOCK_PREFIX}:${id}`;
    const locked = await this.redisService.acquireLock(
      lockKey,
      ROLEPLAY_INTERVIEW_TURN_LOCK_TTL_SECONDS,
    );
    if (!locked) {
      safeWrite('error', {
        code: 'turn_in_progress',
        message: 'Another turn is already streaming for this chat',
      });
      res.end();
      return;
    }
    const heartbeat = setInterval(
      () => safeWrite('ping', { at: Date.now() }),
      ROLEPLAY_INTERVIEW_SSE_PING_INTERVAL_MS,
    );

    try {
      try {
        for await (const frame of this.orchestrator.streamTurn(
          id,
          dto,
          user.id,
        )) {
          safeWrite(frame.event, frame.data);
          // Nobody is reading: end the loop (the generator still persists the
          // turn) so the lock frees now rather than at its TTL.
          if (clientGone) break;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof NotFoundException
            ? 'session_not_found'
            : 'stream_failed';
        const message =
          error instanceof HttpException ? detail : STREAM_FAILED_MESSAGE;
        this.logger.error(
          `Roleplay interview stream failed for ${id}: ${detail}`,
        );
        safeWrite('error', { code, message });
      }
    } finally {
      clearInterval(heartbeat);
      try {
        await this.redisService.releaseLock(lockKey);
      } catch (error) {
        this.logger.warn(
          `Failed to release roleplay interview lock for ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (!res.writableEnded) res.end();
    }
  }
}
