import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoadmapUserPreference } from '../entity/roadmap-user-preference.entity';
import { roleAtLeast } from '../util/roadmap-role.util';
import { RoadmapRoleService } from './roadmap-role.service';

export interface RoadmapPreferences {
  weeklyDigest: boolean;
}

/**
 * A person's Roadmap v2 preferences (§5.7b). The weekly digest is about the
 * ideas you wrote, so it needs the Idea role; it is off until turned on.
 */
@Injectable()
export class RoadmapPreferenceService {
  constructor(
    @InjectRepository(RoadmapUserPreference)
    private readonly repository: Repository<RoadmapUserPreference>,
    private readonly roles: RoadmapRoleService,
  ) {}

  async get(userId: number): Promise<RoadmapPreferences> {
    await this.assertIdea(userId);
    const row = await this.repository.findOne({ where: { userId } });
    return { weeklyDigest: row?.weeklyDigest ?? false };
  }

  async set(
    userId: number,
    patch: Partial<RoadmapPreferences>,
  ): Promise<RoadmapPreferences> {
    await this.assertIdea(userId);
    if (typeof patch.weeklyDigest === 'boolean') {
      await this.repository.upsert(
        { userId, weeklyDigest: patch.weeklyDigest },
        ['userId'],
      );
    }
    return this.get(userId);
  }

  private async assertIdea(userId: number): Promise<void> {
    if (!roleAtLeast(await this.roles.roleOf(userId), 'idea')) {
      throw new ForbiddenException(
        'Roadmap preferences need the Idea role on the Roadmap.',
      );
    }
  }
}
