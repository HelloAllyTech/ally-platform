import { BadRequestException } from '@nestjs/common';
import {
  GLOBAL_AUDIENCE,
  asksForAudience,
  assertTenantsExist,
  audienceCovers,
  resolveAudience,
  sameAudience,
} from '../audience.util';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('resolveAudience', () => {
  it('is global when nothing is asked for', () => {
    expect(resolveAudience({})).toEqual(GLOBAL_AUDIENCE);
  });

  it('keeps the fallback when nothing is asked for', () => {
    expect(resolveAudience({}, { isGlobal: false, tenantIds: [A] })).toEqual({
      isGlobal: false,
      tenantIds: [A],
    });
  });

  it('targets the named organisations, without repeats', () => {
    expect(resolveAudience({ tenantIds: [A, B, A] })).toEqual({
      isGlobal: false,
      tenantIds: [A, B],
    });
  });

  it('clears the names when made global', () => {
    expect(resolveAudience({ isGlobal: true, tenantIds: [A] })).toEqual(
      GLOBAL_AUDIENCE,
    );
  });

  it('refuses "not global" with no organisation, which would reach nobody', () => {
    expect(() => resolveAudience({ isGlobal: false, tenantIds: [] })).toThrow(
      BadRequestException,
    );
  });
});

describe('asksForAudience', () => {
  it('is false for an untouched row', () => {
    expect(asksForAudience({})).toBe(false);
    expect(asksForAudience({ tenantIds: [] })).toBe(false);
  });

  it('is true when either field is set', () => {
    expect(asksForAudience({ isGlobal: false })).toBe(true);
    expect(asksForAudience({ tenantIds: [A] })).toBe(true);
  });
});

describe('audienceCovers', () => {
  const global = GLOBAL_AUDIENCE;
  const onlyA = { isGlobal: false, tenantIds: [A] };
  const aAndB = { isGlobal: false, tenantIds: [A, B] };

  it('a global chunk covers anyone', () => {
    expect(audienceCovers(global, onlyA)).toBe(true);
    expect(audienceCovers(global, global)).toBe(true);
  });

  it('a targeted chunk never covers a global document', () => {
    expect(audienceCovers(aAndB, global)).toBe(false);
  });

  it('a targeted chunk covers a document for a subset of its organisations', () => {
    expect(audienceCovers(aAndB, onlyA)).toBe(true);
    expect(audienceCovers(onlyA, aAndB)).toBe(false);
  });
});

describe('sameAudience', () => {
  it('ignores order', () => {
    expect(
      sameAudience(
        { isGlobal: false, tenantIds: [A, B] },
        { isGlobal: false, tenantIds: [B, A] },
      ),
    ).toBe(true);
  });
});

describe('assertTenantsExist', () => {
  it('names the ids that match no organisation', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ id: A }]) };
    await expect(assertTenantsExist(manager as never, [A, B])).rejects.toThrow(
      B,
    );
  });

  it('asks nothing for an empty list', async () => {
    const manager = { query: jest.fn() };
    await assertTenantsExist(manager as never, []);
    expect(manager.query).not.toHaveBeenCalled();
  });
});
