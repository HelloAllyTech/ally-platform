import { BadRequestException } from '@nestjs/common';
import { DebriefAdvisorsService } from '../service/debrief-advisors.service';

type Row = {
  id: number;
  name: string;
  email: string | null;
  organisation: string | null;
  roles: string[] | null;
  sign_off: boolean | null;
};

function setup(initial: Row) {
  let row = { ...initial };
  const dataSource = { query: jest.fn(async () => [row]) };
  const groups = {
    assignRole: jest.fn(async ({ role }) => {
      row = { ...row, roles: [...(row.roles ?? []), role].sort() };
      return true;
    }),
    removeRole: jest.fn(async ({ role }) => {
      row = { ...row, roles: (row.roles ?? []).filter((r) => r !== role) };
      return true;
    }),
  };
  const toggles = {
    setToggles: jest.fn(async (_u, t: Array<{ enabled: boolean }>) => {
      row = { ...row, sign_off: t[0].enabled };
    }),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new DebriefAdvisorsService(
    dataSource as any,
    groups as any,
    toggles as any,
    audit as any,
  );
  return { svc, groups, toggles, audit, dataSource };
}

const ankita: Row = {
  id: 7,
  name: 'A Person',
  email: 'a@example.org',
  organisation: 'Org',
  roles: ['ADMIN', 'COUNSELOR'],
  sign_off: null,
};

describe('DebriefAdvisorsService', () => {
  it('adds only the advisor group and toggle, keeping every other role', async () => {
    const { svc, groups, toggles, audit } = setup(ankita);
    const after = await svc.add(7, 1);
    expect(groups.assignRole).toHaveBeenCalledWith({
      role: 'CLINICAL_ADVISOR',
      userId: 7,
    });
    expect(toggles.setToggles).toHaveBeenCalledWith(
      7,
      [{ featureKey: 'debrief_clinical_sign_off', enabled: true }],
      1,
    );
    expect(after.roles).toEqual(['ADMIN', 'CLINICAL_ADVISOR', 'COUNSELOR']);
    expect(after.advisor).toBe(true);
    expect(after.signOff).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CLINICAL_ADVISOR_ADDED',
        details: expect.objectContaining({
          rolesBefore: ['ADMIN', 'COUNSELOR'],
        }),
      }),
    );
  });

  it('does nothing twice when the person already has both', async () => {
    const { svc, groups, toggles } = setup({
      ...ankita,
      roles: ['CLINICAL_ADVISOR', 'COUNSELOR'],
      sign_off: true,
    });
    await svc.add(7, 1);
    expect(groups.assignRole).not.toHaveBeenCalled();
    expect(toggles.setToggles).not.toHaveBeenCalled();
  });

  it('removes only the advisor access', async () => {
    const { svc, groups, toggles } = setup({
      ...ankita,
      roles: ['ADMIN', 'CLINICAL_ADVISOR'],
      sign_off: true,
    });
    const after = await svc.remove(7, 1);
    expect(groups.removeRole).toHaveBeenCalledWith({
      role: 'CLINICAL_ADVISOR',
      userId: 7,
    });
    expect(after.roles).toEqual(['ADMIN']);
    expect(toggles.setToggles).toHaveBeenCalledWith(
      7,
      [{ featureKey: 'debrief_clinical_sign_off', enabled: false }],
      1,
    );
  });

  it('refuses to remove the only role a person has', async () => {
    const { svc } = setup({ ...ankita, roles: ['CLINICAL_ADVISOR'] });
    await expect(svc.remove(7, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('searches only with 3+ characters and escapes wildcards', async () => {
    const { svc, dataSource } = setup(ankita);
    expect(await svc.search('an')).toEqual([]);
    expect(dataSource.query).not.toHaveBeenCalled();
    await svc.search('a_b%');
    expect((dataSource.query.mock.calls[0] as unknown[])[1]).toEqual([
      'debrief_clinical_sign_off',
      '%a\\_b\\%%',
    ]);
  });
});
