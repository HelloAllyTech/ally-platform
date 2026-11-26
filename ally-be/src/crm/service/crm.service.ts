import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { NotFoundException } from 'src/exception/custom.exception';
import { LoggerService } from 'src/logger/logger.service';

import {
  ContactDetailDto,
  ContactDto,
  ContactListDto,
  ContactLogDto,
  ContactManagerDto,
  ContactManagersDto,
  CreateContactDto,
  CreateContactLogDto,
  UpdateContactDto,
  UpdateContactLogDto,
} from '../dto/crm.dto';
import { CrmContact } from '../entity/crm-contact.entity';
import { CrmContactLog } from '../entity/crm-contact-log.entity';
import { CrmContactLogRepository } from '../repository/crm-contact-log.repository';
import { CrmContactRepository } from '../repository/crm-contact.repository';

const DEFAULT_LIMIT = 200;
const MATCH_LIMIT = 8;

/** Escapes LIKE wildcards so a typed `%` or `_` is matched literally. */
export const escapeLike = (term: string): string =>
  term.replace(/[\\%_]/g, (c) => `\\${c}`);

const blankToNull = (value: string | undefined): string | null | undefined =>
  value === undefined ? undefined : value.trim() || null;

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * The admin console's Contacts tab: a small shared list of people, a
 * conversation log under each, and one relationship manager per contact.
 *
 * Every holder of the `crm_contacts` toggle sees and edits everything; the
 * controller's guard is the access check. The only rule enforced here is who
 * may be named relationship manager: someone who holds the toggle too.
 */
@Injectable()
export class CrmService {
  private readonly logger = LoggerService.getInstance(CrmService.name);

  constructor(
    private readonly contacts: CrmContactRepository,
    private readonly logs: CrmContactLogRepository,
    private readonly toggles: FeatureToggleService,
    private readonly dataSource: DataSource,
  ) {}

  // ---- Contacts ----------------------------------------------------------------

  async list(search?: string, limit = DEFAULT_LIMIT): Promise<ContactListDto> {
    const term = search?.trim();
    const qb = this.contacts.createQueryBuilder('c');
    if (term) {
      qb.where(
        `(c.full_name ILIKE :like OR c.organization ILIKE :like OR c.job_title ILIKE :like)`,
        { like: `%${escapeLike(term)}%` },
      );
    }
    const rows = await qb
      .orderBy('lower(c.full_name)', 'ASC')
      .limit(limit)
      .getMany();
    return { contacts: await this.toDtos(rows) };
  }

  /** Existing contacts whose name matches what is being typed, for the duplicate check. */
  async matchByName(name: string): Promise<ContactListDto> {
    const term = name.trim();
    if (term.length < 2) return { contacts: [] };
    const rows = await this.contacts
      .createQueryBuilder('c')
      .where(`c.full_name ILIKE :like`, { like: `%${escapeLike(term)}%` })
      .orderBy('lower(c.full_name)', 'ASC')
      .limit(MATCH_LIMIT)
      .getMany();
    return { contacts: await this.toDtos(rows) };
  }

  async get(id: string): Promise<ContactDetailDto> {
    const contact = await this.findContact(id);
    const [dto] = await this.toDtos([contact]);
    return { ...dto, logs: await this.logsFor(id) };
  }

