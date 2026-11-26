import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Post,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from 'src/auth/decorators/auth.metadata';
import { LoggerService } from 'src/logger/logger.service';
import { toPageRow } from '../service/manual-page.service';
import { ManualPageService } from '../service/manual-page.service';
import { ManualProposalService } from '../service/manual-proposal.service';
import { ManualSearchService } from '../service/manual-search.service';
import { ManualAgentKeyService } from '../service/manual-agent-key.service';
import type { ManualAgentKey } from '../entity/manual-agent-key.entity';
import { isValidSlug } from '../util/manual-slug.util';
import { snippetToPlainText } from '../service/manual-plain-text';

const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

const WHEN_TO_PROPOSE =
  'Call it after changing user-visible behaviour: a screen, label, route, role gate, setting, ' +
  'notification, or limit.';

/**
 * The tools a coding agent sees. Read and propose only: NO tool edits a page (the weekly agent
 * applies proposals). Exported so a test can assert exactly that.
 */
export const MANUAL_MCP_TOOLS = [
  {
    name: 'search_manual',
    description:
      "Search Ally's Product Manual (the staff guide to the whole product) by words, to find the " +
      `page your change affects before proposing an update. ${WHEN_TO_PROPOSE}`,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A few words' } },
      required: ['query'],
    },
  },
  {
    name: 'read_manual_page',
    description:
      'Read one Product Manual page by slug, to check what it says before proposing a change.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
    },
  },
  {
    name: 'list_manual_pages',
    description:
      "List every Product Manual page (slug, title, section, summary): the manual's table of contents.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_manual_change',
    description:
      `Propose an update to the Product Manual. ${WHEN_TO_PROPOSE} You never edit the manual ` +
      'yourself; a weekly agent checks the proposal against master and applies it. Describe what a ' +
      'person now sees or can do, in plain words (no secrets, strategy or personal data). Returns ' +
      'a trailer line to put in the PR description: "Manual: proposal <id>".',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['edit', 'new_page', 'gap'],
          description:
            'edit: an existing page is now wrong; new_page: a new feature needs a page; gap: something is missing',
        },
        pageSlug: {
          type: 'string',
          description:
            'The affected page (from search_manual), when there is one',
        },
        summary: {
          type: 'string',
          description: 'What should change, in one sentence',
        },
        detail: {
          type: 'string',
          description:
            'What the product now does: the screen, label, route, role or limit',
        },
        prRef: {
          type: 'string',
          description: 'The pull request URL or branch',
        },
      },
      required: ['kind', 'summary'],
    },
  },
];

/**
 * The Product Manual as an MCP server for coding agents (docs/product-manual.md → Proposal MCP).
 * Stateless JSON-RPC over one POST, like the Context Library's MCP: `initialize`, `ping`,
 * `tools/list`, `tools/call`, batches, notifications → 202.
 *
 * The one route in the manual without a feature toggle: a coding agent has no admin session. It is
 * `@Public()` (no JWT) and verifies its own `Bearer pmk_…` key, rate limited per key.
 */
@ApiTags('Product Manual — MCP')
@Controller({ path: 'product-manual', version: '1' })
export class ManualMcpController {
  private readonly logger = LoggerService.getInstance(ManualMcpController.name);

  constructor(
    private readonly keys: ManualAgentKeyService,
    private readonly pages: ManualPageService,
    private readonly search: ManualSearchService,
    private readonly proposals: ManualProposalService,
  ) {}

  @Public()
  @Post('mcp')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async mcp(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: JsonRpcRequest | JsonRpcRequest[],
    @Res() res: Response,
  ): Promise<void> {
    let key: ManualAgentKey;
    try {
      key = await this.keys.verify(authorization);
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 401;
      res.status(status === 429 ? 429 : 401).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: (error as Error).message },
      });
      return;
    }
    const requests = Array.isArray(body) ? body : [body];
    const replies: unknown[] = [];
    for (const request of requests) {
      const reply = await this.handle(request, key);
      if (reply) replies.push(reply);
    }
    if (!replies.length) {
      res.status(202).end();
      return;
    }
    res.json(Array.isArray(body) ? replies : replies[0]);
  }

  private async handle(request: JsonRpcRequest, key: ManualAgentKey) {
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
          serverInfo: { name: 'ally-product-manual', version: '1.0.0' },
          instructions:
            "Ally's Product Manual describes what staff and users see and can do. " +
            `${WHEN_TO_PROPOSE} Find the affected page with search_manual, then call ` +
            'propose_manual_change and put the returned trailer ("Manual: proposal <id>") in the ' +
            'PR description; if nothing a user sees changed, write "Manual: none — <why>". You ' +
            'cannot edit the manual, and the manual text never goes in the repo.',
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: MANUAL_MCP_TOOLS });
      case 'tools/call':
        return ok(
          await this.callTool(
            String(request.params?.name ?? ''),
            request.params?.arguments ?? {},
            key,
          ),
        );
      default:
        return fail(-32601, `Method not found: ${request?.method}`);
    }
  }

  private async callTool(
    name: string,
    args: Record<string, any>,
    key: ManualAgentKey,
  ) {
    const text = (value: unknown, isError = false) => ({
      content: [
        {
          type: 'text',
          text:
            typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        },
      ],
      ...(isError ? { isError: true } : {}),
    });
    try {
      switch (name) {
        case 'search_manual': {
          const q = String(args?.query ?? '').trim();
          if (q.length < 2)
            return text('Search with at least two characters.', true);
          const hits = await this.search.search(q, 10);
          return text(
            hits.map((h) => ({
              slug: h.slug,
              title: h.title,
              section: h.parentTitle,
              snippet: snippetToPlainText(h.snippet),
            })),
          );
        }
        case 'read_manual_page': {
          const slug = String(args?.slug ?? '');
          const page = isValidSlug(slug)
            ? await this.pages.getBySlug(slug)
            : null;
          if (!page) return text(`No page "${slug}". Use search_manual.`, true);
          return text({ ...toPageRow(page), body: page.body });
        }
        case 'list_manual_pages':
          return text(
            (await this.pages.list()).map((p) => ({
              slug: p.slug,
              title: p.title,
              parentSlug: p.parentSlug ?? null,
              kind: p.kind,
              summary: p.summary,
            })),
          );
        case 'propose_manual_change': {
          const proposal = await this.proposals.create({
            kind: args?.kind,
            pageSlug: args?.pageSlug ? String(args.pageSlug) : null,
            summary: String(args?.summary ?? ''),
            detail: args?.detail ? String(args.detail) : '',
            prRef: args?.prRef ? String(args.prRef) : null,
            source: 'coding_agent',
            keyId: key.id,
            submittedBy: key.ownerId,
          });
          return text({
            ok: true,
            proposalId: proposal.id,
            trailer: `Manual: proposal ${proposal.id}`,
          });
        }
        default:
          return text(`Unknown tool "${name}"`, true);
      }
    } catch (error) {
      // ManualWriteError messages (scrubbed, invalid slug, too long) are written to be read.
      const message = (error as Error)?.message ?? 'The call failed.';
      this.logger.warn(`[PRODUCT_MANUAL] MCP ${name} failed: ${message}`);
      return text({ ok: false, error: message }, true);
    }
  }
}
