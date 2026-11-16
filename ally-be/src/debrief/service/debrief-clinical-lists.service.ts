import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../../audit/service/audit-log.service';
import {
  CLINICAL_LIST_KINDS,
  CLINICAL_LIST_LABELS,
  CLINICAL_LIST_LANGUAGES,
  ClinicalListKind,
  ClinicalListLanguage,
  ClinicalLists,
  ClinicalPatterns,
  cleanEntries,
  clinicalListProblem,
  clinicalPatternsFor,
  defaultClinicalLists,
  mergeClinicalLists,
} from '../constants/debrief-clinical-lists.constants';
import { DebriefOwnerSettings } from '../entity/debrief-owner-settings.entity';

/** How long the checks keep a read of the lists. */
export const CLINICAL_LISTS_CACHE_MS = 60_000;

/**
 * The clinical word lists behind the score, diagnosis and jargon checks
 * (2026-11-16), stored beside the owner settings (`clinicalLists`). The
 * clinical advisor and the owner edit them; everyone with the console reads
 * them. The checks read them at run time with a short cache, and fall back to
 * the defaults when the row cannot be read. Every edit is audited like an
 * owner setting (`DEBRIEF_SETTINGS_CHANGED`, before and after).
 */
@Injectable()
export class DebriefClinicalListsService {
  private cache: { at: number; lists: ClinicalLists } | null = null;

  constructor(
    @InjectRepository(DebriefOwnerSettings)
    private readonly rows: Repository<DebriefOwnerSettings>,
    private readonly audit: AuditLogService,
  ) {}

  private async row(): Promise<DebriefOwnerSettings> {
    const found = await this.rows.findOne({ where: { id: 1 } });
    if (found) return found;
    return this.rows.save(this.rows.create({ id: 1, values: {} }));
  }

  /** The lists in force: a person's lists over the defaults. */
  async lists(): Promise<ClinicalLists> {
    const row = await this.rows.findOne({ where: { id: 1 } });
    return mergeClinicalLists(row?.clinicalLists ?? null);
  }

  /** The compiled patterns for a session language; the defaults when unreadable. */
  async patterns(
    language: string | null | undefined,
  ): Promise<ClinicalPatterns> {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > CLINICAL_LISTS_CACHE_MS) {
      try {
        this.cache = { at: now, lists: await this.lists() };
      } catch {
        return clinicalPatternsFor(defaultClinicalLists(), language);
      }
    }
    return clinicalPatternsFor(this.cache.lists, language);
  }

  /** What Settings › Clinical lists shows. */
  async view() {
    const lists = await this.lists();
    const defaults = defaultClinicalLists();
    return {
      kinds: CLINICAL_LIST_KINDS.map((kind) => ({
        kind,
        label: CLINICAL_LIST_LABELS[kind],
      })),
      languages: [...CLINICAL_LIST_LANGUAGES],
      lists,
      defaults,
    };
  }

  /**
   * Replace one language's list for one kind. `null` restores the default.
   * Nothing is written when the list is refused.
   */
  async update(
    kind: ClinicalListKind,
    language: ClinicalListLanguage,
    entries: string[] | null,
    userId: number | null,
  ) {
    if (entries !== null) {
      const problem = clinicalListProblem(kind, language, entries);
      if (problem) throw new BadRequestException(problem);
    } else if (clinicalListProblem(kind, language, []) !== null) {
      throw new BadRequestException(clinicalListProblem(kind, language, []));
    }
    const row = await this.row();
    const before = mergeClinicalLists(row.clinicalLists ?? null)[kind][
      language
    ];
    const stored: Record<string, any> = { ...(row.clinicalLists ?? {}) };
    const forKind = { ...(stored[kind] ?? {}) };
    if (entries === null) delete forKind[language];
    else forKind[language] = cleanEntries(entries);
    stored[kind] = forKind;
    row.clinicalLists = stored;
    row.updatedBy = userId;
    await this.rows.save(row);
    this.cache = null;
    const after = mergeClinicalLists(stored)[kind][language];
    await this.audit.log({
      eventType: 'DEBRIEF_SETTINGS_CHANGED',
      userId: userId ?? undefined,
      details: {
        source: 'edit',
        clinicalList: { kind, language, before, after },
      },
    });
    return this.view();
  }
}
