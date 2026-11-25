import { ProductUpdatesService } from '../product-updates.service';

/** The public feed's paging and its product-area filter (the chatbot builder's Change log tab). */
describe('ProductUpdatesService.listPublic', () => {
  const live = {
    id: 'u1',
    slug: 'a',
    title: 'T',
    summary: 'S',
    kind: 'new',
    surfaces: ['whatsapp'],
    area: 'WhatsApp assistant',
    liveAt: new Date('2025-11-20T00:00:00Z'),
  };
  const build = () => {
    const updateRepository = {
      findPublic: jest.fn(async () => ({ updates: [live], count: 1 })),
    };
    const service = new ProductUpdatesService(
      updateRepository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, updateRepository };
  };

  it('passes the product area through to the query', async () => {
    const { service, updateRepository } = build();
    const result = await service.listPublic({ area: 'WhatsApp assistant' });
    expect(updateRepository.findPublic).toHaveBeenCalledWith(
      expect.objectContaining({ area: 'WhatsApp assistant' }),
    );
    expect(result.count).toBe(1);
    expect(result.updates[0]).toEqual(
      expect.objectContaining({ title: 'T', area: 'WhatsApp assistant' }),
    );
  });

  it('asks for every area when none is given, and clamps the page', async () => {
    const { service, updateRepository } = build();
    await service.listPublic({ limit: 5000, offset: -3 });
    expect(updateRepository.findPublic).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      surface: undefined,
      area: undefined,
    });
  });
});
