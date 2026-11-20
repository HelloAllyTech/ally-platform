import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import { BlogAuthorKeyService } from '../service/blog-author-key.service';
import { BlogAuthoringToolsService } from '../service/blog-authoring-tools.service';

const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

/**
 * The blog as an MCP server for Claude Code, so a coding agent can write a post and save it as a
 * DRAFT in Ally admin. Streamable HTTP with JSON replies only: one POST, one JSON-RPC reply.
 * Authenticated by a personal author key (`Authorization: Bearer bga_…`), made in Ally admin →
 * Blog → Connect Claude. A key can write drafts and request image uploads; it cannot publish.
 */
@ApiTags('Blogs — authoring (Claude Code)')
@Controller('v1/blog-authoring')
export class BlogAuthoringController {
  constructor(
    private readonly keys: BlogAuthorKeyService,
    private readonly tools: BlogAuthoringToolsService,
  ) {}

  // ── Keys (admin session) ───────────────────────────────────────────────────

  @Get('keys')
  @ApiBearerAuth()
  @RequireFeatureToggle(FeatureToggleKey.BLOG, {
    permissions: [PERMISSIONS.EDIT_BLOG],
  })
  @ApiOperation({
    summary: 'Your keys for writing blog drafts from Claude Code',
  })
  listKeys(@CurrentUser() user: TokenUser) {
    return this.keys.list(user.id);
  }

  @Post('keys')
  @ApiBearerAuth()
  @RequireFeatureToggle(FeatureToggleKey.BLOG, {
    permissions: [PERMISSIONS.EDIT_BLOG],
  })
  @ApiOperation({
    summary: 'Create a draft-writing key. The key is in this response only.',
  })
  createKey(@CurrentUser() user: TokenUser, @Body() body: { label?: string }) {
    return this.keys.create(user.id, String(body?.label ?? ''));
  }

  @Delete('keys/:id')
  @ApiBearerAuth()
  @RequireFeatureToggle(FeatureToggleKey.BLOG, {
    permissions: [PERMISSIONS.EDIT_BLOG],
  })
  @ApiOperation({ summary: 'Revoke one of your keys' })
  revokeKey(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.keys.revoke(user.id, id);
  }

  // ── MCP (author key) ───────────────────────────────────────────────────────

  @Post('mcp')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async mcp(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: JsonRpcRequest | JsonRpcRequest[],
    @Res() res: Response,
  ) {
    let ownerId: number;
    try {
      ownerId = (await this.keys.verify(authorization)).ownerId;
    } catch (error) {
      res.status(401).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: (error as Error).message },
      });
      return;
    }
    const requests = Array.isArray(body) ? body : [body];
    const replies = [];
    for (const request of requests) {
      const reply = await this.handle(request, ownerId);
      if (reply) replies.push(reply);
    }
    if (!replies.length) {
      res.status(202).end();
      return;
    }
    res.json(Array.isArray(body) ? replies : replies[0]);
  }

  private async handle(request: JsonRpcRequest, ownerId: number) {
    const id = request?.id ?? null;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => ({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
    if (id === null && request?.method?.startsWith('notifications/'))
      return null;

    switch (request?.method) {
      case 'initialize':
        return ok({
          protocolVersion: request.params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'ally-blog-authoring', version: '1.0.0' },
          instructions:
            'Write posts for the Ally blog as drafts. Call blog_guide first for what the blog supports. ' +
            'Upload pictures with request_image_upload, save with create_draft, fix any issues it reports, then ' +
            'tell the person to review and publish in Ally admin → Blog. You cannot publish.',
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: this.tools.definitions() });
      case 'tools/call': {
        const name = String(request.params?.name ?? '');
        try {
          const result = await this.tools.call(
            name,
            request.params?.arguments ?? {},
            ownerId,
          );
          return ok({
            content: [
              {
                type: 'text',
                text:
                  typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          });
        } catch (error) {
          // A tool failure is a result the agent can read and fix, not a protocol error.
          return ok({
            isError: true,
            content: [
              {
                type: 'text',
                text: (error as Error).message || 'The tool call failed.',
              },
            ],
          });
        }
      }
      default:
        return fail(-32601, `Method not found: ${request?.method}`);
    }
  }
}
