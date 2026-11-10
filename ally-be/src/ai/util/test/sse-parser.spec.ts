import { SseParser } from '../sse-parser';

describe('SseParser', () => {
  it('reads messages split anywhere across chunks', () => {
    const parser = new SseParser();
    const text =
      'event: status\ndata: {"code":"thinking"}\n\nevent: final\ndata: {"a":1}\n\n';
    const out = [...text].flatMap((char) => parser.push(char));
    expect(out).toEqual([
      { event: 'status', data: '{"code":"thinking"}' },
      { event: 'final', data: '{"a":1}' },
    ]);
  });

  it('skips comment lines (pings) and keeps an unfinished message for the next chunk', () => {
    const parser = new SseParser();
    expect(parser.push(': ping\n\nevent: step\ndata: {"node"')).toEqual([]);
    expect(parser.push(':"agent"}\r\n\r\n')).toEqual([
      { event: 'step', data: '{"node":"agent"}' },
    ]);
  });
});
