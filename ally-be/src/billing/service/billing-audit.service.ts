import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BillingAudit } from '../entity/billing-audit.entity';

export interface AuditEntry {
  subjectType: string;
  subjectId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  note: string;
  actorUserId: number | null;
}

/** The history of every CR1 admin change. A change without a note is refused (CR1: "every change needs a note"). */
@Injectable()
export class BillingAuditService {
  constructor(private readonly dataSource: DataSource) {}

  static requireNote(note: unknown): string {
    const text = typeof note === 'string' ? note.trim() : '';
    if (!text) throw new BadRequestException('Add a note saying why.');
    if (text.length > 1000) {
      throw new BadRequestException('Keep the note under 1,000 characters.');
    }
    return text;
  }

  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repo = (manager ?? this.dataSource.manager).getRepository(
      BillingAudit,
    );
    await repo.save(
      repo.create({
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        action: entry.action,
        before: toJson(entry.before),
        after: toJson(entry.after),
        note: BillingAuditService.requireNote(entry.note),
        actorUserId: entry.actorUserId,
      }),
    );
  }

  async historyOf(
    subjectType: string | string[],
    subjectId?: string,
    limit = 200,
  ): Promise<
    Array<
      BillingAudit & { actorName: string | null; actorEmail: string | null }
    >
  > {
    const types = Array.isArray(subjectType) ? subjectType : [subjectType];
    // Who made each change, by name, so the history doesn't read "user #7".
    return this.dataSource.query(
      `SELECT a.*, u.name AS "actorName", u.email AS "actorEmail"
         FROM billing_audit a LEFT JOIN users u ON u.id = a."actorUserId"
        WHERE a."subjectType" = ANY($1) AND ($2::varchar IS NULL OR a."subjectId" = $2)
        ORDER BY a."createdAt" DESC LIMIT $3`,
      [types, subjectId ?? null, limit],
    );
  }
}

const toJson = (value: unknown): Record<string, unknown> | null =>
  value === undefined || value === null
    ? null
    : (JSON.parse(JSON.stringify(value)) as Record<string, unknown>);
