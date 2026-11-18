import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { CharacterInterviewSessionService } from '../character-interview-session.service';
import { CharacterInterviewSessionStatus } from '../../enum/character-interview.enum';
import {
  CHARACTER_INTERVIEW_ACTIVE_SESSION_IDLE_MS,
  CHARACTER_INTERVIEW_MAX_ACTIVE_SESSIONS_PER_TENANT,
  CHARACTER_INTERVIEW_MAX_SESSIONS_PER_TENANT_PER_MONTH,
} from '../../constants/character-interview.constants';

describe('CharacterInterviewSessionService', () => {
  let service: CharacterInterviewSessionService;
  let sessionRepository: {
    save: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let accessService: { resolveScope: jest.Mock };

  const asPlatform = () =>
    accessService.resolveScope.mockResolvedValue({
      isPlatform: true,
      tenantId: null,
    });
  const asTenant = (tenantId = 'tenant-a') =>
    accessService.resolveScope.mockResolvedValue({
      isPlatform: false,
      tenantId,
    });

  beforeEach(() => {
    sessionRepository = {
      save: jest.fn(async (s) => s),
      create: jest.fn((s) => s),
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    accessService = { resolveScope: jest.fn() };
    asPlatform();

    service = new CharacterInterviewSessionService(
      sessionRepository as any,
      {} as any,
      accessService as any,
    );
  });

  describe('createSession', () => {
    it('stamps the tenant on a tenant caller session', async () => {
      asTenant();

      await service.createSession(7);

      expect(sessionRepository.create).toHaveBeenCalledWith({
        tenantId: 'tenant-a',
        createdBy: 7,
        updatedBy: 7,
      });
    });

    it('leaves the tenant null for a platform caller and skips the caps', async () => {
      await service.createSession(1);

      expect(sessionRepository.create).toHaveBeenCalledWith({
        tenantId: null,
        createdBy: 1,
        updatedBy: 1,
      });
      expect(sessionRepository.count).not.toHaveBeenCalled();
    });

    it('refuses once the org is at the concurrent-session cap', async () => {
      asTenant();
      sessionRepository.count.mockResolvedValue(
        CHARACTER_INTERVIEW_MAX_ACTIVE_SESSIONS_PER_TENANT,
      );

      await expect(service.createSession(7)).rejects.toThrow(
        ForbiddenException,
      );
      // The message has to say what to do about it, not just that it failed.
      await expect(service.createSession(7)).rejects.toThrow(
        /Finish or discard one/,
      );
      expect(sessionRepository.save).not.toHaveBeenCalled();
    });

    it('counts only ACTIVE sessions touched within the idle window toward the concurrent cap', async () => {
      asTenant();
      const before = Date.now();

      await service.createSession(7);

      // Production, 2026-11-03: an org built ten characters in an afternoon,
      // each Leave/Start over left its session ACTIVE for good, and that
      // night every new interview was refused. A session nobody has touched
      // for the idle window is not "in progress".
      const { where } = sessionRepository.count.mock.calls[0][0];
      expect(where).toMatchObject({
        tenantId: 'tenant-a',
        status: CharacterInterviewSessionStatus.ACTIVE,
      });
      expect(where.updatedAt).toBeInstanceOf(FindOperator);
      expect(where.updatedAt.type).toBe('moreThanOrEqual');
      const cutoff = (where.updatedAt.value as Date).getTime();
      expect(cutoff).toBeGreaterThanOrEqual(
        before - CHARACTER_INTERVIEW_ACTIVE_SESSION_IDLE_MS,
      );
      expect(cutoff).toBeLessThanOrEqual(
        Date.now() - CHARACTER_INTERVIEW_ACTIVE_SESSION_IDLE_MS,
      );
    });

    it('refuses once the org is at the monthly cap', async () => {
      asTenant();
      sessionRepository.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(
          CHARACTER_INTERVIEW_MAX_SESSIONS_PER_TENANT_PER_MONTH,
        );

      await expect(service.createSession(7)).rejects.toThrow(
        /reached its limit of/,
      );
      expect(sessionRepository.save).not.toHaveBeenCalled();
    });

    it('allows a tenant caller under both caps', async () => {
      asTenant();
      sessionRepository.count.mockResolvedValue(1);

      await expect(service.createSession(7)).resolves.toBeDefined();
      expect(sessionRepository.save).toHaveBeenCalled();
    });
  });

  describe('abandonSession', () => {
    it("marks the creator's ACTIVE session ABANDONED", async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 's1',
        createdBy: 7,
        updatedBy: 7,
        status: CharacterInterviewSessionStatus.ACTIVE,
      });

      const session = await service.abandonSession('s1', 7);

      expect(session.status).toBe(CharacterInterviewSessionStatus.ABANDONED);
      expect(sessionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 's1',
          status: CharacterInterviewSessionStatus.ABANDONED,
          updatedBy: 7,
        }),
      );
    });

    it('leaves a COMPLETED session alone — its draft may still be opened', async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 's1',
        createdBy: 7,
        status: CharacterInterviewSessionStatus.COMPLETED,
      });

      const session = await service.abandonSession('s1', 7);

      expect(session.status).toBe(CharacterInterviewSessionStatus.COMPLETED);
      expect(sessionRepository.save).not.toHaveBeenCalled();
    });

    it("refuses to abandon someone else's interview", async () => {
      sessionRepository.findOne.mockResolvedValue({
        id: 's1',
        createdBy: 7,
        status: CharacterInterviewSessionStatus.ACTIVE,
      });

      await expect(service.abandonSession('s1', 8)).rejects.toThrow(
        ForbiddenException,
      );
      expect(sessionRepository.save).not.toHaveBeenCalled();
    });

    it('404s on an unknown session', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await expect(service.abandonSession('nope', 7)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
