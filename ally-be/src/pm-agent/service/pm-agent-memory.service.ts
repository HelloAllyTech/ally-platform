import { Injectable, NotFoundException } from '@nestjs/common';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { PmMemoryKind } from '../enum/pm-agent.enum';
import { PmMemoryResponse, UpdateMemoryDto } from '../dto/pm-agent.dto';
import { PmAgentMemoryRepository } from '../repository/pm-agent.repositories';

/**
 * The agent's memory, as the admin sees and edits it (Agent › Memory). Facts are data the
 * lanes retrieve, never instructions; an admin may correct, deactivate or delete any.
 */
@Injectable()
export class PmAgentMemoryService {
  constructor(private readonly repository: PmAgentMemoryRepository) {}

  async list(): Promise<{
    facts: PmMemoryResponse[];
    lessons: PmMemoryResponse[];
  }> {
    const [facts, lessons] = await Promise.all([
      this.repository.listAll(PmMemoryKind.FACT),
      this.repository.listAll(PmMemoryKind.LESSON),
    ]);
    return {
      facts: facts.map(PmAgentMemoryService.toResponse),
      lessons: lessons.map(PmAgentMemoryService.toResponse),
    };
  }

  async update(
    userId: number,
    id: string,
    dto: UpdateMemoryDto,
  ): Promise<PmMemoryResponse> {
    const row = await this.load(id);
    const patch: Partial<PmAgentMemory> = { updatedBy: userId };
    if (dto.value !== undefined) patch.value = dto.value.trim();
    if (dto.active !== undefined) patch.active = dto.active;
    await this.repository.update({ id }, patch);
    return PmAgentMemoryService.toResponse({ ...row, ...patch });
  }

  async remove(id: string): Promise<PmMemoryResponse> {
    const row = await this.load(id);
    await this.repository.delete({ id });
    return PmAgentMemoryService.toResponse(row);
  }

  private async load(id: string): Promise<PmAgentMemory> {
    const row = await this.repository.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Memory item not found');
    return row;
  }

  static toResponse(row: PmAgentMemory): PmMemoryResponse {
    return {
      id: row.id,
      kind: row.kind,
      key: row.key,
      value: row.value,
      scope: row.scope,
      source: row.source,
      sourceCardId: row.sourceCardId ?? null,
      confidence: row.confidence != null ? Number(row.confidence) : null,
      active: row.active,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      createdBy: row.createdBy ?? null,
      createdAt: new Date(row.createdAt ?? Date.now()).toISOString(),
      updatedAt: new Date(row.updatedAt ?? Date.now()).toISOString(),
    };
  }
}
