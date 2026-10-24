import { AgentConfigLayer } from 'src/llm-agent/harness/enum/harness.enum';
import { GuideConfigAdminService } from '../guide-config-admin.service';

describe('GuideConfigAdminService.auditLog', () => {
  it('names each change’s organisation or course, and who made it', async () => {
    const at = new Date('2026-10-24T09:00:00Z');
    const overrides = {
      audit: jest.fn(async () => [
        {
          layer: AgentConfigLayer.ORG,
          scopeId: 'org-1',
          key: 'limits.messagesPerDay',
          oldValue: null,
          newValue: { value: 40 },
          version: 2,
          actorUserId: 7,
          createdAt: at,
        },
        {
          layer: AgentConfigLayer.COURSE,
          scopeId: 'tr-1',
          key: 'steer.level',
          oldValue: { value: 'walk' },
          newValue: { value: 'lead' },
          version: 1,
          actorUserId: null,
          createdAt: at,
        },
        {
          layer: AgentConfigLayer.COURSE,
          scopeId: 'tr-gone',
          key: 'steer.level',
          oldValue: null,
          newValue: { value: 'drive' },
          version: 1,
          actorUserId: 8,
          createdAt: at,
        },
      ]),
    };
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('"tenants"')) return [{ id: 'org-1', name: 'Lissun' }];
        if (sql.includes('"tracks"'))
          return [{ id: 'tr-1', name: 'First calls' }];
        return [{ id: 7, name: 'Asha' }];
      }),
    };
    const service = new GuideConfigAdminService(
      overrides as never,
      {} as never,
      dataSource as never,
    );

    const rows = await service.auditLog({});

    expect(
      rows.map(({ layer, scopeId, scopeName, actor }) => ({
        layer,
        scopeId,
        scopeName,
        actor,
      })),
    ).toEqual([
      { layer: 'org', scopeId: 'org-1', scopeName: 'Lissun', actor: 'Asha' },
      {
        layer: 'course',
        scopeId: 'tr-1',
        scopeName: 'First calls',
        actor: null,
      },
      { layer: 'course', scopeId: 'tr-gone', scopeName: null, actor: null },
    ]);
  });
});
