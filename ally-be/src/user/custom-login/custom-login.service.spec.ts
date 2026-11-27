import { BadRequestException } from '@nestjs/common';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { CustomLoginService } from './custom-login.service';

const mockAuditLog = jest.fn();
jest.mock('src/audit/service/audit-logger.service', () => ({
  AuditLoggerService: {
    getInstance: jest.fn(() => ({
      log: (...args: unknown[]) => mockAuditLog(...args),
    })),
  },
}));

describe('CustomLoginService.create', () => {
  const input = { name: 'Asha', email: 'asha@example.com', tenantId: 't-1' };
  let userService: { createCustomLoginUser: jest.Mock };
  let service: CustomLoginService;

  beforeEach(() => {
    mockAuditLog.mockReset();
    userService = { createCustomLoginUser: jest.fn() };
    service = new CustomLoginService(
      {} as any,
      {} as any,
      {} as any,
      userService as any,
    );
  });

  it('creates the user and audits CUSTOM_LOGIN_CREATED', async () => {
    userService.createCustomLoginUser.mockResolvedValue({ id: 9, ...input });

    const result = await service.create(input, 1);

    expect(result.id).toBe(9);
    expect(userService.createCustomLoginUser).toHaveBeenCalledWith(input);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AUDIT_EVENTS.CUSTOM_LOGIN_CREATED,
        userId: 1,
        details: { targetUserId: 9 },
      }),
    );
  });

  it('propagates a duplicate-email refusal without auditing', async () => {
    userService.createCustomLoginUser.mockRejectedValue(
      new BadRequestException('Email already registered'),
    );

    await expect(service.create(input, 1)).rejects.toThrow(
      'Email already registered',
    );
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
