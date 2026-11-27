import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A webhook body in Meta's Cloud API format (WA-A). Loaded fresh each call so a test can change
 * its copy. The JSON files beside this one are written to Meta's documented payloads with
 * made-up ids and numbers; no live Meta call is made in any test.
 */
export const recordedWebhook = <T = any>(name: string): T =>
  JSON.parse(readFileSync(join(__dirname, `${name}.json`), 'utf8')) as T;
