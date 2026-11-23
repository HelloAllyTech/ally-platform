import { isPreviewConversation } from '../list-tools.service';

describe('isPreviewConversation (Q4 B12)', () => {
  it('counts Try it and checkup questions as test chats, and nothing else', () => {
    expect(isPreviewConversation('preview-1b2c')).toBe(true);
    expect(isPreviewConversation('checkup-1a2b3c4d-5e6f7a8b-1')).toBe(true);
    expect(isPreviewConversation('0b9f3c1e-2d4a-4c5b-9e8f-7a6b5c4d3e2f')).toBe(
      false,
    );
    expect(isPreviewConversation('whatsapp-checkup-1')).toBe(false);
  });
});
