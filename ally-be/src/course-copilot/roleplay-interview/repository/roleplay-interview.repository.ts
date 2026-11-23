import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoleplayInterviewSession } from '../../entity/roleplay-interview-session.entity';
import { RoleplayInterviewMessage } from '../../entity/roleplay-interview-message.entity';
import { RoleplayInterviewMessageRole } from '../type/roleplay-interview.type';

@Injectable()
export class RoleplayInterviewSessionRepository extends Repository<RoleplayInterviewSession> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplayInterviewSession, dataSource.createEntityManager());
  }
}

@Injectable()
export class RoleplayInterviewMessageRepository extends Repository<RoleplayInterviewMessage> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplayInterviewMessage, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<RoleplayInterviewMessage[]> {
    return this.find({ where: { sessionId }, order: { seq: 'ASC' } });
  }

  /**
   * Append with the next per-session seq. The session row is locked for the
   * transaction (it has no counter column), so two appenders serialise rather
   * than collide on the (sessionId, seq) unique index; the turn lock already
   * keeps that rare.
   */
  async appendMessage(
    sessionId: string,
    message: {
      role: RoleplayInterviewMessageRole;
      content?: string | null;
      toolCalls?: Record<string, any>[] | null;
      toolResults?: Record<string, any>[] | null;
      metadata?: Record<string, any> | null;
      createdBy?: number;
    },
  ): Promise<RoleplayInterviewMessage> {
    return this.dataSource.transaction(async (em) => {
      const locked = await em.query(
        `UPDATE "roleplay_interview_sessions" SET "updatedAt" = now()
          WHERE id = $1 RETURNING id`,
        [sessionId],
      );
      const rows = Array.isArray(locked?.[0]) ? locked[0] : locked;
      if (!rows?.length) {
        throw new NotFoundException(
          `Roleplay interview session not found: ${sessionId}`,
        );
      }
      const [{ next }] = await em.query(
        `SELECT COALESCE(MAX("seq"), 0) + 1 AS next
           FROM "roleplay_interview_messages" WHERE "sessionId" = $1`,
        [sessionId],
      );
      const repo = em.getRepository(RoleplayInterviewMessage);
      return repo.save(
        repo.create({ sessionId, seq: Number(next), ...message }),
      );
    });
  }
}
