import { DEFAULT_WHATSAPP_SETTINGS } from 'src/whatsapp/type/whatsapp-settings.type';
import {
  ChatbotSettingsService,
  changesPlatformAdminOnlySetting,
} from '../chatbot-settings.service';

/**
 * Chunk 12b's two platform switches: opening bot pages to anyone (off until chunk 15a) and moving
 * the dashboard onto the shared store. Only a platform admin changes them, and no bot can.
 */
describe('platform-admin-only settings', () => {
  const stored = { ...DEFAULT_WHATSAPP_SETTINGS };

  it.each([
    [{ botPagePublicAllowed: true }, true],
    [{ dashboardReadsFrom: 'shared' }, true],
    [{ botPagePublicAllowed: false }, false],
    [{ dashboardReadsFrom: 'wa', declineText: 'x' }, false],
    [{ declineText: 'x' }, false],
  ])('sent %j: changes one = %s', (patch, changes) => {
    expect(changesPlatformAdminOnlySetting(stored, patch)).toBe(changes);
  });

  it('defaults both to the safe value', () => {
    expect(DEFAULT_WHATSAPP_SETTINGS.botPagePublicAllowed).toBe(false);
    expect(DEFAULT_WHATSAPP_SETTINGS.dashboardReadsFrom).toBe('wa');
  });

  it('never lets a bot’s own settings turn them on', () => {
    const service = new ChatbotSettingsService({} as never, {} as never);
    const merged = service.applyOverride(stored, {
      botPagePublicAllowed: true,
      dashboardReadsFrom: 'shared',
      declineText: 'x',
    } as never);
    expect(merged.botPagePublicAllowed).toBe(false);
    expect(merged.dashboardReadsFrom).toBe('wa');
  });
});
