import * as cors from 'cors';
import * as express from 'express';
import * as request from 'supertest';
import { appCorsDelegate, isWidgetRoute } from '../app-cors';

const ADMIN = 'https://admin.ally.test';
const OWNER_SITE = 'https://sunrisemind.in';

/**
 * The app's CORS leaves out exactly the website widget's two routes (chunk 13), and nothing that
 * merely starts like them.
 */
describe('app CORS', () => {
  describe('isWidgetRoute', () => {
    it.each([
      '/api/v1/public/widget/sunrise-mind',
      '/api/v1/public/widget/sunrise-mind?x=1',
      '/api/v1/public/widget/sunrise-mind/frame-policy',
      '/api/v1/public/widget/sunrise%20mind',
    ])('matches the widget route %s', (url) => {
      expect(isWidgetRoute(url)).toBe(true);
    });

    it.each([
      '/api/v1/public/widgetX/sunrise-mind',
      '/api/v1/public/widget',
      '/api/v1/public/widget/',
      '/api/v1/public/widgets/sunrise-mind',
      '/api/v1/public/widget/sunrise-mind/other',
      '/api/v1/public/widget/sunrise-mind/frame-policy/x',
      '/api/v1/public/widget/../bots/sunrise-mind/session',
      '/api/v1/public/widget/x/../../bots/sunrise-mind/session',
      '/api/v1/public/widget%2F..%2Fbots/sunrise-mind/session',
      '/api/v1/public/widget/sunrise-mind#x',
      '/api/v1/public/bots/sunrise-mind',
      '/api/v1/chatbots/widget/sunrise-mind',
      '/x/api/v1/public/widget/sunrise-mind',
      '//api/v1/public/widget/sunrise-mind',
      '/API/V1/PUBLIC/WIDGET/sunrise-mind',
      '',
      undefined,
    ])('does not match %s', (url) => {
      expect(isWidgetRoute(url)).toBe(false);
    });
  });

  describe('through the cors middleware', () => {
    // Every path answers, so only CORS decides what a browser could read.
    const app = express();
    app.use(cors(appCorsDelegate(() => [ADMIN]) as never));
    app.use((req, res) => res.json({ path: req.url }));
    // A refusal from the origin check becomes a 500 with no CORS headers.
    const refused: express.ErrorRequestHandler = (error, _req, res, next) =>
      error ? res.status(500).json({ refused: true }) : next();
    app.use(refused);

    it('allows the admin origin, with credentials, on ordinary routes', async () => {
      const res = await request(app)
        .get('/api/v1/public/bots/sunrise-mind')
        .set('Origin', ADMIN);
      expect(res.headers['access-control-allow-origin']).toBe(ADMIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it.each([
      '/api/v1/public/bots/sunrise-mind/session',
      '/api/v1/public/widgetX/sunrise-mind',
      '/api/v1/public/widget/sunrise-mind/other',
      '/api/v1/public/widget/../bots/sunrise-mind/session',
      '/api/v1/chatbots',
    ])('refuses an owner site on %s', async (path) => {
      const res = await request(app).get(path).set('Origin', OWNER_SITE);
      expect(res.status).toBe(500);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it("leaves the widget's routes to their controller: no headers from this layer", async () => {
      for (const path of [
        '/api/v1/public/widget/sunrise-mind',
        '/api/v1/public/widget/sunrise-mind/frame-policy',
      ]) {
        const res = await request(app).get(path).set('Origin', OWNER_SITE);
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      }
    });
  });
});
