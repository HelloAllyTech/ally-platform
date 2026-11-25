import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapProductGoal } from '../entity/roadmap-product-goal.entity';
import { RoadmapProductGoalRepository } from '../repository/roadmap-taxonomy.repository';

@Injectable()
export class RoadmapTaxonomyService {
  constructor(private readonly goalRepository: RoadmapProductGoalRepository) {}

  // ── product goals ──────────────────────────────────────────────────────────

  listGoals(): Promise<RoadmapProductGoal[]> {
    return this.goalRepository.findAllOrdered();
  }

  async createGoal(userId: number, name: string): Promise<RoadmapProductGoal> {
    const trimmed = name.trim();
    if (await this.goalRepository.findOne({ where: { name: trimmed } })) {
      throw new ConflictException(
        `A product goal named "${trimmed}" already exists`,
      );
    }
    const position = await this.goalRepository.count();
    const saved = await this.goalRepository.save(
      this.goalRepository.create({ name: trimmed, position }),
    );
    return saved;
  }

  /**
   * Rename. The FK on roadmap_opportunities.productGoal is ON UPDATE CASCADE, so every
   * opportunity follows automatically — and so do the goal names stored inside saved-view
   * state, which is exactly why the FK is by name rather than by uuid.
   */
  async renameGoal(
    userId: number,
    id: string,
    nextName: string,
  ): Promise<RoadmapProductGoal> {
    const goal = await this.goalRepository.findOne({ where: { id } });
    if (!goal) throw new NotFoundException(`Product goal ${id} not found`);
    const currentName = goal.name;

    const trimmed = nextName.trim();
    if (
      trimmed !== currentName &&
      (await this.goalRepository.findOne({ where: { name: trimmed } }))
    ) {
      throw new ConflictException(
        `A product goal named "${trimmed}" already exists`,
      );
    }

    goal.name = trimmed;
    const saved = await this.goalRepository.save(goal);
    return saved;
  }

  /**
   * Delete. The FK is ON DELETE RESTRICT, so this would fail at the database level with a 500;
   * check usage first and answer 409 with the count instead.
   */
  async deleteGoal(userId: number, id: string): Promise<void> {
    const goal = await this.goalRepository.findOne({ where: { id } });
    if (!goal) throw new NotFoundException(`Product goal ${id} not found`);
    const name = goal.name;

    const usage = await this.goalRepository.countUsage(name);
    if (usage > 0) {
      throw new ConflictException(
        `"${name}" is still assigned to ${usage} opportunit${usage === 1 ? 'y' : 'ies'}. ` +
          `Reassign them before deleting the goal.`,
      );
    }

    await this.goalRepository.remove(goal);
  }

  async getGoalUsage(): Promise<Record<string, number>> {
    const goals = await this.goalRepository.findAllOrdered();
    const entries = await Promise.all(
      goals.map(
        async (g) =>
          [g.name, await this.goalRepository.countUsage(g.name)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
}
