import { AgentTraceService } from '../agent-trace.service';

const setup = (buckets: {
  agentTraceBucket?: string;
  audioBucket?: string;
}) => {
  const repo = {
    save: jest.fn(async (row: any) => row),
    create: jest.fn((row: any) => row),
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const s3 = { uploadStream: jest.fn().mockResolvedValue({}) };
  const service = new AgentTraceService(
    { getRepository: () => repo } as never,
    s3 as never,
    { s3: buckets } as never,
  );
  return { repo, s3, service };
};

const input = {
  turnId: 'turn-1',
  agentKey: 'ally_guide',
  threadId: 'thread-1',
  summary: { stages: [] },
  payload: { prompt: 'secret learner text' },
};

describe('AgentTraceService', () => {
  it('puts the payload in the private trace bucket and only its key in Postgres', async () => {
    const { repo, s3, service } = setup({ agentTraceBucket: 'traces' });

    await service.write(input);

    expect(s3.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'traces',
        ServerSideEncryption: 'AES256',
      }),
    );
    const saved = repo.save.mock.calls[0][0];
    expect(saved.payloadKey).toMatch(
      /^agent-traces\/ally_guide\/\d{4}\/\d{2}\/turn-1\.json$/,
    );
    expect(JSON.stringify(saved)).not.toContain('secret learner text');
  });

  it('falls back to the private audio bucket', async () => {
    const { s3, service } = setup({ audioBucket: 'audio' });
    await service.write(input);
    expect(s3.uploadStream.mock.calls[0][0].Bucket).toBe('audio');
  });

  it('still writes the summary when no bucket is configured', async () => {
    const { repo, s3, service } = setup({});
    await service.write(input);
    expect(s3.uploadStream).not.toHaveBeenCalled();
    expect(repo.save.mock.calls[0][0].payloadKey).toBeNull();
  });

  it('never throws, even when both S3 and Postgres fail', async () => {
    const { repo, s3, service } = setup({ agentTraceBucket: 'traces' });
    s3.uploadStream.mockRejectedValue(new Error('s3 down'));
    repo.save.mockRejectedValue(new Error('db down'));

    await expect(service.write(input)).resolves.toBeUndefined();
  });
});
