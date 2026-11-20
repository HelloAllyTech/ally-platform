import { ConflictException } from '@nestjs/common';

import { NotFoundException } from 'src/exception/custom.exception';

import type { ProductUpdateDigestRecipientRepository } from '../../repository/product-update-digest-recipient.repository';
import { ProductUpdateRecipientsService } from '../product-update-recipients.service';

const row = (email: string, id = email) => ({
  id,
  email,
  createdAt: new Date('2026-11-20T10:00:00Z'),
});

describe('ProductUpdateRecipientsService', () => {
  let rows: ReturnType<typeof row>[];
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    exists: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let service: ProductUpdateRecipientsService;

  beforeEach(() => {
    rows = [];
    repo = {
      find: jest.fn(async () => rows),
      findOne: jest.fn(
        async ({ where }) => rows.find((r) => r.id === where.id) ?? null,
      ),
      exists: jest.fn(async ({ where }) =>
        rows.some((r) => r.email === where.email),
      ),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => {
        rows.push(row(v.email, `id-${rows.length}`));
        return v;
      }),
      delete: jest.fn(async ({ id }) => {
        rows = rows.filter((r) => r.id !== id);
      }),
    };
    service = new ProductUpdateRecipientsService(
      repo as unknown as ProductUpdateDigestRecipientRepository,
    );
  });

  it('sends to every managed address', async () => {
    rows = [row('a@example.com'), row('b@example.com')];

    expect(await service.effective()).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('has no recipients until someone adds one', async () => {
    expect(await service.effective()).toEqual([]);
    expect((await service.list()).recipients).toEqual([]);
  });

  it('adds an address trimmed and lower-cased', async () => {
    const list = await service.add('  New.Person@Example.COM ');

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new.person@example.com' }),
    );
    expect(list.recipients.map((m) => m.email)).toEqual([
      'new.person@example.com',
    ]);
  });

  it('refuses an address already managed here', async () => {
    rows = [row('new@example.com')];

    await expect(service.add('NEW@example.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('turns a racing duplicate insert into the same refusal', async () => {
    repo.save.mockRejectedValueOnce({ code: '23505' });

    await expect(service.add('new@example.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('removes a managed address, and 404s on an unknown id', async () => {
    rows = [row('a@example.com', 'a'), row('b@example.com', 'b')];

    const list = await service.remove('a');

    expect(list.recipients.map((m) => m.email)).toEqual(['b@example.com']);
    await expect(service.remove('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
