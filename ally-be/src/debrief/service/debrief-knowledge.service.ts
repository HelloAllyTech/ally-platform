import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from '../../authorization/service/feature-toggle.service';
import { KbCorpus } from '../../knowledge-base/enum/knowledge-base.enum';

export interface DebriefKnowledgeDocument {
  id: string;
  title: string;
  status: string;
  isGlobal: boolean;
  tenantCount: number;
  chunkCount: number;
  archived: boolean;
  updatedAt: string;
  needsClinicalSignOff: boolean;
  /** signed_off: served; awaiting: clinical, not served until the advisor signs this text. */
  clinical: 'not_clinical' | 'signed_off' | 'awaiting';
  signedOffBy: string | null;
  signedOffAt: string | null;
}

/**
 * The Debrief knowledge base's review side (v9 FR-16, plan §8.5 and §12):
 * which documents are clinical, and the clinical advisor's sign-off. Adding,
 * editing, targeting and archiving documents is the knowledge base's own
 * admin, with corpus `debrief_knowledge`; retrieval refuses a clinical
 * document unless its current text was signed off.
 */
@Injectable()
export class DebriefKnowledgeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly toggles: FeatureToggleService,
  ) {}

  /** The list, saying whether this person may sign off. */
  async listFor(userId: number) {
    return {
      documents: await this.rows(),
      canSignOff: await this.canSignOff(userId),
    };
  }

  /** The Ally team marks a document clinical (or not); marking clears any sign-off. */
  async setClinical(id: string, needs: boolean) {
    const res = await this.dataSource.query(
      `UPDATE kb_documents
          SET needs_clinical_sign_off = $2,
              clinical_signed_off_by = NULL,
              clinical_signed_off_at = NULL,
              clinical_signed_off_hash = NULL,
              "updatedAt" = now()
        WHERE id = $1 AND corpus = $3
        RETURNING id`,
      [id, needs, KbCorpus.DEBRIEF_KNOWLEDGE],
    );
    if (!this.updated(res)) throw new NotFoundException('No such document');
    return (await this.rows(id))[0];
  }

  /** The clinical advisor signs off the document's current text. */
  async signOff(id: string, userId: number) {
    if (!(await this.canSignOff(userId))) {
      throw new ForbiddenException(
        'Only the clinical advisor can sign off clinical guidance',
      );
    }
    const res = await this.dataSource.query(
      `UPDATE kb_documents
          SET clinical_signed_off_by = $2,
              clinical_signed_off_at = now(),
              clinical_signed_off_hash = content_hash,
              "updatedAt" = now()
        WHERE id = $1 AND corpus = $3 AND needs_clinical_sign_off = true
        RETURNING id`,
      [id, userId, KbCorpus.DEBRIEF_KNOWLEDGE],
    );
    if (!this.updated(res)) {
      throw new NotFoundException('No clinical document with that id');
    }
    return (await this.rows(id))[0];
  }

  /**
   * The clinical advisor: a platform admin with the "Debriefs — Clinical
   * sign-off" toggle on (Admin → Ally admins), off for everyone by default.
   */
  private canSignOff(userId: number): Promise<boolean> {
    return this.toggles.hasToggle(
      userId,
      FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF,
    );
  }

  private updated(res: unknown): boolean {
    // TypeORM returns [rows, count] for UPDATE … RETURNING on Postgres.
    const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
    return Array.isArray(rows) && rows.length > 0;
  }

  private async rows(id?: string): Promise<DebriefKnowledgeDocument[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT d.id, d.title, d.status, d.is_global, d.chunk_count, d.archived_at,
              d."updatedAt", d.needs_clinical_sign_off, d.clinical_signed_off_at,
              d.clinical_signed_off_hash = d.content_hash AS signed_current,
              u.name AS signed_by,
              (SELECT count(*)::int FROM kb_document_tenants dt
                WHERE dt.document_id = d.id AND dt."deletedAt" IS NULL) AS tenant_count
         FROM kb_documents d
         LEFT JOIN users u ON u.id = d.clinical_signed_off_by
        WHERE d.corpus = $1 AND ($2::uuid IS NULL OR d.id = $2::uuid)
        ORDER BY d.archived_at NULLS FIRST, d."updatedAt" DESC`,
      [KbCorpus.DEBRIEF_KNOWLEDGE, id ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      isGlobal: r.is_global === true,
      tenantCount: Number(r.tenant_count ?? 0),
      chunkCount: Number(r.chunk_count ?? 0),
      archived: r.archived_at != null,
      updatedAt: new Date(r.updatedAt).toISOString(),
      needsClinicalSignOff: r.needs_clinical_sign_off === true,
      clinical: !r.needs_clinical_sign_off
        ? 'not_clinical'
        : r.signed_current
          ? 'signed_off'
          : 'awaiting',
      signedOffBy: r.signed_current ? (r.signed_by ?? null) : null,
      signedOffAt:
        r.signed_current && r.clinical_signed_off_at
          ? new Date(r.clinical_signed_off_at).toISOString()
          : null,
    }));
  }
}
