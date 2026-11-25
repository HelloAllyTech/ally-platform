import { Injectable, NotFoundException } from '@nestjs/common';
import { RoadmapOpportunityComment } from '../entity/roadmap-opportunity-comment.entity';
import { RoadmapOpportunityCommentRepository } from '../repository/roadmap-content.repository';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import { CreateCommentDto } from '../dto/roadmap-content.dto';

@Injectable()
export class RoadmapCommentService {
  constructor(
    private readonly commentRepository: RoadmapOpportunityCommentRepository,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
  ) {}

  async list(opportunityId: string): Promise<RoadmapOpportunityComment[]> {
    return this.commentRepository.findForOpportunity(opportunityId);
  }

  async create(
    userId: number,
    opportunityId: string,
    dto: CreateCommentDto,
  ): Promise<RoadmapOpportunityComment> {
    const opportunity = await this.opportunityRepository.findOne({
      where: { id: opportunityId },
    });
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }

    const saved = await this.commentRepository.save(
      this.commentRepository.create({
        opportunityId,
        body: dto.body.trim(),
        createdBy: userId,
        updatedBy: userId,
      }),
    );

    return saved;
  }
}
