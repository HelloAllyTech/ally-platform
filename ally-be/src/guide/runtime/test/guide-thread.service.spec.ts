import { HttpException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import { GuideThreadStatus } from '../../enum/guide.enum';
import { GuideThreadService } from '../guide-thread.service';

const USER = { id: 7, tenantId: 'org-a', username: 'learner' };
const TRACK = '96d570f0-14b6-42d7-8e78-79d7520c7f69';

function setup({
  available = true,
  hasAccess = true,
  existing = null as Record<string, unknown> | null,
} = {}) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: 'new-thread', ...row })),
  };
  const dataSource = { getRepository: jest.fn(() => repo) };
  const settings = {
    isGuidedAvailable: jest.fn().mockResolvedValue(available),
  };
  const enrollment = {
    getTrackAccess: jest.fn().mockResolvedValue({
      hasAccess,
      enrolled: false,
      reason: hasAccess ? null : 'NOT_IN_GROUP',
    }),
  };
  const service = new GuideThreadService(
    dataSource as never,
    settings as never,
    enrollment as never,
  );
  return { service, repo, settings, enrollment };
}

async function errorCodeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { errorCode?: string })
      .errorCode;
  }
  throw new Error('expected a rejection');
}

describe('GuideThreadService.getOrCreateForUser', () => {
  it('refuses with GUIDE_DISABLED before checking access when the switch is off', async () => {
    const { service, enrollment } = setup({ available: false });
    expect(await errorCodeOf(service.getOrCreateForUser(TRACK, USER))).toBe(
      ErrorCode.GUIDE_DISABLED,
    );
    expect(enrollment.getTrackAccess).not.toHaveBeenCalled();
  });

  it('refuses with GUIDE_NO_ACCESS when the learner cannot open the course', async () => {
    const { service, repo } = setup({ hasAccess: false });
    expect(await errorCodeOf(service.getOrCreateForUser(TRACK, USER))).toBe(
      ErrorCode.GUIDE_NO_ACCESS,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('returns the active thread when there is one', async () => {
    const existing = { id: 'th-1', userId: 7, tenantId: 'org-a' };
    const { service, repo } = setup({ existing });
    await expect(service.getOrCreateForUser(TRACK, USER)).resolves.toBe(
      existing,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('creates an active thread scoped to the learner and their org', async () => {
    const { service, repo } = setup();
    const thread = await service.getOrCreateForUser(TRACK, USER);
    expect(thread.id).toBe('new-thread');
    expect(repo.create).toHaveBeenCalledWith({
      userId: 7,
      tenantId: 'org-a',
      trackId: TRACK,
      status: GuideThreadStatus.ACTIVE,
    });
  });

  it('returns the winner when a second tab created the thread first', async () => {
    const winner = { id: 'th-winner' };
    const { service, repo } = setup();
    repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    repo.save.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: '23505' }),
    );
    await expect(service.getOrCreateForUser(TRACK, USER)).resolves.toBe(winner);
  });
});

describe('GuideThreadService.getOwned', () => {
  it.each([
    ['a missing thread', null],
    ['another learner', { id: 'th', userId: 8, tenantId: 'org-a' }],
    [
      'the same learner in another org',
      { id: 'th', userId: 7, tenantId: 'org-b' },
    ],
  ])('answers 404 for %s', async (_label, row) => {
    const { service } = setup({ existing: row });
    await expect(service.getOwned('th', USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the thread to its owner', async () => {
    const row = { id: 'th', userId: 7, tenantId: 'org-a' };
    const { service } = setup({ existing: row });
    await expect(service.getOwned('th', USER)).resolves.toBe(row);
  });
});
