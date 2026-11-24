import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import { RoleplayInterviewSession } from '../../entity/roleplay-interview-session.entity';
import { RoleplayInterviewMessage } from '../../entity/roleplay-interview-message.entity';
import {
  RoleplayInterviewMessageRepository,
  RoleplayInterviewSessionRepository,
} from '../repository/roleplay-interview.repository';
import {
  RoleplayInterviewGeneration,
  RoleplayInterviewMessageRole,
  RoleplayInterviewMessageView,
  RoleplayInterviewSessionView,
  RoleplayInterviewStatus,
} from '../type/roleplay-interview.type';
import {
  composeGeneration,
  stillNeeded,
} from '../util/roleplay-interview-brief.util';

/**
 * Session lifecycle and the non-streaming REST around it. The streamed turn
 * is RoleplayInterviewOrchestratorService's. A session is private to the
 * trainer who started it.
 */
@Injectable()
export class RoleplayInterviewSessionService {
  constructor(
    private readonly sessionRepository: RoleplayInterviewSessionRepository,
    private readonly messageRepository: RoleplayInterviewMessageRepository,
  ) {}

  /** The caller's open interview for this roleplay (or unsaved one), else a new one. */
  async createOrResume(
    userId: number,
    tenantId: string | null,
    scenarioId?: number | null,
  ): Promise<RoleplayInterviewSessionView> {
    // A saved roleplay reopens its own interview, finished or not. A roleplay not saved yet only
    // picks up an interview still in progress: an approved one has already built its roleplay,
    // and handing it to the next new roleplay would show someone else's finished plan.
    const existing = await this.sessionRepository.findOne({
      where: {
        createdBy: userId,
        scenarioId: scenarioId ? scenarioId : IsNull(),
        status: scenarioId
          ? Not(RoleplayInterviewStatus.ABANDONED)
          : In([
              RoleplayInterviewStatus.INTERVIEWING,
              RoleplayInterviewStatus.PLAN_READY,
            ]),
      },
      order: { updatedAt: 'DESC' },
    });
    if (existing) return this.view(existing);
    const created = await this.sessionRepository.save(
      this.sessionRepository.create({
        createdBy: userId,
        tenantId: tenantId ?? null,
        scenarioId: scenarioId ?? null,
        status: RoleplayInterviewStatus.INTERVIEWING,
        brief: {},
        plan: null,
        planVersion: 0,
      }),
    );
    return this.view(created);
  }

  async getSession(
    sessionId: string,
    userId: number,
  ): Promise<RoleplayInterviewSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Roleplay interview session not found');
    }
    if (session.createdBy !== userId) {
      throw new ForbiddenException('Not your roleplay interview');
    }
    return session;
  }

  view(session: RoleplayInterviewSession): RoleplayInterviewSessionView {
    return {
      id: session.id,
      status: session.status,
      brief: session.brief ?? {},
      stillNeeded: stillNeeded(session.brief),
      plan: session.plan ?? null,
      planVersion: session.planVersion ?? 0,
      scenarioId: session.scenarioId ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  messageView(message: RoleplayInterviewMessage): RoleplayInterviewMessageView {
    const meta = message.metadata ?? {};
    if (message.role === RoleplayInterviewMessageRole.USER) {
      return {
        seq: message.seq,
        role: message.role,
        content: meta.displayText ?? message.content ?? null,
      };
    }
    return {
      seq: message.seq,
      role: message.role,
      content: message.content ?? null,
      ...(Array.isArray(meta.questions) && meta.questions.length
        ? { questions: meta.questions }
        : {}),
      ...(meta.receipt ? { receipt: meta.receipt } : {}),
      ...(meta.plan ? { plan: meta.plan } : {}),
      ...(meta.errorMessage ? { error: meta.errorMessage } : {}),
    };
  }

  async getWithMessages(
    sessionId: string,
    userId: number,
  ): Promise<{
    session: RoleplayInterviewSessionView;
    messages: RoleplayInterviewMessageView[];
  }> {
    const session = await this.getSession(sessionId, userId);
    const messages = await this.messageRepository.listBySession(sessionId);
    return {
      session: this.view(session),
      messages: messages.map((message) => this.messageView(message)),
    };
  }

  /**
   * Approve the plan the trainer is looking at. 409 when there is no plan,
   * when it is not the latest version, or when the brief changed since it was
   * drafted (the session went back to INTERVIEWING). Re-approving the
   * approved version is allowed: the web may retry.
   */
  async approve(
    sessionId: string,
    userId: number,
    planVersion: number,
  ): Promise<{
    session: RoleplayInterviewSessionView;
    generation: RoleplayInterviewGeneration;
  }> {
    const session = await this.getSession(sessionId, userId);
    if (!session.plan) {
      throw new ConflictException('There is no plan to approve yet.');
    }
    if (planVersion !== session.planVersion) {
      throw new ConflictException(
        `This plan is out of date: the latest is version ${session.planVersion}.`,
      );
    }
    if (
      session.status !== RoleplayInterviewStatus.PLAN_READY &&
      session.status !== RoleplayInterviewStatus.APPROVED
    ) {
      throw new ConflictException(
        'The brief changed since this plan was drafted. Ask for an updated plan.',
      );
    }
    if (session.status !== RoleplayInterviewStatus.APPROVED) {
      session.status = RoleplayInterviewStatus.APPROVED;
      session.approvedAt = new Date();
      await this.sessionRepository.save(session);
    }
    return {
      session: this.view(session),
      generation: composeGeneration(session.brief ?? {}, session.plan),
    };
  }

  /** Link the session to the roleplay the trainer saved. */
  async linkScenario(
    sessionId: string,
    userId: number,
    scenarioId: number,
  ): Promise<RoleplayInterviewSessionView> {
    const session = await this.getSession(sessionId, userId);
    session.scenarioId = scenarioId;
    return this.view(await this.sessionRepository.save(session));
  }

  /** Start over: the session stops being resumed. Idempotent. */
  async abandon(
    sessionId: string,
    userId: number,
  ): Promise<RoleplayInterviewSessionView> {
    const session = await this.getSession(sessionId, userId);
    if (session.status !== RoleplayInterviewStatus.ABANDONED) {
      session.status = RoleplayInterviewStatus.ABANDONED;
      await this.sessionRepository.save(session);
    }
    return this.view(session);
  }
}
