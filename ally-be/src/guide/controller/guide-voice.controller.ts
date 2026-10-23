import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { GuideVoiceFrame } from '../contract/generated/guide-contract';
import { GuideVoiceTurnDto } from '../dto/guide.dto';
import { GuideTurnService } from '../runtime/guide-turn.service';
import { GuideVoiceService } from '../voice/guide-voice.service';

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

  @Get('sessions/:token')
  @ApiOperation({ summary: 'What a voice session is for (no learner details)' })
  async session(@Param('token') token: string) {
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
        onDelta: (text) => write({ type: 'delta', text }),
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
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Voice turn failed',
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  @Post('sessions/:token/ended')
  @HttpCode(200)
  @ApiOperation({
    summary: 'The voice session is over; its token stops working',
  })
  async ended(@Param('token') token: string) {
    await this.voice.end(token);
    return { ended: true };
  }
}
