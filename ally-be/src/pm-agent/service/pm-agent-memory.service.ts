import { Injectable, NotFoundException } from '@nestjs/common';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { PmMemoryKind } from '../enum/pm-agent.enum';
import {
  PmLessonResponse,
  PmMemoryResponse,
  UpdateMemoryDto,
} from '../dto/pm-agent.dto';
import { PmAgentMemoryRepository } from '../repository/pm-agent.repositories';
import {
  lessonEditPatch,
  lessonRemovePatch,
  toLessonResponse,
} from '../lessons/pm-lesson-admin';
import { PmAgentEventsService } from './pm-agent-events.service';

/**
 * The agent's memory, as the admin sees and edits it (Agent › Memory). Facts are data the
 * lanes retrieve, never instructions; an admin may correct, deactivate or delete any.
 * Lessons (kind `lesson`, from the weekly job) share the routes but not the semantics:
 * editing one makes it `manual` and active, deleting one marks it `removed` (soft, so the
 * job does not propose it again) — see lessons/pm-lesson-admin.ts.
 */
@Injectable()
export class PmAgentMemoryService {
  constructor(
    private readonly repository: PmAgentMemoryRepository,
    private readonly events: PmAgentEventsService,
  ) {}

  async list(): Promise<{
    facts: PmMemoryResponse[];
    lessons: PmLessonResponse[];
  }> {
    const [facts, lessons] = await Promise.all([
      this.repository.listAll(PmMemoryKind.FACT),
      this.repository.listAll(PmMemoryKind.LESSON),
    ]);
    return {
      facts: facts.map(PmAgentMemoryService.toResponse),
      lessons: lessons.map(toLessonResponse),
    };
  }

  async update(
    userId: number,
    id: string,
    dto: UpdateMemoryDto,
  ): Promise<PmMemoryResponse | PmLessonResponse> {
    const row = await this.load(id);
    if (row.kind === PmMemoryKind.LESSON) {
      const lessonPatch = lessonEditPatch(row, dto, userId, new Date());
      await this.repository.update({ id }, lessonPatch as never);
      this.events.stateUpdated();
      return toLessonResponse({ ...row, ...lessonPatch });
    }
    const patch: Partial<PmAgentMemory> = { updatedBy: userId };
    if (dto.value !== undefined) patch.value = dto.value.trim();
    if (dto.active !== undefined) patch.active = dto.active;
    await this.repository.update({ id }, patch);
    this.events.stateUpdated();
    return PmAgentMemoryService.toResponse({ ...row, ...patch });
  }

  /** Facts are deleted; a lesson becomes `removed` (soft). */
  async remove(
    id: string,
    userId: number | null = null,
  ): Promise<PmMemoryResponse | PmLessonResponse> {
    const row = await this.load(id);
    if (row.kind === PmMemoryKind.LESSON) {
      const lessonPatch = lessonRemovePatch(row, userId, new Date());
      await this.repository.update({ id }, lessonPatch as never);
      this.events.stateUpdated();
      return toLessonResponse({ ...row, ...lessonPatch });
    }
    await this.repository.delete({ id });
    this.events.stateUpdated();
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
