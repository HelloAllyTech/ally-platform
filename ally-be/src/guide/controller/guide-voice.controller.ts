import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  GuideFailureCode,
  GuideVoiceFrame,
} from '../contract/generated/guide-contract';
import { GuideVoiceTurnDto } from '../dto/guide.dto';
import { GuideTurnService } from '../runtime/guide-turn.service';
import { GuideVoiceService } from '../voice/guide-voice.service';

/**
 * The voice-session token travels in this header, never the URL path:
 * paths end up in access logs.
 */
export const GUIDE_VOICE_SESSION_HEADER = 'x-guide-voice-session';

const FAILURE_BY_ERROR_CODE: Partial<Record<string, GuideFailureCode>> = {
  [ErrorCode.GUIDE_DISABLED]: 'guide_disabled',
  [ErrorCode.GUIDE_NO_ACCESS]: 'no_access',
  [ErrorCode.GUIDE_MESSAGE_TOO_LONG]: 'message_too_long',
};

/**
 * A refusal thrown once the stream is open becomes an error frame with the
 * code the worker acts on (say the voice-off line, ask for a shorter turn),
 * not a blanket internal_error.
 */
export function voiceFailureCode(error: unknown): GuideFailureCode {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { errorCode?: string } | string;
    const code =
      typeof body === 'object' && body?.errorCode
        ? FAILURE_BY_ERROR_CODE[body.errorCode]
        : undefined;
    if (code) return code;
    if (error.getStatus() === 429) return 'rate_limited';
  }
  return 'internal_error';
}

/**
 * The guide voice worker's API (plans/ally-guide/plan.md §7.9, §9.1). Two
 * locks: the service API key, and the voice-session token that binds a call
 * to one thread, learner and organisation.
 */
@ApiTags('Ally guide — voice worker')
@ApiSecurity('api-key')
@UseGuards(ApiAuthGuard)
@Controller('v1/guide/voice')
export class GuideVoiceController {
  constructor(
    private readonly voice: GuideVoiceService,
    private readonly turns: GuideTurnService,
  ) {}

  @Get('session')
  @ApiHeader({ name: GUIDE_VOICE_SESSION_HEADER, required: true })
  @ApiOperation({ summary: 'What a voice session is for (no learner details)' })
  async session(@Headers(GUIDE_VOICE_SESSION_HEADER) token: string) {
    const session = await this.voice.resolve(token);
    return {
      threadId: session.threadId,
      roomName: session.roomName,
      language: session.language,
      turnMode: session.turnMode,
    };
  }

  @Post('turns')
  @ApiOperation({
    summary:
      'A spoken turn: streams NDJSON frames (delta, card_hint, done | error). Closing the connection is a barge-in and cancels the turn.',
  })
  async turn(
    @Body() dto: GuideVoiceTurnDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const session = await this.voice.resolve(dto.token);
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const bargeIn = new AbortController();
    let closed = false;
    req.on('close', () => {
      closed = true;
      bargeIn.abort();
    });
    const write = (frame: GuideVoiceFrame) => {
      if (closed || res.writableEnded) return;
      res.write(`${JSON.stringify(frame)}\n`);
    };

    try {
      const result = await this.turns.runVoiceTurn(session, dto, {
        onStart: (turnId) => write({ type: 'start', turnId }),
        onDelta: (text, kind) =>
          write(kind ? { type: 'delta', text, kind } : { type: 'delta', text }),
        onCardHint: (text) => text && write({ type: 'card_hint', text }),
        signal: bargeIn.signal,
      });
      if (result.failure) {
        write({
          type: 'error',
          code: result.failure.code as never,
          message: result.failure.message,
        });
      } else if (result.duplicate) {
        write({
          type: 'error',
          code: 'turn_in_progress',
          message: 'This turn was already received.',
        });
      } else {
        write({
          type: 'done',
          turnId: result.turnId,
          messageId: result.messageId ?? '',
        });
      }
    } catch (error) {
      write({
        type: 'error',
        code: voiceFailureCode(error),
        message: error instanceof Error ? error.message : 'Voice turn failed',
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  @Post('session/ended')
  @HttpCode(200)
  @ApiHeader({ name: GUIDE_VOICE_SESSION_HEADER, required: true })
  @ApiOperation({
    summary: 'The voice session is over; its token stops working',
  })
  async ended(@Headers(GUIDE_VOICE_SESSION_HEADER) token: string) {
    await this.voice.end(token ?? '');
    return { ended: true };
  }
}
