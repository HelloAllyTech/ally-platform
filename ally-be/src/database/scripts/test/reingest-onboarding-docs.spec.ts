import {
  NEEDS_REINGEST_SQL,
  reindexMessage,
} from '../reingest-onboarding-docs';

/** Agents v2 chunk 20a-2: the re-ingest that worked locally, kept on that path. */
describe('reingest-onboarding-docs', () => {
  it('queues a reindex (a new chunk version), never an ingest', () => {
    expect(reindexMessage('doc-1')).toEqual({
      documentId: 'doc-1',
      action: 'reindex',
    });
  });

  it("selects only onboarded assistants' pasted documents still chunked the old way", () => {
    expect(NEEDS_REINGEST_SQL).toContain("d.source_type = 'paste'");
    expect(NEEDS_REINGEST_SQL).toContain(
      "(c.safety_pack IS NOT NULL OR 'onboarding' = ANY(d.tags))",
    );
    expect(NEEDS_REINGEST_SQL).toContain(
      'NOT bool_or(left(k.text, length(k.section_path)) = k.section_path)',
    );
  });
});
