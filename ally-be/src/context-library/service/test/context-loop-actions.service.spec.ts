import { BadRequestException } from '@nestjs/common';
import {
  ClChunkConfidence,
  ClChunkStatus,
  ClLoop,
  ClLoopActionType,
} from '../../enum/context-library.enum';
import { ContextLoopActionsService } from '../context-loop-actions.service';

function setup(action: any, chunk: any = null) {
  const actions = {
    findOne: jest.fn().mockResolvedValue(action),
    save: jest.fn().mockImplementation(async (a) => a),
    create: jest.fn((a) => a),
    find: jest.fn().mockResolvedValue([]),
  };
  const chunks = {
    findOne: jest.fn().mockResolvedValue(chunk),
    update: jest.fn(),
  };
  const collections = { update: jest.fn() };
  const chunkService = {
    snapshot: jest.fn(),
    saveChanged: jest.fn().mockImplementation(async (c) => c),
  };
  const service = new ContextLoopActionsService(
    actions as any,
    chunks as any,
    collections as any,
    chunkService as any,
  );
  return { service, actions, chunks, collections, chunkService };
}

describe('ContextLoopActionsService.undo', () => {
  it('restores an archived chunk and stamps the action as undone', async () => {
    const chunk = {
      id: 'c1',
      status: ClChunkStatus.ARCHIVED,
      confidence: ClChunkConfidence.STANDARD,
    };
    const { service, chunkService } = setup(
      {
        id: 'a1',
        collectionId: 'first_principles',
        loop: ClLoop.CURATOR,
        action: ClLoopActionType.ARCHIVE,
        chunkId: 'c1',
        before: { status: 'active', confidence: 'standard' },
      },
      chunk,
    );
    const result = await service.undo('a1', 7);
    expect(chunk.status).toBe(ClChunkStatus.ACTIVE);
    expect(chunkService.saveChanged).toHaveBeenCalledWith(chunk, 'undo', 7);
    expect(result.undoneAt).toBeInstanceOf(Date);
    expect(result.undoneBy).toBe(7);
  });

  it('removes a learned query and remembers the refusal', async () => {
    const chunk: any = {
      id: 'c1',
      exampleQueries: [
        { text: 'empty dashboard', origin: 'extracted' },
        { text: 'First screen with no data', origin: 'learned' },
      ],
      quality: {},
    };
    const { service } = setup(
      {
        id: 'a2',
        collectionId: 'first_principles',
        action: ClLoopActionType.LEARN_QUERY,
        chunkId: 'c1',
        after: { query: 'First screen with no data' },
      },
      chunk,
    );
    await service.undo('a2', 1);
    expect(chunk.exampleQueries).toEqual([
      { text: 'empty dashboard', origin: 'extracted' },
    ]);
    expect(chunk.quality.rejectedQueries).toEqual([
      'first screen with no data',
    ]);
  });

  it('puts the previous search setup back', async () => {
    const live = {
      weights: { bm25: 1, statement: 1, situations: 1 },
      rerank: true,
      mmrLambda: 0.7,
      contextualise: false,
    };
    const promoted = { ...live, rerank: false };
    const { service, collections } = setup({
      id: 'a3',
      collectionId: 'first_principles',
      action: ClLoopActionType.PROMOTE_SETUP,
      before: { setup: live },
      after: { setup: promoted },
    });
    await service.undo('a3', 1);
    expect(collections.update).toHaveBeenCalledWith(
      { id: 'first_principles' },
      expect.objectContaining({
        activeSearchSetup: live,
        previousSearchSetup: promoted,
      }),
    );
  });

  it('refuses to undo twice', async () => {
    const { service } = setup({
      id: 'a4',
      action: ClLoopActionType.ARCHIVE,
      undoneAt: new Date(),
    });
    await expect(service.undo('a4', 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('agent curator actions', () => {
    it('undoes an agreement: the candidate is its own lesson again and the target loses the count', async () => {
      const absorbed: any = {
        id: 'cand',
        status: ClChunkStatus.SUPERSEDED,
        supersededById: 'keep',
      };
      const keep: any = {
        id: 'keep',
        sourceCount: 3,
        facets: { repos: ['ally-be', 'ally-web'] },
        attributes: { sessionIds: ['s1', 's2'] },
      };
      const { service, chunks, chunkService } = setup(
        {
          id: 'a5',
          collectionId: 'builder_lessons',
          action: ClLoopActionType.AGREE,
          chunkId: 'cand',
          before: {
            status: 'candidate',
            keepId: 'keep',
            keepSourceCount: 2,
            keepFacets: { repos: ['ally-be'] },
            keepAttributes: { sessionIds: ['s1'] },
          },
        },
        absorbed,
      );
      chunks.findOne
        .mockResolvedValueOnce(absorbed)
        .mockResolvedValueOnce(keep);
      await service.undo('a5', 9);
      expect(absorbed.status).toBe(ClChunkStatus.ACTIVE);
      expect(absorbed.supersededById).toBeNull();
      expect(keep.sourceCount).toBe(2);
      expect(keep.facets).toEqual({ repos: ['ally-be'] });
      expect(keep.attributes).toEqual({ sessionIds: ['s1'] });
      expect(chunkService.saveChanged).toHaveBeenCalledWith(keep, 'undo', 9);
    });

    it('undoes an edit by restoring the earlier wording', async () => {
      const chunk: any = {
        id: 'c1',
        statement: 'new words',
        body: null,
        facets: { category: 'process' },
      };
      const { service } = setup(
        {
          id: 'a6',
          collectionId: 'bug_hunter_notes',
          action: ClLoopActionType.EDIT,
          chunkId: 'c1',
          before: {
            statement: 'old words',
            body: null,
            facets: { category: 'gotcha' },
          },
        },
        chunk,
      );
      await service.undo('a6', 1);
      expect(chunk.statement).toBe('old words');
      expect(chunk.facets).toEqual({ category: 'gotcha' });
    });

    it('undoes an addition by archiving, never by returning it to the candidates', async () => {
      const chunk: any = {
        id: 'c1',
        statement: 'tightened',
        status: ClChunkStatus.ACTIVE,
      };
      const { service } = setup(
        {
          id: 'a7',
          collectionId: 'bug_hunter_notes',
          action: ClLoopActionType.ADD,
          chunkId: 'c1',
          before: { status: 'candidate', statement: 'as the agent wrote it' },
        },
        chunk,
      );
      await service.undo('a7', 1);
      expect(chunk.status).toBe(ClChunkStatus.ARCHIVED);
      expect(chunk.statement).toBe('as the agent wrote it');
    });

    it.each([ClLoopActionType.REMOVE, ClLoopActionType.RETIRE])(
      'undoes a %s by putting the chunk back as it was',
      async (action) => {
        const chunk: any = { id: 'c1', status: ClChunkStatus.ARCHIVED };
        const { service } = setup(
          {
            id: 'a8',
            collectionId: 'builder_lessons',
            action,
            chunkId: 'c1',
            before: { status: 'active' },
          },
          chunk,
        );
        await service.undo('a8', 1);
        expect(chunk.status).toBe(ClChunkStatus.ACTIVE);
      },
    );
  });
});
