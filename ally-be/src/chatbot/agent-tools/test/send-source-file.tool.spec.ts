import { SendSourceFileTool } from '../send-source-file.tool';

/** WA-A §2: the agent sends one of the assistant's own documents when asked. */
describe('send_source_file', () => {
  const sources = [
    {
      id: 'd1',
      title: 'Registration form',
      file_url: 'https://b.s3.ap.amazonaws.com/kb/form.pdf',
      file_name: 'registration.pdf',
      content_type: 'application/pdf',
      size_bytes: '2048',
    },
    {
      id: 'd2',
      title: 'Price list 2026',
      file_url: 'https://b.s3.ap.amazonaws.com/kb/prices.pdf',
      file_name: 'prices.pdf',
      content_type: 'application/pdf',
      size_bytes: 1024,
    },
  ];
  const build = () => {
    const query = jest.fn().mockResolvedValue(sources);
    return { tool: new SendSourceFileTool({ query } as never), query };
  };
  const ctx = {
    chatbotId: 'bot-1',
    conversationId: 'conv-1',
    runId: 'run-1',
    contactId: null,
  };

  it('takes only a title', () => {
    const { tool } = build();
    expect(tool.parse({ title: ' Registration form ' })).toEqual({
      title: 'Registration form',
    });
    expect(() => tool.parse({ title: '' })).toThrow();
    expect(() => tool.parse({ title: 'x', chatbotId: 'other' })).toThrow(
      /Unknown/,
    );
  });

  it('names the document to send; the file goes after the reply', async () => {
    const { tool, query } = build();
    expect(await tool.run(ctx, { title: 'registration form' })).toEqual({
      ok: true,
      result: {
        document_id: 'd1',
        title: 'Registration form',
        will_send: true,
      },
    });
    // Only this assistant's own (or selected) uploaded documents.
    expect(query.mock.calls[0][0]).toContain('owner_chatbot_id = $1');
    expect(query.mock.calls[0][0]).toContain('chatbot_documents');
    expect(query.mock.calls[0][1][0]).toBe('bot-1');
  });

  it('a title that matches nothing: the agent reads which files it can send', async () => {
    const { tool } = build();
    expect(await tool.run(ctx, { title: 'tax return' })).toEqual({
      ok: false,
      error: 'no_such_file',
      result: { files: ['Registration form', 'Price list 2026'] },
    });
  });
});
