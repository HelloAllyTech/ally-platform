import { AgentTurnStatus, AgentTurnTrigger } from '../../enum/harness.enum';
import { AgentTurnStoreService } from '../agent-turn-store.service';

const setup = () => {
  const repo = {
    create: jest.fn((row: any) => row),
    save: jest.fn(async (row: any) => ({ id: 'new-turn', ...row })),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const dataSource = { getRepository: () => repo, query: jest.fn() };
  return {
    repo,
    dataSource,
    service: new AgentTurnStoreService(dataSource as never),
  };
};

describe('AgentTurnStoreService.createOrGet', () => {
  it('inserts a new turn for a fresh clientTurnId', async () => {
    const { dataSource, service } = setup();
    dataSource.query.mockResolvedValue([{ id: 't1', status: 'received' }]);

    const { turn, created } = await service.createOrGet({
      agentKey: 'ally_guide',
      threadId: 'th',
      clientTurnId: 'c1',
      trigger: AgentTurnTrigger.LEARNER_MESSAGE,
    });

    expect(created).toBe(true);
    expect(turn.id).toBe('t1');
  });

  it('returns the existing turn for a resent clientTurnId (pg RETURNING tuple shape)', async () => {
    const { dataSource, repo, service } = setup();
    dataSource.query.mockResolvedValue([[], 0]);
    repo.findOne.mockResolvedValue({ id: 'existing', status: 'completed' });

    const { turn, created } = await service.createOrGet({
      agentKey: 'ally_guide',
      threadId: 'th',
      clientTurnId: 'c1',
      trigger: AgentTurnTrigger.LEARNER_MESSAGE,
    });

    expect(created).toBe(false);
    expect(turn.id).toBe('existing');
  });

  it('saves directly when there is no clientTurnId (platform triggers)', async () => {
    const { dataSource, repo, service } = setup();

    const { created } = await service.createOrGet({
      agentKey: 'ally_guide',
      threadId: 'th',
      trigger: AgentTurnTrigger.PLATFORM_EVENT,
    });

    expect(created).toBe(true);
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
  });

  it('records the outcome when a turn finishes', async () => {
    const { repo, service } = setup();
    await service.finish('t1', {
      status: AgentTurnStatus.COMPLETED,
      ttftMs: 120,
      durationMs: 900,
      costUsd: 0.0123,
    });
    expect(repo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        status: AgentTurnStatus.COMPLETED,
        ttftMs: 120,
        durationMs: 900,
        costUsd: '0.012300',
      }),
    );
  });
});
