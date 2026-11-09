import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ClChunk } from '../entity/cl-chunk.entity';
import { ClCollection } from '../entity/cl-collection.entity';
import { ClLoopAction } from '../entity/cl-loop.entity';
import {
  ClChunkConfidence,
  ClChunkStatus,
  ClLoop,
  ClLoopActionType,
} from '../enum/context-library.enum';
import { RetrievalDefaults } from '../profiles';
import { ContextChunkService } from './context-chunk.service';

export interface LoopActionInput {
  collectionId: string;
  loop: ClLoop;
  action: ClLoopActionType;
  chunkId?: string | null;
  reason: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
}

/**
 * The loops' audit trail and its Undo. Nothing a loop does is final: every action stores the
 * state it replaced, and an admin can put it back from Insights → What changed?. An undone
 * action is also a signal — the loop that took it will not take it again on the same chunk.
 */
@Injectable()
export class ContextLoopActionsService {
  constructor(
    @InjectRepository(ClLoopAction)
    private readonly actions: Repository<ClLoopAction>,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
    @InjectRepository(ClCollection)
    private readonly collections: Repository<ClCollection>,
    private readonly chunkService: ContextChunkService,
  ) {}

  record(input: LoopActionInput): Promise<ClLoopAction> {
    return this.actions.save(
      this.actions.create({
        collectionId: input.collectionId,
        loop: input.loop,
        action: input.action,
        chunkId: input.chunkId ?? null,
        reason: input.reason.slice(0, 1000),
        before: input.before ?? null,
        after: input.after ?? null,
        evidence: input.evidence ?? null,
      }),
    );
  }

  /** Chunk ids an admin has overruled for this kind of action. */
  async overruled(
    collectionId: string,
    action: ClLoopActionType,
  ): Promise<Set<string>> {
    const rows = await this.actions.find({
      where: { collectionId, action, undoneAt: Not(IsNull()) },
      select: ['chunkId'],
    });
    return new Set(rows.map((r) => r.chunkId).filter(Boolean) as string[]);
  }

  async list(collectionId: string, limit = 50, before?: Date) {
    const qb = this.actions
      .createQueryBuilder('a')
      .where('a.collection_id = :collectionId', { collectionId })
      .orderBy('a."createdAt"', 'DESC')
      .limit(Math.min(Math.max(limit, 1), 200));
    if (before) qb.andWhere('a."createdAt" < :before', { before });
    const rows = await qb.getMany();
    const ids = rows.map((r) => r.chunkId).filter(Boolean) as string[];
    const codes = ids.length
      ? new Map(
          (
            await this.chunks.find({
              where: ids.map((id) => ({ id })),
              select: ['id', 'code'],
            })
          ).map((c) => [c.id, c.code]),
        )
      : new Map<string, string>();
    return rows.map((r) => ({
      id: r.id,
      loop: r.loop,
      action: r.action,
      code: r.chunkId ? (codes.get(r.chunkId) ?? null) : null,
      reason: r.reason,
      evidence: r.evidence ?? null,
      createdAt: r.createdAt,
      undoneAt: r.undoneAt ?? null,
      canUndo: !r.undoneAt,
    }));
  }

  async undo(actionId: string, userId: number | null): Promise<ClLoopAction> {
    const action = await this.actions.findOne({ where: { id: actionId } });
    if (!action) throw new NotFoundException('No such change.');
    if (action.undoneAt)
      throw new BadRequestException('This change has already been undone.');
    const before = action.before ?? {};

    switch (action.action) {
      case ClLoopActionType.ARCHIVE:
      case ClLoopActionType.DEMOTE:
      case ClLoopActionType.PROMOTE: {
        const chunk = await this.requireChunk(action.chunkId);
        await this.chunkService.snapshot(chunk, 'undo', userId);
        if (before.status) chunk.status = before.status as ClChunkStatus;
        if (before.confidence)
          chunk.confidence = before.confidence as ClChunkConfidence;
        await this.chunkService.saveChanged(chunk, 'undo', userId);
        break;
      }
      case ClLoopActionType.LEARN_QUERY: {
        const chunk = await this.requireChunk(action.chunkId);
        const query = String(action.after?.query ?? '').toLowerCase();
        chunk.exampleQueries = (chunk.exampleQueries ?? []).filter(
          (q) => !(q.origin === 'learned' && q.text.toLowerCase() === query),
        );
        // Remember the refusal, so the same wording is never learned onto this chunk again.
        const rejected = new Set<string>(
          ((chunk.quality as any)?.rejectedQueries ?? []) as string[],
        );
        rejected.add(query);
        chunk.quality = {
          ...(chunk.quality ?? {}),
          rejectedQueries: [...rejected].slice(-50),
        };
        await this.chunkService.saveChanged(chunk, 'undo', userId);
        break;
      }
      case ClLoopActionType.MERGE: {
        const absorbed = await this.requireChunk(action.chunkId);
        await this.chunkService.snapshot(absorbed, 'undo', userId);
        absorbed.status = ClChunkStatus.ACTIVE;
        absorbed.supersededById = null;
        await this.chunkService.saveChanged(absorbed, 'undo', userId);
        const keepId = String(before.keepId ?? '');
        if (keepId && typeof before.keepSourceCount === 'number') {
          await this.chunks.update(
            { id: keepId },
            { sourceCount: before.keepSourceCount },
          );
        }
        break;
      }
      case ClLoopActionType.PROMOTE_SETUP:
      case ClLoopActionType.ROLLBACK_SETUP: {
        await this.collections.update(
          { id: action.collectionId },
          {
            activeSearchSetup:
              (before.setup as RetrievalDefaults | null) ?? null,
            previousSearchSetup:
              (action.after?.setup as RetrievalDefaults | null) ?? null,
            setupPromotedAt: new Date(),
          },
        );
        break;
      }
      default:
        throw new BadRequestException('This change cannot be undone.');
    }

    action.undoneAt = new Date();
    action.undoneBy = userId;
    return this.actions.save(action);
  }

  private async requireChunk(id?: string | null): Promise<ClChunk> {
    const chunk = id ? await this.chunks.findOne({ where: { id } }) : null;
    if (!chunk) throw new NotFoundException('That entry no longer exists.');
    return chunk;
  }
}
