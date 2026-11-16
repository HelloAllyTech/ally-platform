import { NotFoundException } from '@nestjs/common';
import { DebriefChangesController } from '../controller/debrief-changes.controller';

const pinned = { id: 'p1', kindKey: 'pinned_rule', state: 'waits' };
const prompt = { id: 'c1', kindKey: 'prompt_edit', state: 'trying' };

const make = (can: Record<string, boolean>) => {
  const changes = {
    list: jest.fn(async () => ({ changes: [pinned, prompt] })),
    get: jest.fn(async (id: string) => (id === 'p1' ? pinned : prompt)),
  };
  const view = { viewer: jest.fn(async () => ({ can })) };
  const ctl = new DebriefChangesController(
    changes as any,
    {} as any,
    view as any,
  );
  return ctl;
};
const req = { user: { id: 'u' } } as any;

describe('who sees which changes on the PM agent page', () => {
  it('the team and the owner see every change', async () => {
    const ctl = make({ pmAgent: true, approvePinnedRule: false });
    expect((await ctl.list(req)).changes).toHaveLength(2);
    await expect(ctl.get('c1', req)).resolves.toBe(prompt);
  });

  it('the clinical advisor sees only pinned-rule changes, from the list and by id', async () => {
    const ctl = make({ pmAgent: false, approvePinnedRule: true });
    expect((await ctl.list(req)).changes).toEqual([pinned]);
    await expect(ctl.get('p1', req)).resolves.toBe(pinned);
    await expect(ctl.get('c1', req)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('someone with neither sees none', async () => {
    const ctl = make({ pmAgent: false, approvePinnedRule: false });
    expect((await ctl.list(req)).changes).toEqual([]);
    await expect(ctl.get('p1', req)).rejects.toBeInstanceOf(NotFoundException);
  });
});
