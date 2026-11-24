import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { EndPersonIdentityKind } from '../entity/end-person.entity';
import { normaliseEmail, normalisePhone } from '../util/credit-periods';

export interface PersonKeys {
  phone?: string | null;
  email?: string | null;
}

/**
 * End persons (section 3, "Who counts as a person"): one record per person per chatbot, reached by
 * a phone (E.164) or an email (lowercase). The same person invited by phone and by email is linked
 * once and then counts once against the per-user limits.
 */
@Injectable()
export class EndPersonService {
  constructor(private readonly dataSource: DataSource) {}

  /** The normalised identities a sender carries, phone first. */
  static keysOf(
    keys: PersonKeys,
  ): Array<{ kind: EndPersonIdentityKind; value: string }> {
    const out: Array<{ kind: EndPersonIdentityKind; value: string }> = [];
    const phone = normalisePhone(keys.phone);
    const email = normaliseEmail(keys.email);
    if (phone) out.push({ kind: 'phone', value: phone });
    if (email) out.push({ kind: 'email', value: email });
    return out;
  }

  /** The person any of these identities already belongs to, phone first. Never creates. */
  async find(
    chatbotId: string,
    keys: PersonKeys,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<string | null> {
    for (const key of EndPersonService.keysOf(keys)) {
      const [row] = await manager.query(
        `SELECT end_person_id FROM end_person_identities WHERE chatbot_id = $1 AND kind = $2 AND value = $3`,
        [chatbotId, key.kind, key.value],
      );
      if (row) return row.end_person_id;
    }
    return null;
  }

  /**
   * The person for these identities, created when none exists. An identity the person didn't
   * have yet is linked to them, unless it already belongs to someone else (never merged silently).
   */
  async resolve(
    chatbotId: string,
    keys: PersonKeys & { display?: string | null },
  ): Promise<string | null> {
    const identities = EndPersonService.keysOf(keys);
    if (!identities.length) return null;
    return this.dataSource.transaction(async (manager) => {
      let personId = await this.find(chatbotId, keys, manager);
      if (!personId) {
        const [created] = await manager.query(
          `INSERT INTO end_persons (chatbot_id, display) VALUES ($1, $2) RETURNING id`,
          [chatbotId, keys.display?.slice(0, 200) ?? null],
        );
        personId = created.id as string;
      }
      for (const key of identities) {
        await manager.query(
          `INSERT INTO end_person_identities (end_person_id, chatbot_id, kind, value)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (chatbot_id, kind, value) DO NOTHING`,
          [personId, chatbotId, key.kind, key.value],
        );
      }
      // A concurrent first message may have created the same person: whoever owns the first
      // identity wins, and an orphan created here is removed.
      const winner = await this.find(chatbotId, keys, manager);
      if (winner && winner !== personId) {
        await manager.query(
          `DELETE FROM end_persons p WHERE p.id = $1
             AND NOT EXISTS (SELECT 1 FROM end_person_identities i WHERE i.end_person_id = p.id)`,
          [personId],
        );
        return winner;
      }
      return personId;
    });
  }

  /**
   * Link one more identity to a person (an invite by email for someone known by phone). Refused
   * when it is already someone else's on this chatbot.
   */
  async link(
    chatbotId: string,
    endPersonId: string,
    keys: PersonKeys,
  ): Promise<void> {
    for (const key of EndPersonService.keysOf(keys)) {
      const [row] = await this.dataSource.query(
        `INSERT INTO end_person_identities (end_person_id, chatbot_id, kind, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (chatbot_id, kind, value) DO UPDATE SET kind = EXCLUDED.kind
         RETURNING end_person_id`,
        [endPersonId, chatbotId, key.kind, key.value],
      );
      if (row.end_person_id !== endPersonId) {
        throw new ConflictException(
          `That ${key.kind} already belongs to another person on this chatbot.`,
        );
      }
    }
  }
}
