import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoadmapOpportunityComment } from '../entity/roadmap-opportunity-comment.entity';
import { RoadmapInterviewNote } from '../entity/roadmap-interview-note.entity';
import { RoadmapUserTabOrder } from '../entity/roadmap-user-tab-order.entity';

@Injectable()
export class RoadmapOpportunityCommentRepository extends Repository<RoadmapOpportunityComment> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapOpportunityComment, dataSource.createEntityManager());
  }

  findForOpportunity(
    opportunityId: string,
  ): Promise<RoadmapOpportunityComment[]> {
    return this.find({
      where: { opportunityId },
      order: { createdAt: 'ASC' },
    });
  }
}

@Injectable()
export class RoadmapInterviewNoteRepository extends Repository<RoadmapInterviewNote> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapInterviewNote, dataSource.createEntityManager());
  }

  async search(
    search: string | undefined,
    limit: number,
    offset: number,
  ): Promise<[RoadmapInterviewNote[], number]> {
    const qb = this.createQueryBuilder('n').where('n."deletedAt" IS NULL');
    if (search?.trim()) {
      qb.andWhere(
        '(n."title" ILIKE :q OR n."interviewee" ILIKE :q OR n."summary" ILIKE :q)',
        { q: `%${search.trim()}%` },
      );
    }
    return qb
      .orderBy('n."createdAt"', 'DESC')
      .limit(limit)
      .offset(offset)
      .getManyAndCount();
  }
}

@Injectable()
export class RoadmapUserTabOrderRepository extends Repository<RoadmapUserTabOrder> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapUserTabOrder, dataSource.createEntityManager());
  }
}
