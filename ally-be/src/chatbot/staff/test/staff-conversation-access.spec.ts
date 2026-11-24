import 'reflect-metadata';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { staffWhatFor } from '../../access/staff-access-matrix';
import {
  ChatbotStaffAccessService,
  STAFF_CONVERSATION_ACCESS_HANDLER,
} from '../chatbot-staff-access.service';

/**
 * `GET /v1/staff/chatbots/:id/conversation-access`: the grant's existence and expiry only, so the
 * read-only view shows the right state without a 403; logged like every staff read (fail closed).
 */
describe('Staff conversation-access check', () => {
  const BOT = '00000000-0000-4000-8000-000000000001';
  const STAFF = 50;
  const EXPIRES = new Date('2026-11-24T10:00:00.000Z');

  const make = (
    opts: {
      bot?: boolean;
      grant?: boolean;
      logFails?: boolean;
      switchValue?: string;
    } = {},
  ) => {
    const rows: Record<string, unknown>[] = [];
    const views = {
      insert: jest.fn(async (row: Record<string, unknown>) => {
        if (opts.logFails) throw new Error('db down');
        rows.push(row);
      }),
    };
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (/FROM chatbots WHERE id/.test(sql))
          return opts.bot === false ? [] : [{ id: BOT }];
        if (/FROM chatbot_access_grants/.test(sql))
          return opts.grant ? [{ id: 'g1', expires_at: EXPIRES }] : [];
        return [];
      }),
    };
    const service = new ChatbotStaffAccessService(
      { findOne: jest.fn() } as never,
      views as never,
      dataSource as never,
      { getUserPermissions: async () => [] } as never,
      { get: () => opts.switchValue } as never,
    );
    return { service, rows, dataSource };
  };

  it('no live grant: granted false, logged as a setup view', async () => {
    const { service, rows } = make();
    await expect(service.conversationAccess(STAFF, BOT)).resolves.toEqual({
      granted: false,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        chatbotId: BOT,
        staffUserId: STAFF,
        policy: 'setup',
        handler: STAFF_CONVERSATION_ACCESS_HANDLER,
        grantId: null,
        conversationId: null,
      }),
    ]);
  });

  it('a live grant: granted with its expiry, the grant id logged', async () => {
    const { service, rows, dataSource } = make({ grant: true });
    await expect(service.conversationAccess(STAFF, BOT)).resolves.toEqual({
      granted: true,
      expiresAt: EXPIRES.toISOString(),
    });
    expect(rows[0]).toMatchObject({ grantId: 'g1' });
    const grantSql = dataSource.query.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes('chatbot_access_grants'))!;
    // Live means not revoked and not expired, by the database clock.
    expect(grantSql).toMatch(/revoked_at IS NULL AND expires_at > now\(\)/);
  });

  it('a chatbot that does not exist is a 404, never logged', async () => {
    const { service, rows } = make({ bot: false });
    await expect(service.conversationAccess(STAFF, BOT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(rows).toHaveLength(0);
  });

  it('the kill switch hides it (404)', async () => {
    const { service } = make({ switchValue: 'false' });
    await expect(service.conversationAccess(STAFF, BOT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('a failed log write refuses the answer', async () => {
    const { service } = make({ grant: true, logFails: true });
    await expect(service.conversationAccess(STAFF, BOT)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('the owner reads it under "Who looked" in words', () => {
    expect(staffWhatFor(STAFF_CONVERSATION_ACCESS_HANDLER)).not.toBe(
      STAFF_CONVERSATION_ACCESS_HANDLER,
    );
  });
});
