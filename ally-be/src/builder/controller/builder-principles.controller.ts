import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { BuilderSessionService } from '../service/builder-session.service';
import { BuilderPrinciplesService } from '../service/builder-principles.service';

/**
 * "Principles in play" for one Builder session — what the session panel shows — and the
 * per-session switch. Status comes from usage, not from anyone grading: Applied when a citation
 * passed the check, Open when surfaced but not yet used, Trade-off when two principles in play
 * pull against each other.
 */
@ApiTags('Builder')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/builder')
export class BuilderPrinciplesController {
  constructor(
    private readonly sessionService: BuilderSessionService,
    private readonly principles: BuilderPrinciplesService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('sessions/:sessionId/principles')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'Principles in play for a session, with their status',
  })
  async inPlay(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    // Ownership and visibility are the session service's to enforce.
    const detail: any = await this.sessionService.getSessionDetail(
      sessionId,
      user.id,
    );
    const session = detail?.session ?? detail;
    const state = this.principles.state(session);
    const rows: Array<{
      code: string;
      statement: string;
      collection_id: string;
      facets: any;
      attributes: any;
      events: string[];
    }> = await this.dataSource.query(
      `SELECT c.code, c.statement, c.collection_id, c.facets, c.attributes,
                array_agg(DISTINCT u.type) AS events
         FROM cl_usage_events u JOIN cl_chunks c ON c.id = u.chunk_id
         WHERE u.session_id = $1
         GROUP BY c.id`,
      [sessionId],
    );
    const inPlayCodes = new Set([
      ...(state.codes ?? []),
      ...rows.map((r) => r.code),
    ]);
    const tensions: Array<{ a: string; b: string; note: string | null }> =
      inPlayCodes.size
        ? await this.dataSource.query(
            `SELECT a.code AS a, b.code AS b, r.note
           FROM cl_chunk_relations r
           JOIN cl_chunks a ON a.id = r.from_id
           JOIN cl_chunks b ON b.id = r.to_id
           WHERE r.type = 'tension' AND a.code = ANY($1) AND b.code = ANY($1)`,
            [[...inPlayCodes]],
          )
        : [];
    const inTension = new Set(tensions.flatMap((t) => [t.a, t.b]));
    const status = (events: string[], code: string) =>
      events.includes('applied_verified')
        ? 'applied'
        : inTension.has(code)
          ? 'trade_off'
          : events.includes('cited')
            ? 'cited'
            : 'open';
    return {
      enabled: this.principles.isOn(session),
      off: Boolean(state.off),
      briefReady: Boolean(state.block),
      descriptor: state.descriptor ?? null,
      items: rows.map((r) => ({
        code: r.code,
        statement: r.statement,
        collectionId: r.collection_id,
        prdSections: r.facets?.prdSections ?? [],
        probe: r.attributes?.probe ?? null,
        status: status(r.events ?? [], r.code),
        inBrief: (state.codes ?? []).includes(r.code),
      })),
      tensions,
    };
  }

  @Put('sessions/:sessionId/principles')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Switch principles on or off for this session' })
  async setOff(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: { off: boolean },
    @CurrentUser() user: TokenUser,
  ) {
    await this.sessionService.getSessionDetail(sessionId, user.id);
    await this.principles.setOff(sessionId, Boolean(body?.off));
    return { off: Boolean(body?.off) };
  }
}
