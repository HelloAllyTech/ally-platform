import axios from 'axios';

import { AppConfigService } from '../config/config.service';
import { AppVersionSettingsService } from '../app-version/service/app-version-settings.service';
import { SlackService } from '../notification/service/slack.service';
import { MobileReleaseWhatsNewAiService } from './mobile-release-whats-new-ai.service';
import { MobileReleasesService } from './mobile-releases.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

/**
 * Mobile releases after the 2026-10-23 cutover: the app is the `ally-mobile/`
 * folder of the monorepo, its old repo is archived, and the release page keeps
 * its history from before the move instead of starting empty.
 */
describe('MobileReleasesService in the monorepo', () => {
  const MONO = 'https://api.github.com/repos/HelloAllyTech/ally-platform';
  const OLD = 'https://api.github.com/repos/HelloAllyTech/ally-mobile';
  const whatsNew = { generateSuggestion: jest.fn() };
  const service = new MobileReleasesService(
    {
      githubOrg: 'HelloAllyTech',
      githubMonorepo: 'ally-platform',
      githubMobileRepo: 'HelloAllyTech/ally-mobile',
      githubActionsToken: 'token',
    } as unknown as AppConfigService,
    whatsNew as unknown as MobileReleaseWhatsNewAiService,
    {} as unknown as AppVersionSettingsService,
    {} as unknown as SlackService,
  );

  const commit = (sha: string, subject: string, parents = 1, date = '') => ({
    sha,
    parents: Array.from({ length: parents }, (_, i) => ({ sha: `p${i}` })),
    commit: { message: subject, committer: { date } },
  });
  const notFound = Object.assign(new Error('Not Found'), {
    response: { status: 404 },
  });
  const route = (routes: Record<string, unknown>) =>
    mockedAxios.get.mockImplementation(async (url: string, config?: any) => {
      const key = `${url}${config?.params?.path ? `?path=${config.params.path}` : ''}${config?.params?.sha && config.params.sha !== 'master' ? `@${config.params.sha}` : ''}`;
      if (!(key in routes)) throw new Error(`unrouted ${key}`);
      const value = routes[key];
      if (value instanceof Error) throw value;
      return { data: value } as never;
    });

  beforeEach(() => jest.clearAllMocks());

  it("reads the app's version files from its folder of the monorepo", async () => {
    const encode = (text: string) => Buffer.from(text).toString('base64');
    route({
      [`${MONO}/contents/ally-mobile/android/app/build.gradle`]: {
        content: encode('versionCode 245\n versionName "1.23.45"'),
      },
      [`${MONO}/contents/ally-mobile/ios/ally.xcodeproj/project.pbxproj`]: {
        content: encode('MARKETING_VERSION = 1.23.45;'),
      },
      [`${MONO}/commits?path=ally-mobile/android/app/build.gradle`]: [],
      [`${OLD}/commits?path=android/app/build.gradle`]: [
        commit('bump45', 'chore(release): 1.23.45', 1, '2026-10-22T16:46:54Z'),
      ],
    });

    const version = await service.getCurrentVersion();

    expect(version.android).toEqual({
      versionCode: 245,
      versionName: '1.23.45',
    });
    expect(version.ios.marketingVersion).toBe('1.23.45');
    // The cadence clock runs from the last real bump — in the archived repo
    // until the first release ships from the monorepo.
    expect(version.nextEligibleCheckAt).not.toBeNull();
  });

  /**
   * The monorepo's history of build.gradle starts with the cutover's import
   * merges, which bumped nothing; read as releases, they would make What's New
   * a list of every service's commits.
   */
  it("skips the import merges and drafts What's New from the archived repo until the first monorepo release", async () => {
    route({
      [`${MONO}/commits?path=ally-mobile/android/app/build.gradle`]: [
        commit('import2', "Merge 'ally-mobile/' from commit '34eb25f'", 2),
        commit('import1', "Merge 'ally-mobile/' from commit 'bc73721'", 2),
      ],
      [`${OLD}/commits?path=android/app/build.gradle`]: [
        commit('bump45', 'chore(release): 1.23.45'),
        commit('bump44', 'chore(release): 1.23.44'),
      ],
      [`${OLD}/compare/bump44...bump45`]: {
        commits: [
          commit('a', 'fix(recorder): keep the socket'),
          commit('b', 'chore(release): 1.23.45'),
        ],
      },
    });
    whatsNew.generateSuggestion.mockResolvedValue('Recorder fix');

    await service.getWhatsNewSuggestion();

    expect(whatsNew.generateSuggestion).toHaveBeenCalledWith([
      'fix(recorder): keep the socket',
      'chore(release): 1.23.45',
    ]);
  });

  it("drafts the first monorepo release from the app's own commits, never another service's", async () => {
    route({
      [`${MONO}/commits?path=ally-mobile/android/app/build.gradle`]: [
        commit('bump46', 'chore(release): 1.23.46'),
        commit('import2', "Merge 'ally-mobile/' from commit '34eb25f'", 2),
      ],
      [`${OLD}/commits?path=android/app/build.gradle`]: [
        commit('bump45', 'chore(release): 1.23.45'),
      ],
      [`${OLD}/compare/bump45...master`]: { commits: [] },
      [`${MONO}/commits?path=ally-mobile@bump46`]: [
        commit('bump46', 'chore(release): 1.23.46'),
        commit('c', 'fix(mobile): tolerate husky outside a git root'),
        commit('import2', "Merge 'ally-mobile/' from commit '34eb25f'", 2),
      ],
    });
    whatsNew.generateSuggestion.mockResolvedValue('x');

    await service.getWhatsNewSuggestion();

    expect(whatsNew.generateSuggestion).toHaveBeenCalledWith([
      'fix(mobile): tolerate husky outside a git root',
      'chore(release): 1.23.46',
    ]);
  });

  it('shows one run history across the cutover, even before a workflow is registered in the monorepo', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (
        url.startsWith(`${MONO}/actions/workflows/build-android-production.yml`)
      ) {
        return {
          data: {
            workflow_runs: [
              { id: 2, created_at: '2026-10-24T05:00:00Z', name: 'after' },
            ],
          },
        } as never;
      }
      if (url.startsWith(MONO)) throw notFound;
      if (
        url.startsWith(`${OLD}/actions/workflows/build-android-production.yml`)
      ) {
        return {
          data: {
            workflow_runs: [
              { id: 1, created_at: '2026-10-21T05:00:00Z', name: 'before' },
            ],
          },
        } as never;
      }
      return { data: { workflow_runs: [] } } as never;
    });

    const runs = await service.listRuns();
    const android = runs.filter((run) => run.workflowName === 'Android Build');

    expect(android.map((run) => run.createdAt)).toEqual([
      '2026-10-24T05:00:00Z',
      '2026-10-21T05:00:00Z',
    ]);
  });

  it('dispatches the Android promotion in the monorepo', async () => {
    mockedAxios.post.mockResolvedValue({ status: 204 } as never);

    await service.promoteAndroid({ rolloutPercentage: 10 } as never);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      `${MONO}/actions/workflows/promote-android-production.yml/dispatches`,
      expect.anything(),
      expect.anything(),
    );
  });
});
