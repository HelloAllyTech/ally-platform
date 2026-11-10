import { HttpStatus } from '@nestjs/common';
import { publicError } from '../bot-page-public.service';
import { WidgetPublicController } from '../widget-public.controller';

/** The loader's settings route answers CORS itself, only for an allowed website (chunk 13). */
describe('WidgetPublicController', () => {
  function setup(allowed: boolean) {
    const service = {
      widgetConfig: jest.fn(async () => {
        if (!allowed)
          throw publicError(HttpStatus.FORBIDDEN, 'host_not_allowed');
        return { label: 'Ask us' };
      }),
    };
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    };
    const req = { headers: { origin: 'https://sunrisemind.in' } };
    return {
      controller: new WidgetPublicController(service as never),
      service,
      headers,
      res,
      req,
    };
  }

  it('allows the asking website, never cached, never with credentials', async () => {
    const { controller, headers, req, res } = setup(true);
    expect(
      await controller.config('sunrise', req as never, res as never),
    ).toEqual({
      label: 'Ask us',
    });
    expect(headers).toEqual({
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Origin': 'https://sunrisemind.in',
    });
  });

  it('gives any other website no CORS header, so its browser reads nothing', async () => {
    const { controller, headers, req, res } = setup(false);
    await expect(
      controller.config('sunrise', req as never, res as never),
    ).rejects.toThrow();
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
