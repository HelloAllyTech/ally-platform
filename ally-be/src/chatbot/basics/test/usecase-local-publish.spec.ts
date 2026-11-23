import { localPublishAllowed } from '../usecase-local-publish';

describe('usecase-local-publish (Q4, test only)', () => {
  it.each(['development', 'DEVELOPMENT', 'local'])(
    'runs on a %s stack',
    (env) => {
      expect(localPublishAllowed(env)).toBe(true);
    },
  );

  it.each(['production', 'staging', 'test', '', undefined])(
    'refuses anywhere else (%s)',
    (env) => {
      expect(localPublishAllowed(env)).toBe(false);
    },
  );
});
