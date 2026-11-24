import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ChatbotMemberRole } from '../../enum/chatbot.enum';
import { RESPONDER_AGREEMENT_VERSION } from '../members.copy';
import {
  RESPONDER_AGREEMENT_ERROR,
  ResponderAgreementService,
} from '../responder-agreement.service';

/**
 * Stage 1b: the responder agreement per person and version. A new version blocks NEW take-overs
 * only, never a conversation the person already holds.
 */
describe('ResponderAgreementService', () => {
  const ME = 7;
  const OTHER = 8;
  let accepted: Array<{ user_id: number; version: string }>;
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('INSERT INTO responder_agreements')) {
        const [user_id, version] = params as [number, string];
        if (
          !accepted.some((a) => a.user_id === user_id && a.version === version)
        ) {
          accepted.push({ user_id, version });
        }
        return [];
      }
      if (sql.includes('AND version = $2')) {
        const [user_id, version] = params as [number, string];
        return accepted.filter(
          (a) => a.user_id === user_id && a.version === version,
        );
      }
      const [user_id] = params as [number];
      return accepted
        .filter((a) => a.user_id === user_id)
        .map((a) => ({ version: a.version, accepted_at: new Date() }));
    }),
  };
  const service = new ResponderAgreementService(dataSource as never);

  beforeEach(() => {
    accepted = [];
    delete process.env.RESPONDER_AGREEMENT_ENFORCED;
  });

  it('takes over only after accepting the current version, whatever the role', async () => {
    await expect(service.assertMayTakeOver(ME, null)).rejects.toMatchObject({
      response: { errorCode: RESPONDER_AGREEMENT_ERROR },
    });
    await service.accept(ME, RESPONDER_AGREEMENT_VERSION, '10.0.0.1');
    await expect(service.assertMayTakeOver(ME, null)).resolves.toBeUndefined();
    expect((await service.status(ME)).accepted).toBe(true);
  });

  it('a new version blocks a new take-over but not a conversation already open', async () => {
    // Accepted an older version, before the current one was published.
    accepted.push({ user_id: ME, version: 'v0' });
    // The chat they already hold: reading, replying and taking it "again" all still work.
    await expect(service.assertMayTakeOver(ME, ME)).resolves.toBeUndefined();
    await expect(service.assertMayReply(ME, ME)).resolves.toBeUndefined();
    await expect(
      service.assertMayRead(ME, [ChatbotMemberRole.RESPONDER], ME),
    ).resolves.toBeUndefined();
    // A new one (free, or held by someone else): blocked until they accept the new version.
    await expect(service.assertMayTakeOver(ME, null)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.assertMayReply(ME, OTHER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.assertMayRead(ME, [ChatbotMemberRole.RESPONDER], null),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const status = await service.status(ME);
    expect(status).toMatchObject({ accepted: false, acceptedVersion: 'v0' });
  });

  it('reading a thread is gated only for a responder-only member', async () => {
    for (const roles of [
      [ChatbotMemberRole.OWNER],
      [ChatbotMemberRole.EDITOR, ChatbotMemberRole.RESPONDER],
      [ChatbotMemberRole.VIEWER, ChatbotMemberRole.RESPONDER],
    ]) {
      await expect(
        service.assertMayRead(ME, roles, null),
      ).resolves.toBeUndefined();
    }
  });

  it('refuses accepting a version that is not the current one', async () => {
    await expect(service.accept(ME, 'v0', null)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('the kill switch turns enforcement off', async () => {
    process.env.RESPONDER_AGREEMENT_ENFORCED = 'false';
    await expect(service.assertMayTakeOver(ME, null)).resolves.toBeUndefined();
    expect((await service.status(ME)).enforced).toBe(false);
  });
});
