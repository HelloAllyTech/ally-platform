import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CreateIdeaDraftDto,
  UpdateIdeaDraftDto,
} from '../dto/roadmap-idea-draft.dto';
import { RoadmapIdeaDraft } from '../entity/roadmap-idea-draft.entity';

/**
 * Private idea drafts. Every query is scoped to the caller's own user id, and a draft that is
 * somebody else's answers 404 rather than 403 so ids cannot be probed.
 */
@Injectable()
export class RoadmapIdeaDraftService {
  constructor(
    @InjectRepository(RoadmapIdeaDraft)
    private readonly repository: Repository<RoadmapIdeaDraft>,
  ) {}

  async list(userId: number) {
    const [items, count] = await this.repository.findAndCount({
      where: { ownerUserId: userId },
      order: { updatedAt: 'DESC' },
      take: 200,
    });
    return { items, count };
  }

  create(userId: number, dto: CreateIdeaDraftDto): Promise<RoadmapIdeaDraft> {
    return this.repository.save(
      this.repository.create({
        ownerUserId: userId,
        rawText: dto.rawText.trim(),
        captureMode: dto.captureMode ?? 'typed',
      }),
    );
  }

  async update(
    userId: number,
    id: string,
    dto: UpdateIdeaDraftDto,
  ): Promise<RoadmapIdeaDraft> {
    const draft = await this.own(userId, id);
    if (dto.rawText !== undefined) draft.rawText = dto.rawText.trim();
    if (dto.captureMode !== undefined) draft.captureMode = dto.captureMode;
    return this.repository.save(draft);
  }

  async remove(userId: number, id: string): Promise<void> {
    const draft = await this.own(userId, id);
    await this.repository.softRemove(draft);
  }

  private async own(userId: number, id: string): Promise<RoadmapIdeaDraft> {
    const draft = await this.repository.findOne({
      where: { id, ownerUserId: userId },
    });
    if (!draft) throw new NotFoundException('Idea draft not found');
    return draft;
  }
}
