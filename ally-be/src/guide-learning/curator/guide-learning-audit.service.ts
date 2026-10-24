import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentLessonAudit } from 'src/llm-agent/entity/agent-lesson-audit.entity';
import { AgentReleaseAuthorKind } from 'src/llm-agent/harness/enum/harness.enum';
import { AgentLessonAuditAction } from 'src/llm-agent/harness/enum/learning.enum';
import { ALLY_GUIDE_AGENT_KEY } from 'src/guide/release/guide-release.bundle';

/**
 * Writes and reads `agent_lesson_audit` (plans/ally-guide/plan.md §7.13):
 * the curator, delegation stage changes and every step the pipeline takes on
 * its own. Append-only.
 */
@Injectable()
export class GuideLearningAuditService {
  constructor(
    @InjectRepository(AgentLessonAudit)
    private readonly rows: Repository<AgentLessonAudit>,
  ) {}

  record(input: {
    action: AgentLessonAuditAction;
    actorKind: AgentReleaseAuthorKind;
    actorUserId?: number | null;
    lessonId?: string | null;
    releaseId?: string | null;
    detail?: Record<string, unknown>;
  }): Promise<AgentLessonAudit> {
    return this.rows.save(
      this.rows.create({
        agentKey: ALLY_GUIDE_AGENT_KEY,
        action: input.action,
        actorKind: input.actorKind,
        actorUserId: input.actorUserId ?? null,
        lessonId: input.lessonId ?? null,
        releaseId: input.releaseId ?? null,
        detail: input.detail ?? null,
      }),
    );
  }

  list(query: { releaseId?: string; lessonId?: string; limit?: number }) {
    return this.rows.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        ...(query.releaseId ? { releaseId: query.releaseId } : {}),
        ...(query.lessonId ? { lessonId: query.lessonId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(query.limit ?? 100, 1), 500),
    });
  }
}
