import axios from 'axios';
import { Test, TestingModule } from '@nestjs/testing';
import { MobileReleasesService } from './mobile-releases.service';
import { AppConfigService } from '../config/config.service';
import { MobileReleaseWhatsNewAiService } from './mobile-release-whats-new-ai.service';
import { AppVersionSettingsService } from '../app-version/service/app-version-settings.service';
import { SlackService } from '../notification/service/slack.service';
import { MinimumVersionResponseDto } from '../app-version/dto/minimum-version-response.dto';

describe('MobileReleasesService', () => {
  let service: MobileReleasesService;
  let appVersionSettingsService: AppVersionSettingsService;

  const mockAppConfigService = {
    githubMobileRepo: 'some/repo',
    githubActionsToken: 'some_token',
    appStoreConnect: {
      issuerId: 'some_issuer_id',
      apiKeyId: 'some_api_key_id',
      privateKey: 'some_private_key',
      testflightExternalGroupName: 'some_group',
    },
    androidMinVersionAutoBumpEnabled: true,
  };

  const mockMobileReleaseWhatsNewAiService = {
    generateSuggestion: jest.fn(),
  };

  const mockAppVersionSettingsService = {
    getAppVersionSettings: jest.fn(),
    updateAppVersionSettings: jest.fn(),
  };

  const mockSlackService = {
    sendMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileReleasesService,
        { provide: AppConfigService, useValue: mockAppConfigService },
        {
          provide: MobileReleaseWhatsNewAiService,
          useValue: mockMobileReleaseWhatsNewAiService,
        },
        {
          provide: AppVersionSettingsService,
          useValue: mockAppVersionSettingsService,
        },
        { provide: SlackService, useValue: mockSlackService },
      ],
    }).compile();

    service = module.get<MobileReleasesService>(MobileReleasesService);
    appVersionSettingsService = module.get<AppVersionSettingsService>(
      AppVersionSettingsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('autoBumpIosMinimumVersionIfLive', () => {
    it('should not update if build.version is "NaN"', async () => {
      // Mock App Store Connect config to be available
      jest
        .spyOn(service as any, 'requireAppStoreConnectConfig')
        .mockReturnValue(mockAppConfigService.appStoreConnect);
      jest
        .spyOn(service as any, 'mintAppStoreConnectJwt')
        .mockReturnValue('jwt_token');

      // Mock fetchAppStoreConnectAppId to return an ID
      jest
        .spyOn(service as any, 'fetchAppStoreConnectAppId')
        .mockResolvedValue('some_app_id');

      // Mock fetchLatestValidBuild to return a build with version "NaN"
      jest
        .spyOn(service as any, 'fetchLatestValidBuild')
        .mockResolvedValue({ id: 'some_build_id', version: 'NaN' });

      // Mock fetchAppStoreVersionState to be READY_FOR_DISTRIBUTION
      jest
        .spyOn(service as any, 'fetchAppStoreVersionState')
        .mockResolvedValue('READY_FOR_DISTRIBUTION');

      // Mock getAppVersionSettings to return a different version
      mockAppVersionSettingsService.getAppVersionSettings.mockResolvedValue(
        new (class implements MinimumVersionResponseDto {
          minimumSupportedVersion = '1.0.0';
        })(),
      );

      await service.autoBumpIosMinimumVersionIfLive();

      // Expect updateAppVersionSettings NOT to be called, or to handle it gracefully
      expect(
        appVersionSettingsService.updateAppVersionSettings,
      ).not.toHaveBeenCalled();
    });

    it('should not update if build.version is not in X.Y.Z format', async () => {
      // Mock App Store Connect config to be available
      jest
        .spyOn(service as any, 'requireAppStoreConnectConfig')
        .mockReturnValue(mockAppConfigService.appStoreConnect);
      jest
        .spyOn(service as any, 'mintAppStoreConnectJwt')
        .mockReturnValue('jwt_token');

      // Mock fetchAppStoreConnectAppId to return an ID
      jest
        .spyOn(service as any, 'fetchAppStoreConnectAppId')
        .mockResolvedValue('some_app_id');

      // Mock fetchLatestValidBuild to return a build with a non-X.Y.Z version
      jest
        .spyOn(service as any, 'fetchLatestValidBuild')
        .mockResolvedValue({ id: 'some_build_id', version: '1234567890' }); // A build number string

      // Mock fetchAppStoreVersionState to be READY_FOR_DISTRIBUTION
      jest
        .spyOn(service as any, 'fetchAppStoreVersionState')
        .mockResolvedValue('READY_FOR_DISTRIBUTION');

      // Mock getAppVersionSettings to return a different version
      mockAppVersionSettingsService.getAppVersionSettings.mockResolvedValue(
        new (class implements MinimumVersionResponseDto {
          minimumSupportedVersion = '1.0.0';
        })(),
      );

      await service.autoBumpIosMinimumVersionIfLive();

      // Expect updateAppVersionSettings NOT to be called, or to handle it gracefully
      expect(
        appVersionSettingsService.updateAppVersionSettings,
      ).not.toHaveBeenCalled();
    });
  });

  describe('autoBumpAndroidMinimumVersionIfLive', () => {
    afterEach(() => {
      jest.restoreAllMocks();
      jest.clearAllMocks();
    });

    it('no-ops when the kill switch is off', async () => {
      Object.defineProperty(
        mockAppConfigService,
        'androidMinVersionAutoBumpEnabled',
        {
          value: false,
          configurable: true,
        },
      );
      const internalSpy = jest.spyOn(
        service as any,
        'fetchAndroidInternalRelease',
      );

      await service.autoBumpAndroidMinimumVersionIfLive();

      expect(internalSpy).not.toHaveBeenCalled();
      Object.defineProperty(
        mockAppConfigService,
        'androidMinVersionAutoBumpEnabled',
        {
          value: true,
          configurable: true,
        },
      );
    });

    it('no-ops when the internal track has no parseable release', async () => {
      jest
        .spyOn(service as any, 'fetchAndroidInternalRelease')
        .mockResolvedValue(null);

      await service.autoBumpAndroidMinimumVersionIfLive();

      expect(
        appVersionSettingsService.updateAppVersionSettings,
      ).not.toHaveBeenCalled();
    });

    it('no-ops when the production track is not fully completed', async () => {
      jest
        .spyOn(service as any, 'fetchAndroidInternalRelease')
        .mockResolvedValue({
          versionCode: 109,
          versionName: '2.0.0',
        });
      jest
        .spyOn(service as any, 'fetchAndroidProductionRelease')
        .mockResolvedValue({
          status: 'inProgress',
          versionCodes: [109],
          userFraction: 0.2,
        });

      await service.autoBumpAndroidMinimumVersionIfLive();

      expect(
        appVersionSettingsService.updateAppVersionSettings,
      ).not.toHaveBeenCalled();
    });

    it("no-ops when the production track's versionCode does not match the internal track's", async () => {
      jest
        .spyOn(service as any, 'fetchAndroidInternalRelease')
        .mockResolvedValue({
          versionCode: 110,
          versionName: '2.0.1',
        });
      jest
        .spyOn(service as any, 'fetchAndroidProductionRelease')
        .mockResolvedValue({
          status: 'completed',
          versionCodes: [109],
          userFraction: null,
        });

      await service.autoBumpAndroidMinimumVersionIfLive();

      expect(
        appVersionSettingsService.updateAppVersionSettings,
      ).not.toHaveBeenCalled();
    });

    it('raises the minimum version once the matching build is fully rolled out', async () => {
      jest
        .spyOn(service as any, 'fetchAndroidInternalRelease')
        .mockResolvedValue({
          versionCode: 109,
          versionName: '2.0.0',
        });
      jest
        .spyOn(service as any, 'fetchAndroidProductionRelease')
        .mockResolvedValue({
          status: 'completed',
          versionCodes: [109],
          userFraction: null,
        });
      mockAppVersionSettingsService.getAppVersionSettings.mockResolvedValue(
        new (class implements MinimumVersionResponseDto {
          minimumSupportedVersion = '1.23.47';
        })(),
      );

      await service.autoBumpAndroidMinimumVersionIfLive();

      expect(
        appVersionSettingsService.updateAppVersionSettings,
      ).toHaveBeenCalledWith({ android: '2.0.0' });
      expect(mockSlackService.sendMessage).toHaveBeenCalled();
    });

    it('no-ops when the minimum version already matches', async () => {
      jest
        .spyOn(service as any, 'fetchAndroidInternalRelease')
        .mockResolvedValue({
          versionCode: 109,
          versionName: '2.0.0',
        });
      jest
        .spyOn(service as any, 'fetchAndroidProductionRelease')
        .mockResolvedValue({
          status: 'completed',
          versionCodes: [109],
          userFraction: null,
        });
      mockAppVersionSettingsService.getAppVersionSettings.mockResolvedValue(
        new (class implements MinimumVersionResponseDto {
          minimumSupportedVersion = '2.0.0';
        })(),
      );

      await service.autoBumpAndroidMinimumVersionIfLive();

      expect(
        appVersionSettingsService.updateAppVersionSettings,
      ).not.toHaveBeenCalled();
    });
  });

  describe('triggerRelease', () => {
    afterEach(() => jest.restoreAllMocks());

    it('dispatches scheduled-mobile-release.yml with force: true', async () => {
      const postSpy = jest
        .spyOn(axios, 'post')
        .mockResolvedValue({ status: 204 } as never);

      const result = await service.triggerRelease();

      expect(result).toEqual({ dispatched: true });
      expect(postSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '/actions/workflows/scheduled-mobile-release.yml/dispatches',
        ),
        { ref: 'master', inputs: { force: 'true' } },
        expect.anything(),
      );
    });

    it('surfaces a readable error when the dispatch fails', async () => {
      jest.spyOn(axios, 'post').mockRejectedValue(new Error('403 Forbidden'));

      await expect(service.triggerRelease()).rejects.toThrow();
    });
  });
});
