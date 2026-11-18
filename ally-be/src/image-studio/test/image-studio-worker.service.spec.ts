import { GeneratedImageStatus } from '../entity/generated-image.entity';
import { ImageRenderError } from '../service/image-render.service';
import { ImageStudioWorkerService } from '../service/image-studio-worker.service';

const build = (
  overrides: {
    render?: jest.Mock;
    candidates?: any[];
    usedAsReference?: string[];
    uses?: number;
  } = {},
) => {
  const repository = {
    heartbeat: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(true),
    reconcileStale: jest.fn().mockResolvedValue({ requeued: 1, failed: 0 }),
    findExpiredCandidates: jest
      .fn()
      .mockResolvedValue(overrides.candidates ?? []),
    idsUsedAsReference: jest
      .fn()
      .mockResolvedValue(new Set(overrides.usedAsReference ?? [])),
    update: jest.fn(),
  };
  const renderer = {
    render:
      overrides.render ??
      jest.fn().mockResolvedValue({
        patch: { provider: 'openai', model: 'm', imageUrl: 'u' },
      }),
  };
  const assets = {
    countUses: jest.fn().mockResolvedValue(overrides.uses ?? 0),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    imageStudio: { enabled: true, workerEnabled: false, workerConcurrency: 2 },
  } as any;
  const worker = new ImageStudioWorkerService(
    config,
    repository as any,
    renderer as any,
    assets as any,
  );
  return { worker, repository, renderer, assets };
};

const image = { id: 'img-1', slotKind: 'scene', styleId: 's' } as any;

describe('ImageStudioWorkerService', () => {
  it('settles a rendered image as succeeded with its patch', async () => {
    const { worker, repository } = build();
    await worker.process(image);
    expect(repository.settle).toHaveBeenCalledWith(
      'img-1',
      GeneratedImageStatus.SUCCEEDED,
      expect.objectContaining({ imageUrl: 'u' }),
    );
  });

  it('settles a failure with the author-facing message only', async () => {
    const { worker, repository } = build({
      render: jest
        .fn()
        .mockRejectedValue(
          new ImageRenderError('The image service is busy right now.'),
        ),
    });
    await worker.process(image);
    expect(repository.settle).toHaveBeenCalledWith(
      'img-1',
      GeneratedImageStatus.FAILED,
      {
        error: 'The image service is busy right now.',
      },
    );
    const other = build({
      render: jest
        .fn()
        .mockRejectedValue(new Error('S3 AccessDenied arn:aws:...')),
    });
    await other.worker.process(image);
    expect(other.repository.settle.mock.calls[0][2].error).not.toMatch(
      /arn|S3/,
    );
  });

  it('requeues stale runs on reconcile', async () => {
    const { worker, repository } = build();
    await worker.reconcile();
    expect(repository.reconcileStale).toHaveBeenCalled();
  });

  it('cleans up only images nobody uses: not references, not in any saved record', async () => {
    const { worker, repository, assets } = build({
      candidates: [
        { id: 'free', imageUrl: 'u1', displayKey: 'd1', originalKey: 'o1' },
        { id: 'ref', imageUrl: 'u2', displayKey: 'd2', originalKey: 'o2' },
      ],
      usedAsReference: ['ref'],
    });
    const removed = await worker.cleanup();
    expect(removed).toBe(1);
    expect(assets.remove).toHaveBeenCalledWith('d1');
    expect(assets.remove).toHaveBeenCalledWith('o1');
    expect(assets.remove).not.toHaveBeenCalledWith('d2');
    expect(repository.update).toHaveBeenCalledWith(
      'free',
      expect.objectContaining({ status: GeneratedImageStatus.EXPIRED }),
    );
  });

  it('treats an image found in a saved record as accepted instead of deleting it', async () => {
    const { worker, repository, assets } = build({
      candidates: [
        { id: 'saved', imageUrl: 'u', displayKey: 'd', originalKey: 'o' },
      ],
      uses: 1,
    });
    await worker.cleanup();
    expect(assets.remove).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith('saved', {
      acceptedAt: expect.any(Date),
    });
  });
});
