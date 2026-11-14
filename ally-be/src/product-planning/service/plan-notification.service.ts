import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PlanNotification } from '../entity/plan-notification.entity';
import { PlanNotificationKind } from '../enum/product-planning.enum';

/**
 * In-app notices for plan authors and leads (see PlanNotification).
 *
 * Never throws to its caller: a notice failing to save must not undo the take
 * on, the filing or the review it reports. Deduplicated: an unread notice of
 * the same kind for the same plan and person is refreshed, not repeated, which
 * is what keeps it to at most one per plan per person per kind.
 */
@Injectable()
export class PlanNotificationService {
  constructor(
    @InjectRepository(PlanNotification)
    private readonly repository: Repository<PlanNotification>,
  ) {}

  async notify(
    recipientUserId: number | null | undefined,
    sessionId: string,
    kind: PlanNotificationKind,
    message: string,
  ): Promise<void> {
    if (!recipientUserId) return;
    try {
      const unread = await this.repository.findOne({
        where: { recipientUserId, sessionId, kind, readAt: IsNull() },
      });
      if (unread) {
        await this.repository.update({ id: unread.id }, { message });
        return;
      }
      await this.repository.save(
        this.repository.create({ recipientUserId, sessionId, kind, message }),
      );
    } catch {
      // Best effort by design; see the class comment.
    }
  }

  listFor(recipientUserId: number, limit = 50): Promise<PlanNotification[]> {
    return this.repository.find({
      where: { recipientUserId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async markRead(recipientUserId: number, id?: string): Promise<void> {
    await this.repository.update(
      id
        ? { id, recipientUserId, readAt: IsNull() }
        : { recipientUserId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }
}
