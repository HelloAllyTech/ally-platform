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
import { ClUseCase } from '../enum/context-library.enum';
import { COLLECTION_PROFILES } from '../profiles';
import { ContextAccessService } from '../service/context-access.service';
import { ContextReaderKeyService } from '../service/context-reader-key.service';
import {
  ContextToolNames,
  ContextToolsService,
} from '../service/context-tools.service';

const PROTOCOL_VERSION = '2025-06-18';

const ENGINEER_TOOLS: ContextToolNames = {
  search: 'search_context',
  get: 'get_chunks',
  libraryLabel:
    "Ally's Context Library (product, UX, engineering and learning-design guidance, plus Builder and Bug Hunter lessons)",
  noun: 'item',
  nounPlural: 'items',
  when:
    'Use it whenever a product or engineering judgement comes up — before writing a plan, and ' +
    'mid-implementation at an empty, loading, edge or failure state, a user-facing label, what a ' +
    'view shows, or a threshold, limit or cadence.',
  facets: [
    {
      name: 'collection',
      facet: '__collection',
      description: 'Optional: search one collection (see list_collections)',
    },
  ],
};

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

/**
 * The Context Library as an MCP server for engineers' Claude Code — replacing
 * `stacks-bridge.mjs`. Streamable HTTP, JSON responses only: one POST, one JSON-RPC reply.
 *
 * Authenticated by a read-only personal key (`Authorization: Bearer clr_…`), not an admin
 * session, and it can only ever read what the `mcp_dev` use case is granted — clinical,
 * learner-facing and organisation material is locked out in code.
 */
@ApiTags('Context Library — MCP')
@Controller('v1/context-library')
export class ContextLibraryMcpController {
  constructor(
    private readonly keys: ContextReaderKeyService,
    private readonly tools: ContextToolsService,
    private readonly access: ContextAccessService,
  ) {}

  // ── Keys (admin session) ───────────────────────────────────────────────────

  @Get('reader-keys')
  @ApiBearerAuth()
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, {
    permissions: [PERMISSIONS.VIEW_CONTEXT_LIBRARY],
  })
  @ApiOperation({ summary: 'Your read-only keys for Claude Code' })
  listKeys(@CurrentUser() user: TokenUser) {
    return this.keys.list(user.id);
  }

  @Post('reader-keys')
  @ApiBearerAuth()
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, {
    permissions: [PERMISSIONS.VIEW_CONTEXT_LIBRARY],
  })
  @ApiOperation({
    summary: 'Create a read-only key. The key is in this response only.',
  })
  createKey(@CurrentUser() user: TokenUser, @Body() body: { label?: string }) {
    return this.keys.create(user.id, String(body?.label ?? ''));
  }

  @Delete('reader-keys/:id')
  @ApiBearerAuth()
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, {
    permissions: [PERMISSIONS.VIEW_CONTEXT_LIBRARY],
  })
  revokeKey(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.keys.revoke(user.id, id);
  }

  @Post('reader-keys/:id/restore')
  @ApiBearerAuth()
  @RequireFeatureToggle(FeatureToggleKey.CONTEXT_LIBRARY, {
    permissions: [PERMISSIONS.VIEW_CONTEXT_LIBRARY],
  })
  restoreKey(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.keys.restore(user.id, id);
  }

  // ── MCP (reader key) ───────────────────────────────────────────────────────

  @Post('mcp')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async mcp(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: JsonRpcRequest | JsonRpcRequest[],
    @Res() res: Response,
  ) {
    let key;
    try {
      key = await this.keys.verify(authorization);
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
      const reply = await this.handle(request, `mcp:${key.id}`);
      if (reply) replies.push(reply);
    }
    if (!replies.length) {
      // Notifications only: accepted, nothing to say.
      res.status(202).end();
      return;
    }
    res.json(Array.isArray(body) ? replies : replies[0]);
  }

  private async handle(request: JsonRpcRequest, sessionId: string) {
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
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: 'ally-context-library', version: '1.0.0' },
          instructions:
            'Search the Context Library whenever a product or engineering judgement comes up — before ' +
            'a plan and mid-implementation. Cite item codes like [FP-0142] where guidance changed a ' +
            'decision. Never claim the library does or does not cover something: an empty search is not a gap.',
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({
          tools: [
            ...this.tools.definitions(ENGINEER_TOOLS).map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.input_schema,
            })),
            {
              name: 'list_collections',
              description:
                'The collections engineers can search, with what each holds.',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        });
      case 'tools/call':
        return ok(
          await this.callTool(
            String(request.params?.name ?? ''),
            request.params?.arguments ?? {},
            sessionId,
          ),
        );
      case 'prompts/list':
        return ok({
          prompts: [
            {
              name: 'planning_context',
              description: 'Guidance for a whole task, before you plan it.',
              arguments: [
                {
                  name: 'task_description',
                  description: 'What you are about to build',
                  required: true,
                },
              ],
            },
          ],
        });
      case 'prompts/get': {
        if (request.params?.name !== 'planning_context')
          return fail(-32602, 'Unknown prompt');
        const task = String(
          request.params?.arguments?.task_description ?? '',
        ).trim();
        if (task.length < 3)
          return fail(-32602, 'task_description is required');
        const result = await this.tools.runSearch(
          ClUseCase.MCP_DEV,
          ENGINEER_TOOLS,
          { queries: [task], limit: 8 },
          { sessionId },
        );
        return ok({
          description: 'Context Library guidance for this task',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text:
                  `Guidance from Ally's Context Library for: ${task}\n\n` +
                  ((
                    result.modelResult.results as
                      | Array<{ card: string }>
                      | undefined
                  )
                    ?.map((r) => r.card)
                    .join('\n\n') ||
                    String(
                      result.modelResult.message ??
                        result.modelResult.note ??
                        'No confident match.',
                    )),
              },
            },
          ],
        });
      }
      default:
        return fail(-32601, `Method not found: ${request?.method}`);
    }
  }

  private async callTool(
    name: string,
    args: Record<string, any>,
    sessionId: string,
  ) {
    const text = (value: unknown) => ({
      content: [
        {
          type: 'text',
          text:
            typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        },
      ],
    });
    if (name === 'list_collections') {
      const grants = await this.access.grantedCollections(ClUseCase.MCP_DEV);
      return text(
        grants.map((g) => {
          const p =
            COLLECTION_PROFILES[
              g.collectionId as keyof typeof COLLECTION_PROFILES
            ];
          return { id: g.collectionId, name: p?.name, holds: p?.nounPlural };
        }),
      );
    }
    if (name === ENGINEER_TOOLS.search) {
      const collections = args?.collection
        ? [String(args.collection)]
        : undefined;
      if (collections) {
        const { denied } = await this.access.resolve(
          ClUseCase.MCP_DEV,
          collections,
        );
        if (denied.length)
          return {
            ...text(`Engineers cannot search ${denied.join(', ')}.`),
            isError: true,
          };
      }
      const result = await this.tools.runSearch(
        ClUseCase.MCP_DEV,
        { ...ENGINEER_TOOLS, facets: [] },
        args ?? {},
        {
          sessionId,
          collections,
        },
      );
      return text(result.modelResult);
    }
    if (name === ENGINEER_TOOLS.get) {
      const result = await this.tools.runGet(
        ClUseCase.MCP_DEV,
        ENGINEER_TOOLS,
        args,
        { sessionId },
      );
      return text(result.modelResult);
    }
    return { ...text(`Unknown tool "${name}"`), isError: true };
  }
}
