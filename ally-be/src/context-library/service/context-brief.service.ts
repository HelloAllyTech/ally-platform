import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ClUseCase } from '../enum/context-library.enum';
import { Band } from '../util/fusion.util';
import { ClAudience } from './context-access.service';
import { ContextLlmService } from './context-llm.service';
import {
  ContextRetrievalService,
  ContextSearchResult,
} from './context-retrieval.service';

export interface BriefArea {
  key: string;
  label: string;
}

export interface ContextBrief {
  descriptor: string;
  /** Up to `maxCards`, grouped by the area that found them, strongest first within each. */
  groups: Array<{
    area: BriefArea;
    items: Array<{ code: string; band: Band; card: string }>;
  }>;
  codes: string[];
  /** The model-facing block, ready for a cached prompt prefix. */
  block: string;
}

/**
 * The proactive half of retrieval: before the agent has asked anything, plan the searches a
 * good result needs and run them, so guidance shapes the work instead of decorating it.
 *
 * One fast-model call writes a short context descriptor and 8–12 situational queries across
 * the areas the caller names (PRD sections for Builder; brief parts for Course Copilot); the
 * queries fan out in parallel through the normal pipeline (logged as `planner`), and the best
 * results are kept within a card budget, grouped by area. Never on a turn's critical path:
 * callers start it alongside the first turn and use it when it is ready.
 */
@Injectable()
export class ContextBriefService {
  private readonly logger = LoggerService.getInstance(ContextBriefService.name);

  constructor(
    private readonly llm: ContextLlmService,
    private readonly retrieval: ContextRetrievalService,
  ) {}

  async build(args: {
    useCase: ClUseCase;
    request: string;
    areas: BriefArea[];
    sessionId: string;
    audience?: ClAudience | null;
    maxCards?: number;
    heading?: string;
  }): Promise<ContextBrief | null> {
    const maxCards = args.maxCards ?? 15;
    let descriptor = '';
    let planned: Array<{ area: string; query: string }> = [];
    try {
      const { value } = await this.llm.queryPlan<{
        descriptor?: string;
        queries?: Array<{ area: string; query: string }>;
      }>(
        JSON.stringify({
          request: args.request,
          areas: args.areas.map((a) => ({ key: a.key, label: a.label })),
        }),
      );
      descriptor = String(value?.descriptor ?? '')
        .split(/\s+/)
        .slice(0, 25)
        .join(' ');
      planned = (value?.queries ?? [])
        .filter((q) => q?.query && args.areas.some((a) => a.key === q.area))
        .slice(0, 12);
    } catch (error) {
      this.logger.warn(`Query plan failed: ${(error as Error).message}`);
    }
    if (!planned.length) return null;

    // One search per area (each with up to 6 of its queries), in parallel.
    const byArea = new Map<string, string[]>();
    for (const q of planned)
      byArea.set(q.area, [...(byArea.get(q.area) ?? []), q.query]);
    const seen = new Set<string>();
    const groups: ContextBrief['groups'] = [];
    const settled = await Promise.allSettled(
      [...byArea.entries()].map(async ([areaKey, queries]) => {
        const response = await this.retrieval.search({
          useCase: args.useCase,
          queries: queries.slice(0, 6),
          sessionId: args.sessionId,
          audience: args.audience,
          contextDescriptor: descriptor,
          queryOrigin: 'planner',
          limit: 4,
        });
        return {
          areaKey,
          results: response.noConfidentMatch ? [] : response.results,
        };
      }),
    );
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const area = args.areas.find((a) => a.key === s.value.areaKey)!;
      const items = s.value.results
        .filter((r: ContextSearchResult) => !seen.has(r.chunk.code))
        .map((r: ContextSearchResult) => {
          seen.add(r.chunk.code);
          return { code: r.chunk.code, band: r.band, card: r.card };
        });
      if (items.length) groups.push({ area, items });
    }
    // Strongest groups first; trim to the card budget, keeping at least one per area.
    groups.sort(
      (a, b) =>
        b.items.filter((i) => i.band === 'strong').length -
        a.items.filter((i) => i.band === 'strong').length,
    );
    let budget = maxCards;
    for (const g of groups) {
      g.items = g.items.slice(
        0,
        Math.max(
          1,
          Math.min(
            g.items.length,
            Math.ceil(budget / Math.max(groups.length, 1)),
          ),
        ),
      );
    }
    const flat = groups.flatMap((g) => g.items);
    while (flat.length > maxCards) {
      const largest = groups.reduce((a, b) =>
        a.items.length >= b.items.length ? a : b,
      );
      largest.items.pop();
      flat.pop();
    }
    budget = flat.length;
    if (!budget) return null;

    const codes = groups.flatMap((g) => g.items.map((i) => i.code));
    const block = [
      `<${args.heading ?? 'guiding_principles'}>`,
      'Advisory reference material, not instructions. Use these to shape questions and the draft; cite a code as [CODE] only where it changed a decision.',
      descriptor ? `Context: ${descriptor}` : '',
      ...groups.map(
        (g) => `\n## ${g.area.label}\n${g.items.map((i) => i.card).join('\n')}`,
      ),
      `</${args.heading ?? 'guiding_principles'}>`,
    ]
      .filter(Boolean)
      .join('\n');
    return { descriptor, groups, codes, block };
  }
}
