import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ClChunk } from '../entity/cl-chunk.entity';
import { ClUseCase } from '../enum/context-library.enum';
import { ContextLlmService } from './context-llm.service';
import { ContextRetrievalService } from './context-retrieval.service';

/** `[FP-0142]`, `[CI-0207, CI-0011]`. Codes are two capitals, a dash, four or more digits. */
const CITATION = /\[((?:[A-Z]{2}-\d{4,})(?:\s*,\s*[A-Z]{2}-\d{4,})*)\]/g;

export function extractCitations(
  text: string,
): Array<{ code: string; index: number }> {
  const out: Array<{ code: string; index: number }> = [];
  for (const match of (text ?? '').matchAll(CITATION)) {
    for (const code of match[1].split(/\s*,\s*/))
      out.push({ code, index: match.index ?? 0 });
  }
  return out;
}

/** Remove the given codes from citations, dropping a bracket that ends up empty. */
export function stripCodes(text: string, codes: Set<string>): string {
  if (!codes.size) return text;
  return (text ?? '').replace(CITATION, (_whole, inner: string) => {
    const kept = inner.split(/\s*,\s*/).filter((c) => !codes.has(c));
    return kept.length ? `[${kept.join(', ')}]` : '';
  });
}

/** The sentence or two around a citation, which is what the verifier judges. */
function contextAround(text: string, index: number): string {
  const start = Math.max(
    0,
    text.lastIndexOf('\n', Math.max(0, index - 400)) + 1,
  );
  const end = text.indexOf('\n', index + 200);
  return text
    .slice(start, end === -1 ? Math.min(text.length, index + 400) : end)
    .trim();
}

/**
 * Citation integrity, for any use case that cites chunks (Builder's PRD, Course Copilot's
 * blueprint).
 *
 * The learning loops reward use, so a citation has to be earned: a code the session was never
 * shown (or that does not exist) is stripped and recorded as `cite_rejected`; the rest go to a
 * small-model check of whether the cited passage really applies the chunk, and only a pass
 * becomes `applied_verified`. Without this an agent learns that citing is rewarded, and the
 * effectiveness score measures citing instead of helping.
 */
@Injectable()
export class ContextCitationService {
  private readonly logger = LoggerService.getInstance(
    ContextCitationService.name,
  );

  constructor(
    private readonly llm: ContextLlmService,
    private readonly retrieval: ContextRetrievalService,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
  ) {}

  /**
   * The database half: find citations `previousText` did not have, reject codes this session
   * was never shown (or that do not exist), and return the text with them stripped. No model
   * call, so it is safe on a save path.
   */
  async validate(args: {
    useCase: ClUseCase;
    sessionId: string;
    text: string;
    previousText?: string | null;
  }): Promise<{ text: string; rejected: string[]; valid: string[] }> {
    const now = extractCitations(args.text);
    const before = new Set(
      extractCitations(args.previousText ?? '').map((c) => c.code),
    );
    const codes = Array.from(
      new Set(now.filter((c) => !before.has(c.code)).map((c) => c.code)),
    );
    if (!codes.length) return { text: args.text, rejected: [], valid: [] };

    const surfaced = await this.retrieval.surfacedCodes(args.sessionId);
    const rows = await this.chunks.find({
      where: { code: In(codes) },
      select: ['id', 'code'],
    });
    const existing = new Set(rows.map((r) => r.code));
    const rejected = codes.filter((c) => !existing.has(c) || !surfaced.has(c));
    const valid = codes.filter((c) => !rejected.includes(c));
    if (rejected.length) {
      await this.retrieval.recordUsage(
        args.useCase,
        { codes: rejected.filter((c) => existing.has(c)) },
        'cite_rejected',
        {
          sessionId: args.sessionId,
        },
      );
    }
    if (valid.length) {
      await this.retrieval.recordUsage(
        args.useCase,
        { codes: valid },
        'cited',
        { sessionId: args.sessionId },
      );
    }
    return { text: stripCodes(args.text, new Set(rejected)), rejected, valid };
  }

  /**
   * The model half: does each cited passage genuinely apply its chunk? Only a pass becomes
   * `applied_verified`. Run it off the request path.
   */
  async verify(args: {
    useCase: ClUseCase;
    sessionId: string;
    text: string;
    codes: string[];
  }): Promise<string[]> {
    if (!args.codes.length) return [];
    const rows = await this.chunks.find({ where: { code: In(args.codes) } });
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const positions = new Map(
      extractCitations(args.text).map((c) => [c.code, c.index]),
    );
    let verified: string[] = [];
    try {
      const { value } = await this.llm.citationCheck<{
        checks?: Array<{ code: string; applied: boolean; note?: string }>;
      }>(
        JSON.stringify({
          citations: args.codes
            .filter((code) => byCode.has(code))
            .map((code) => {
              const chunk = byCode.get(code)!;
              return {
                code,
                chunk: {
                  statement: chunk.statement,
                  body: chunk.body ?? undefined,
                  attributes: chunk.attributes,
                },
                passage: contextAround(args.text, positions.get(code) ?? 0),
              };
            }),
        }),
      );
      verified = (value?.checks ?? [])
        .filter((c) => c.applied && args.codes.includes(c.code))
        .map((c) => c.code);
    } catch (error) {
      // An unverified citation is simply not counted as applied.
      this.logger.warn(`Citation check failed: ${(error as Error).message}`);
    }
    if (verified.length) {
      await this.retrieval.recordUsage(
        args.useCase,
        { codes: verified },
        'applied_verified',
        { sessionId: args.sessionId },
      );
      await this.chunks
        .createQueryBuilder()
        .update()
        .set({
          timesApplied: () => '"times_applied" + 1',
          lastAppliedAt: new Date(),
        })
        .where('code IN (:...codes)', { codes: verified })
        .execute();
    }
    return verified;
  }

  /** Both halves, awaited — for callers without a save path to protect. */
  async process(args: {
    useCase: ClUseCase;
    sessionId: string;
    text: string;
    previousText?: string | null;
  }): Promise<{
    text: string;
    rejected: string[];
    verified: string[];
    unverified: string[];
  }> {
    const { text, rejected, valid } = await this.validate(args);
    const verified = await this.verify({
      useCase: args.useCase,
      sessionId: args.sessionId,
      text,
      codes: valid,
    });
    return {
      text,
      rejected,
      verified,
      unverified: valid.filter((c) => !verified.includes(c)),
    };
  }
}
