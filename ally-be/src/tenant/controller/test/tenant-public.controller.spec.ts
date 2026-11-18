import { NotFoundException } from '@nestjs/common';
import { TenantPublicController } from '../tenant-public.controller';
import { resolveBranding } from '../../util/tenant-branding.util';

describe('TenantPublicController', () => {
  let controller: TenantPublicController;
  let tenantService: { getPublicBranding: jest.Mock };

  // Built directly: the route's @RateLimit guard would otherwise pull the
  // throttler module into the test, and the guard is not what is under test.
  beforeEach(() => {
    tenantService = { getPublicBranding: jest.fn() };
    controller = new TenantPublicController(tenantService as any);
  });

  it('returns the resolved branding for an org code', async () => {
    const branding = resolveBranding(
      { name: 'Acme', logoUrl: 'https://x/l.png' },
      { enabled: true, primaryColor: '#8E2626' },
    );
    tenantService.getPublicBranding.mockResolvedValue(branding);

    await expect(controller.getBranding('acme')).resolves.toEqual(branding);
    expect(tenantService.getPublicBranding).toHaveBeenCalledWith('acme');
  });

  it('passes an unknown code through as not found', async () => {
    tenantService.getPublicBranding.mockRejectedValue(
      new NotFoundException('Organization not found'),
    );
    await expect(controller.getBranding('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
