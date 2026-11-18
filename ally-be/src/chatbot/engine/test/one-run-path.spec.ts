import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * One run path, no v1 (Q3-fast Part 0): no chatbot channel (bot page, bubble, WhatsApp, Try it,
 * checkups, the basics runner) may reach the v1 answer pipeline, `/knowledge-agent/answer`. The v1
 * code stays in `AiService` until R2/CL2 deletes it; only the platform WhatsApp admin's tuning
 * console (`WhatsAppAdminService.previewAsk`) still calls it, and it is not a chatbot.
 */
describe('one run path for every chatbot channel', () => {
  const SRC = join(__dirname, '..', '..', '..');
  const V1_CALL = /\banswerKnowledgeQuestion(Within)?\s*\(/;

  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return name === 'test' ? [] : sources(path);
      }
      return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });

  it.each([
    'chatbot',
    'bot-draft',
    join('whatsapp', 'service', 'whatsapp-inbound.service.ts'),
  ])('nothing under %s calls the v1 answer pipeline', (target) => {
    const path = join(SRC, target);
    const files = statSync(path).isDirectory() ? sources(path) : [path];
    expect(files.length).toBeGreaterThan(0);
    const callers = files.filter((file) =>
      V1_CALL.test(readFileSync(file, 'utf8')),
    );
    expect(callers).toEqual([]);
  });
});
