import { BadRequestException } from '@nestjs/common';

import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { NotFoundException } from 'src/exception/custom.exception';

import type { CrmContactLogRepository } from '../../repository/crm-contact-log.repository';
import type { CrmContactRepository } from '../../repository/crm-contact.repository';
import { CrmService, escapeLike } from '../crm.service';

const contact = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  fullName: 'Ada Lovelace',
  organization: 'Analytical Engines',
  jobTitle: 'Founder',
  notes: 'Met at a conference',
  relationshipManagerId: null,
  createdAt: new Date('2026-11-20T10:00:00Z'),
  updatedAt: new Date('2026-11-20T10:00:00Z'),
  ...over,
});

describe('CrmService', () => {
  let contacts: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let logs: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let toggles: { listEnabledHolderIds: jest.Mock; isWithheld: jest.Mock };
  let dataSource: { query: jest.Mock };
  let service: CrmService;

  beforeEach(() => {
    contacts = {
      findOne: jest.fn(async () => contact()),
      save: jest.fn(async (v) => ({ id: 'c1', ...v })),
      create: jest.fn((v) => v),
      delete: jest.fn(),
    };
    logs = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      save: jest.fn(),
      create: jest.fn((v) => v),
      delete: jest.fn(),
    };
    toggles = {
      listEnabledHolderIds: jest.fn(async () => [7, 9]),
      isWithheld: jest.fn(async () => false),
    };
    dataSource = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (!sql.includes('FROM "users"')) return [];
        const ids = (params[0] as number[]) ?? [];
        return [
          { id: 7, name: 'Zed' },
          { id: 9, name: 'Amy' },
        ].filter((u) => ids.includes(u.id));
      }),
    };
    service = new CrmService(
      contacts as unknown as CrmContactRepository,
      logs as unknown as CrmContactLogRepository,
      toggles as never,
      dataSource as never,
    );
  });

  it('escapes LIKE wildcards in a search term', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('offers the holders of the Contacts toggle, by name', async () => {
    const { managers } = await service.managers();

    expect(toggles.listEnabledHolderIds).toHaveBeenCalledWith(
      FeatureToggleKey.CRM_CONTACTS,
    );
    expect(managers).toEqual([
      { userId: 9, name: 'Amy' },
      { userId: 7, name: 'Zed' },
    ]);
  });

  it('leaves out a holder restricted to some organisations', async () => {
    toggles.isWithheld.mockImplementation(async (id: number) => id === 7);

    const { managers } = await service.managers();

    expect(managers.map((m) => m.userId)).toEqual([9]);
  });

  it('refuses a relationship manager who lacks access when creating', async () => {
    await expect(
      service.create({ fullName: 'Grace', relationshipManagerId: 99 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(contacts.save).not.toHaveBeenCalled();
  });

  it('accepts a relationship manager who holds the toggle', async () => {
    await service.create({ fullName: 'Grace', relationshipManagerId: 9 });

    expect(contacts.save).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'Grace', relationshipManagerId: 9 }),
    );
  });

  it('stores blank optional fields as null', async () => {
    await service.create({ fullName: 'Grace', organization: '   ', notes: '' });

    expect(contacts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: null,
        notes: null,
        jobTitle: null,
      }),
    );
  });

  it('does not re-check a manager that is unchanged', async () => {
    contacts.findOne.mockResolvedValue(contact({ relationshipManagerId: 42 }));

    await service.update('c1', {
      notes: 'New note',
      relationshipManagerId: 42,
    });

    expect(contacts.save).toHaveBeenCalled();
  });

  it('refuses changing to a manager without access', async () => {
    await expect(
      service.update('c1', { relationshipManagerId: 99 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears the manager with null', async () => {
    contacts.findOne.mockResolvedValue(contact({ relationshipManagerId: 9 }));

    await service.update('c1', { relationshipManagerId: null });

    expect(contacts.save).toHaveBeenCalledWith(
      expect.objectContaining({ relationshipManagerId: null }),
    );
  });

  it('answers a missing contact with not found', async () => {
    contacts.findOne.mockResolvedValue(null);

    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not search for names shorter than two characters', async () => {
    expect(await service.matchByName(' a ')).toEqual({ contacts: [] });
  });

  it('adds a log dated today when no date is given', async () => {
    await service.addLog('c1', { summary: 'Intro call' });

    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        summary: 'Intro call',
        occurredOn: new Date().toISOString().slice(0, 10),
      }),
    );
  });

  it('refuses a log entry that belongs to another contact', async () => {
    await expect(
      service.updateLog('c1', 'l1', { summary: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(logs.findOne).toHaveBeenCalledWith({
      where: { id: 'l1', contactId: 'c1' },
    });
  });
});
