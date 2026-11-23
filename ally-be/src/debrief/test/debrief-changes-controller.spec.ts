import { NotFoundException } from '@nestjs/common';
import { DebriefChangesController } from '../controller/debrief-changes.controller';

const old = { id: 'p1', kindKey: 'pinned_rule', state: 'live' };
const prompt = { id: 'c1', kindKey: 'prompt_edit', state: 'trying' };

const make = (can: Record<string, boolean>) => {
  const changes = {
    list: jest.fn(async () => ({ changes: [old, prompt] })),
    get: jest.fn(async (id: string) => (id === 'p1' ? old : prompt)),
  };
  const view = { viewer: jest.fn(async () => ({ can })) };
  const ctl = new DebriefChangesController(
    changes as any,
    {} as any,
    view as any,
  );
  return { ctl, changes };
};
const req = { user: { id: 'u' } } as any;

describe('who sees which changes on the Debrief PM agent page', () => {
  it('the team and the owner see every change', async () => {
    const { ctl } = make({ pmAgent: true });
    expect((await ctl.list(req)).changes).toHaveLength(2);
    await expect(ctl.get('c1', req)).resolves.toBe(prompt);
    await expect(ctl.get('p1', req)).resolves.toBe(old);
  });

  it('the clinical advisor sees no change, from the list or by id, and nothing is even read for them', async () => {
    const { ctl, changes } = make({ pmAgent: false });
    expect((await ctl.list(req)).changes).toEqual([]);
    expect(changes.list).not.toHaveBeenCalled();
    await expect(ctl.get('p1', req)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctl.get('c1', req)).rejects.toBeInstanceOf(NotFoundException);
  });
});
