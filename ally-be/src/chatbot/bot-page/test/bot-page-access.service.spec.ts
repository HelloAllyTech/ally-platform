import { BadRequestException } from '@nestjs/common';
import { BotPageAccess, BotPageAccessKind } from '../../enum/bot-page.enum';
import { BotPageAccessService } from '../bot-page-access.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

const ORG = '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60';

describe('BotPageAccessService', () => {
  let repo: {
    count: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let query: jest.Mock;
  let values: jest.Mock;
  let service: BotPageAccessService;

  beforeEach(() => {
    values = jest.fn().mockReturnThis();
    const builder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values,
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 'a' }] }),
    };
    repo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(() => builder),
    };
    query = jest.fn().mockResolvedValue([]);
    service = new BotPageAccessService(repo as never, { query } as never);
  });

  it('adds normalised entries and reports what was new', async () => {
    const result = await service.add('page-1', [
      { kind: BotPageAccessKind.EMAIL, value: '  Asha@Example.COM ' },
      {
        kind: BotPageAccessKind.ORGANISATION,
        value: ORG.toUpperCase(),
        label: 'Sunrise',
      },
    ]);
    expect(values.mock.calls[0][0]).toEqual([
      {
        pageId: 'page-1',
        kind: 'email',
        value: 'asha@example.com',
        label: null,
        createdBy: 7,
      },
      {
        pageId: 'page-1',
        kind: 'organisation',
        value: ORG,
        label: 'Sunrise',
        createdBy: 7,
      },
    ]);
    expect(result).toEqual({ added: 1, skipped: 1 });
  });

  it.each([
    [BotPageAccessKind.EMAIL, 'not-an-email'],
    [BotPageAccessKind.ORGANISATION, 'sunrise'],
  ])('refuses a bad %s entry', async (kind, value) => {
    await expect(service.add('page-1', [{ kind, value }])).rejects.toThrow(
      BadRequestException,
    );
  });

  describe('eligibility', () => {
    it('invite: only an email on the list', async () => {
      const page = { id: 'page-1', access: BotPageAccess.INVITE };
      expect(await service.eligibility(page, 'asha@example.com')).toEqual({
        eligible: false,
      });
      repo.count.mockResolvedValue(1);
      expect(await service.eligibility(page, ' ASHA@example.com')).toEqual({
        eligible: true,
      });
      expect(repo.count).toHaveBeenLastCalledWith({
        where: { pageId: 'page-1', kind: 'email', value: 'asha@example.com' },
      });
    });

    it('organisation: an active user of an organisation on the list', async () => {
      const page = { id: 'page-1', access: BotPageAccess.ORGANISATION };
      expect(await service.eligibility(page, 'ravi@sunrise.org')).toEqual({
        eligible: false,
      });
      query.mockResolvedValue([{ id: 42, tenant_id: ORG }]);
      expect(await service.eligibility(page, 'ravi@sunrise.org')).toEqual({
        eligible: true,
        userId: 42,
        tenantId: ORG,
      });
      const [sql, params] = query.mock.calls[1];
      expect(sql).toMatch(/u\.status = \$4/);
      expect(params).toEqual([
        'ravi@sunrise.org',
        'page-1',
        'organisation',
        'ACTIVE',
      ]);
    });

    it('never asks the database about something that is not an email', async () => {
      const page = { id: 'page-1', access: BotPageAccess.INVITE };
      expect(await service.eligibility(page, 'robert"); drop table')).toEqual({
        eligible: false,
      });
      expect(repo.count).not.toHaveBeenCalled();
    });
  });
});
