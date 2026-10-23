import { findBuilderRepo } from '../constants/builder-repos.constants';
import { renderRepoChecks } from './builder-pipeline.controller';

describe('renderRepoChecks', () => {
  it('names the extra checks CI blocks on, not only test and lint', () => {
    const text = renderRepoChecks([findBuilderRepo('ally-web')!]);

    expect(text).toContain('`npm run lint:colors`');
    expect(text).toContain('`npx tsc -b --pretty false`');
  });

  it('points at the root docs map and has the wiki page edited in the same pull request', () => {
    const text = renderRepoChecks([findBuilderRepo('ally-be')!]);

    expect(text).toContain('root of this monorepo');
    expect(text).toContain('helloallytech.github.io/wiki/');
    expect(text).toContain('same pull request');
    // The old two-PR flow: a trailer in place of an edit.
    expect(text).not.toMatch(/`Wiki-PR: none/);
  });

  it('is empty without a repo', () => {
    expect(renderRepoChecks([])).toBe('');
  });
});
