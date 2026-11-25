import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { WorkingCopyController } from '../controller/working-copy.controller';
import { TemplateController } from '../templates/template.controller';

/**
 * TF1: T1's "apply a use-case template during setup" shared `POST bot-drafts/:id/template` with the
 * library templates. Nest serves the first registered, so the use-case route was never reached.
 */
describe('setup routes are unique', () => {
  const routes = (controller: new (...args: never[]) => unknown) => {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const proto = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map((name) => proto[name])
      .filter((fn) => Reflect.hasMetadata(PATH_METADATA, fn as object))
      .map(
        (fn) =>
          `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn as object) as number]} ${base}/${String(
            Reflect.getMetadata(PATH_METADATA, fn as object),
          )}`,
      );
  };

  it('no two controllers answer the same method and path', () => {
    const all = [
      ...routes(WorkingCopyController as never),
      ...routes(TemplateController as never),
    ];
    const seen = new Set<string>();
    const dupes = all.filter((r) =>
      seen.has(r) ? true : (seen.add(r), false),
    );
    expect(dupes).toEqual([]);
    expect(all).toContain('POST v1/bot-drafts/:id/use-case');
  });
});