  async create(body: CreateContactDto): Promise<ContactDetailDto> {
    if (body.relationshipManagerId != null) {
      await this.assertManager(body.relationshipManagerId);
    }
    const userId = this.userId();
    const saved = await this.contacts.save(
      this.contacts.create({
        fullName: body.fullName,
        organization: blankToNull(body.organization) ?? null,
        jobTitle: blankToNull(body.jobTitle) ?? null,
        notes: blankToNull(body.notes) ?? null,
        relationshipManagerId: body.relationshipManagerId ?? null,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
    this.logger.info(`[CRM] Contact ${saved.id} created by user ${userId}`);
    return this.get(saved.id);
  }

  async update(id: string, body: UpdateContactDto): Promise<ContactDetailDto> {
    const contact = await this.findContact(id);
    if (
      body.relationshipManagerId !== undefined &&
      body.relationshipManagerId !== null &&
      body.relationshipManagerId !== contact.relationshipManagerId
    ) {
      // Only a *change* is checked, so editing the notes of a contact whose
      // manager has since lost access does not fail.
      await this.assertManager(body.relationshipManagerId);
    }
    if (body.fullName !== undefined) contact.fullName = body.fullName;
    if (body.organization !== undefined)
      contact.organization = blankToNull(body.organization) ?? null;
    if (body.jobTitle !== undefined)
      contact.jobTitle = blankToNull(body.jobTitle) ?? null;
    if (body.notes !== undefined)
      contact.notes = blankToNull(body.notes) ?? null;
    if (body.relationshipManagerId !== undefined)
      contact.relationshipManagerId = body.relationshipManagerId;
    contact.updatedBy = this.userId();
    await this.contacts.save(contact);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const contact = await this.findContact(id);
    await this.contacts.delete({ id: contact.id });
    this.logger.info(`[CRM] Contact ${id} deleted by user ${this.userId()}`);
  }

  // ---- Logs --------------------------------------------------------------------

  async addLog(
    contactId: string,
    body: CreateContactLogDto,
  ): Promise<ContactLogDto[]> {
    await this.findContact(contactId);
    await this.logs.save(
      this.logs.create({
        contactId,
        summary: body.summary,
        occurredOn: body.occurredOn ?? today(),
        authorId: this.userId(),
      }),
    );
    return this.logsFor(contactId);
  }

  async updateLog(
    contactId: string,
    logId: string,
    body: UpdateContactLogDto,
  ): Promise<ContactLogDto[]> {
    const log = await this.findLog(contactId, logId);
    if (body.summary !== undefined) log.summary = body.summary;
    if (body.occurredOn !== undefined) log.occurredOn = body.occurredOn;
    await this.logs.save(log);
    return this.logsFor(contactId);
  }

  async removeLog(contactId: string, logId: string): Promise<ContactLogDto[]> {
    const log = await this.findLog(contactId, logId);
    await this.logs.delete({ id: log.id });
    return this.logsFor(contactId);
  }

  // ---- Relationship managers ---------------------------------------------------

  /** Everyone who holds the Contacts toggle: the choices for a contact's manager. */
  async managers(): Promise<ContactManagersDto> {
    return { managers: await this.eligibleManagers() };
  }

  private async eligibleManagers(): Promise<ContactManagerDto[]> {
    const holderIds = await this.toggles.listEnabledHolderIds(
      FeatureToggleKey.CRM_CONTACTS,
    );
    if (!holderIds.length) return [];
    // An admin restricted to some organizations is refused this platform-wide
    // surface by the guard, so they are not a choice either.
    const withheld = await Promise.all(
      holderIds.map((id) =>
        this.toggles.isWithheld(id, FeatureToggleKey.CRM_CONTACTS),
      ),
    );
    const ids = holderIds.filter((_, i) => !withheld[i]);
    return this.namesFor(ids);
  }

  private async assertManager(userId: number): Promise<void> {
    const eligible = await this.eligibleManagers();
    if (!eligible.some((m) => m.userId === userId)) {
      throw new BadRequestException(
        'The relationship manager must be someone with access to Contacts.',
      );
    }
  }

  // ---- Helpers -----------------------------------------------------------------

  private async findContact(id: string): Promise<CrmContact> {
    const contact = await this.contacts.findOne({ where: { id } });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  private async findLog(
    contactId: string,
    logId: string,
  ): Promise<CrmContactLog> {
    const log = await this.logs.findOne({ where: { id: logId, contactId } });
    if (!log) throw new NotFoundException('Log entry not found');
    return log;
  }

  private async logsFor(contactId: string): Promise<ContactLogDto[]> {
    const rows = await this.logs.find({
      where: { contactId },
      order: { occurredOn: 'DESC', createdAt: 'DESC' },
    });
    const names = await this.nameMap(
      rows.map((r) => r.authorId).filter((v): v is number => v != null),
    );
    return rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      occurredOn: r.occurredOn,
      summary: r.summary,
      authorId: r.authorId,
      authorName: r.authorId != null ? (names.get(r.authorId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async toDtos(rows: CrmContact[]): Promise<ContactDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const stats: { contact_id: string; n: string; last: string | null }[] =
      await this.dataSource.query(
        `SELECT contact_id, count(*) AS n, to_char(max(occurred_on), 'YYYY-MM-DD') AS last
           FROM "crm_contact_logs" WHERE contact_id = ANY($1) GROUP BY contact_id`,
        [ids],
      );
    const statsById = new Map(stats.map((s) => [s.contact_id, s]));
    const names = await this.nameMap(
      rows
        .map((r) => r.relationshipManagerId)
        .filter((v): v is number => v != null),
    );
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      organization: r.organization,
      jobTitle: r.jobTitle,
      notes: r.notes,
      relationshipManagerId: r.relationshipManagerId,
      relationshipManagerName:
        r.relationshipManagerId != null
          ? (names.get(r.relationshipManagerId) ?? null)
          : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      lastLoggedOn: statsById.get(r.id)?.last ?? null,
      logCount: Number(statsById.get(r.id)?.n ?? 0),
    }));
  }

  private async nameMap(userIds: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(userIds)];
    if (!unique.length) return new Map();
    const users: { id: number; name: string | null }[] =
      await this.dataSource.query(
        `SELECT id, name FROM "users" WHERE id = ANY($1)`,
        [unique],
      );
    return new Map(users.map((u) => [Number(u.id), u.name || `User ${u.id}`]));
  }

  private async namesFor(userIds: number[]): Promise<ContactManagerDto[]> {
    const names = await this.nameMap(userIds);
    return [...names.entries()]
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private userId(): number | null {
    const id = ExecutionManager.getUserId();
    return id ? Number(id) : null;
  }
}
