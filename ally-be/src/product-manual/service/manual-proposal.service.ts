import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ManualProposal } from '../entity/manual-proposal.entity';
import {
  ManualProposalKind,
  ManualProposalSource,
  ManualProposalStatus,
  ManualWriteError,
  ProposalView,
} from '../type/manual.types';
import { isValidSlug } from '../util/manual-slug.util';
import { ManualScrubService } from './manual-scrub.service';

const KINDS: ManualProposalKind[] = ['edit', 'new_page', 'gap'];
const SOURCES: ManualProposalSource[] = [
  'coding_agent',
  'chat',
  'weekly_agent',
];
const STATUSES: ManualProposalStatus[] = ['open', 'applied', 'dismissed'];
const SUMMARY_MAX = 1_000;
const DETAIL_MAX = 20_000;
const PR_REF_MAX = 200;

export function toProposalView(p: ManualProposal): ProposalView {
  return {
    id: p.id,
    kind: p.kind,
    pageSlug: p.pageSlug ?? null,
    summary: p.summary,
    detail: p.detail ?? '',
    prRef: p.prRef ?? null,
    source: p.source,
    submittedBy: p.submittedBy ?? null,
    status: p.status,
    appliedRevisionId: p.appliedRevisionId ?? null,
    resolvedAt: p.resolvedAt ? new Date(p.resolvedAt).toISOString() : null,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

/** "The manual needs to change" notes: filed by coding agents and chat; applied by the weekly agent. */
@Injectable()
export class ManualProposalService {
  constructor(
    @InjectRepository(ManualProposal)
    private readonly proposals: Repository<ManualProposal>,
    private readonly scrub: ManualScrubService,
  ) {}

  async create(input: {
    kind: ManualProposalKind;
    pageSlug?: string | null;
    summary: string;
    detail?: string;
    prRef?: string | null;
    source: ManualProposalSource;
    keyId?: string | null;
    submittedBy?: number | null;
  }): Promise<ManualProposal> {
    if (!KINDS.includes(input.kind)) {
      throw new ManualWriteError(
        'invalid',
        'kind must be "edit", "new_page" or "gap".',
      );
    }
    if (!SOURCES.includes(input.source)) {
      throw new ManualWriteError('invalid', 'Unknown proposal source.');
    }
    const summary =
      typeof input.summary === 'string' ? input.summary.trim() : '';
    if (!summary) {
      throw new ManualWriteError(
        'invalid',
        'A proposal needs a one-sentence summary.',
      );
    }
    if (summary.length > SUMMARY_MAX) {
      throw new ManualWriteError(
        'too_large',
        `The summary is over ${SUMMARY_MAX} characters.`,
      );
    }
    const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
    if (detail.length > DETAIL_MAX) {
      throw new ManualWriteError(
        'too_large',
        `The detail is over ${DETAIL_MAX} characters.`,
      );
    }
    const pageSlug = input.pageSlug ? input.pageSlug : null;
    if (pageSlug && !isValidSlug(pageSlug)) {
      throw new ManualWriteError(
        'invalid_slug',
        'pageSlug is not a valid slug.',
      );
    }
    const prRef = input.prRef
      ? String(input.prRef).trim().slice(0, PR_REF_MAX)
      : null;
    for (const [field, text] of [
      ['summary', summary],
      ['detail', detail],
    ] as const) {
      const verdict = this.scrub.check(text);
      if (!verdict.ok) {
        throw new ManualWriteError(
          'scrubbed',
          `The ${field}: ${verdict.reason}`,
        );
      }
    }
    return this.proposals.save(
      this.proposals.create({
        kind: input.kind,
        pageSlug,
        summary,
        detail,
        prRef,
        source: input.source,
        keyId: input.keyId ?? null,
        submittedBy: input.submittedBy ?? null,
        status: 'open',
      }),
    );
  }

  /** Open proposals, oldest first: the weekly agent's work order. */
  listOpen(limit = 50): Promise<ManualProposal[]> {
    return this.proposals.find({
      where: { status: 'open' },
      order: { createdAt: 'ASC' },
      take: Math.min(Math.max(Math.floor(limit) || 50, 1), 500),
    });
  }

  /** Newest first, for the admin list. */
  list(status?: ManualProposalStatus, limit = 100): Promise<ManualProposal[]> {
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new ManualWriteError(
        'invalid',
        'status must be "open", "applied" or "dismissed".',
      );
    }
    return this.proposals.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(Math.floor(limit) || 100, 1), 500),
    });
  }

  async markApplied(id: string, revisionId: string | null): Promise<void> {
    await this.proposals.update(
      { id, status: 'open' },
      {
        status: 'applied',
        appliedRevisionId: revisionId,
        resolvedAt: new Date(),
      },
    );
  }

  async dismiss(id: string): Promise<void> {
    const result = await this.proposals.update(
      { id, status: 'open' },
      { status: 'dismissed', resolvedAt: new Date() },
    );
    if (!result.affected) {
      throw new NotFoundException('No open proposal with that id.');
    }
  }

  async countOpen(): Promise<{ proposals: number; gaps: number }> {
    const rows: { kind: string; n: string }[] = await this.proposals
      .createQueryBuilder('p')
      .select('p.kind', 'kind')
      .addSelect('COUNT(*)', 'n')
      .where('p.status = :status', { status: 'open' })
      .groupBy('p.kind')
      .getRawMany();
    let proposals = 0;
    let gaps = 0;
    for (const row of rows) {
      if (row.kind === 'gap') gaps += Number(row.n);
      else proposals += Number(row.n);
    }
    return { proposals, gaps };
  }
}
