import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PlanEvent } from '../entity/plan-event.entity';
import { PlanEventKind } from '../enum/product-planning.enum';

/**
 * The plan's append-only "who did what" log. There is deliberately no update
 * or delete here: see PlanEvent.
 */
@Injectable()
export class PlanEventService {
  constructor(
    @InjectRepository(PlanEvent)
    private readonly repository: Repository<PlanEvent>,
  ) {}

  /**
   * Record one event. Pass `manager` to write inside the caller's transaction
   * — a take-on and its `taken_on` row must commit or fail together.
   */
  record(
    input: {
      sessionId: string;
      kind: PlanEventKind;
      actorUserId: number | null;
      detail?: Record<string, unknown> | null;
    },
    manager?: EntityManager,
  ): Promise<PlanEvent> {
    const repository = manager
      ? manager.getRepository(PlanEvent)
      : this.repository;
    return repository.save(
      repository.create({
        sessionId: input.sessionId,
        kind: input.kind,
        actorUserId: input.actorUserId,
        detail: input.detail ?? null,
      }),
    );
  }

  /** Oldest first: the order a timeline reads in. */
  listForSession(sessionId: string): Promise<PlanEvent[]> {
    return this.repository.find({
      where: { sessionId },
      order: { at: 'ASC' },
    });
  }
}
