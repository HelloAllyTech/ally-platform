import { ForbiddenException } from '@nestjs/common';
import { RoadmapPreferenceService } from '../roadmap-preference.service';

function build(role = 'idea', row: { weeklyDigest: boolean } | null = null) {
  let stored = row;
  const repository = {
    findOne: jest.fn(async () => stored),
    upsert: jest.fn(async (value: { weeklyDigest: boolean }) => {
      stored = { weeklyDigest: value.weeklyDigest };
    }),
  };
  const roles = { roleOf: jest.fn(async () => role) };
  return {
    service: new RoadmapPreferenceService(repository as never, roles as never),
    repository,
  };
}

describe('RoadmapPreferenceService', () => {
  it('has the weekly digest off until it is turned on', async () => {
    const { service, repository } = build();
    expect(await service.get(5)).toEqual({ weeklyDigest: false });
    expect(await service.set(5, { weeklyDigest: true })).toEqual({
      weeklyDigest: true,
    });
    expect(repository.upsert).toHaveBeenCalledWith(
      { userId: 5, weeklyDigest: true },
      ['userId'],
    );
  });

  it('writes nothing for an empty patch', async () => {
    const { service, repository } = build('idea', { weeklyDigest: true });
    expect(await service.set(5, {})).toEqual({ weeklyDigest: true });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('needs the Idea role', async () => {
    const { service } = build('viewer');
    await expect(service.get(5)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.set(5, { weeklyDigest: true })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
