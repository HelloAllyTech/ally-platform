import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { isResponderOnly } from '../access/chatbot-roles';
import {
  RESPONDER_AGREEMENT_TEXT,
  RESPONDER_AGREEMENT_VERSION,
} from './members.copy';

export const RESPONDER_AGREEMENT_ERROR = 'responder_agreement_required';

/**
 * Kill switch: `RESPONDER_AGREEMENT_ENFORCED=false` stops the server-side check (on otherwise),
 * e.g. while the dashboard's accept screen is not yet released. Read per call, never at load.
 */
export const responderAgreementEnforced = (): boolean =>
  (process.env.RESPONDER_AGREEMENT_ENFORCED ?? 'true').toLowerCase() !==
  'false';

export interface ResponderAgreementStatus {
  currentVersion: string;
  text: string;
  /** Accepted the current version. */
  accepted: boolean;
  /** The newest version they accepted, if any. */
  acceptedVersion: string | null;
  acceptedAt: Date | null;
  /** Whether the server enforces it now (the kill switch). */
  enforced: boolean;
}

/**
 * The responder agreement (Stage 1b): stored per person and version, required of anyone who
 * responds — a Responder, and an owner or editor who takes a chat over.
 *
 * A new version blocks only NEW take-overs: a chat a person already holds stays theirs to read,
 * reply in and hand back. Reading a thread needs it only for a responder-only member (an owner,
 * editor or viewer reads conversations as part of that role).
 */
@Injectable()
export class ResponderAgreementService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async status(userId: number): Promise<ResponderAgreementStatus> {
    const rows = await this.dataSource.query<
      { version: string; accepted_at: Date }[]
    >(
      `SELECT version, accepted_at FROM responder_agreements
        WHERE user_id = $1 ORDER BY accepted_at DESC`,
      [userId],
    );
    const current = rows.find((r) => r.version === RESPONDER_AGREEMENT_VERSION);
    return {
      currentVersion: RESPONDER_AGREEMENT_VERSION,
      text: RESPONDER_AGREEMENT_TEXT,
      accepted: !!current,
      acceptedVersion: current?.version ?? rows[0]?.version ?? null,
      acceptedAt: current?.accepted_at ?? rows[0]?.accepted_at ?? null,
      enforced: responderAgreementEnforced(),
    };
  }

  /** Accept `version`, which must be the current one (a stale screen gets 409). */
  async accept(
    userId: number,
    version: string,
    ip: string | null,
  ): Promise<ResponderAgreementStatus> {
    if (version !== RESPONDER_AGREEMENT_VERSION) {
      throw new ConflictException({
        errorCode: 'stale_version',
        message: 'The agreement has changed. Read the new version.',
        details: { currentVersion: RESPONDER_AGREEMENT_VERSION },
      });
    }
    await this.dataSource.query(
      `INSERT INTO responder_agreements (user_id, version, ip)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, version) DO NOTHING`,
      [userId, version, ip ? ip.slice(0, 64) : null],
    );
    return this.status(userId);
  }

  async hasAcceptedCurrent(userId: number): Promise<boolean> {
    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM responder_agreements WHERE user_id = $1 AND version = $2 LIMIT 1`,
      [userId, RESPONDER_AGREEMENT_VERSION],
    );
    return rows.length > 0;
  }

  /** Before a take-over: the current version, whatever their role. */
  async assertMayTakeOver(
    userId: number,
    heldByUserId: number | null,
  ): Promise<void> {
    if (!responderAgreementEnforced()) return;
    // Already theirs (taken before a new version): not a new take-over.
    if (heldByUserId != null && heldByUserId === userId) return;
    if (await this.hasAcceptedCurrent(userId)) return;
    throw required();
  }

  /** Before a reply: the current version, or the chat is one they already hold. */
  async assertMayReply(
    userId: number,
    heldByUserId: number | null,
  ): Promise<void> {
    return this.assertMayTakeOver(userId, heldByUserId);
  }

  /** Before reading a thread: only a responder-only member needs it (or holds the chat). */
  async assertMayRead(
    userId: number,
    roles: readonly ChatbotMemberRole[],
    heldByUserId: number | null,
  ): Promise<void> {
    if (!isResponderOnly(roles)) return;
    return this.assertMayTakeOver(userId, heldByUserId);
  }
}

const required = () =>
  new ForbiddenException({
    errorCode: RESPONDER_AGREEMENT_ERROR,
    // COPY: needs approval
    message:
      'Read and accept the responder agreement before you reply to people.',
    details: { currentVersion: RESPONDER_AGREEMENT_VERSION },
  });
