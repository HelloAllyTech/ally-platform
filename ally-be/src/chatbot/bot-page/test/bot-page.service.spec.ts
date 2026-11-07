import { BadRequestException, ConflictException } from '@nestjs/common';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { UpdateBotPageDto } from '../../dto/bot-page.dto';
import {
  BotPageAccess,
  BotPageStatus,
  PrechatFieldType,
} from '../../enum/bot-page.enum';
import { ChatbotStatus } from '../../enum/chatbot.enum';
import { BotPageService } from '../bot-page.service';
import { slugFromName } from '../../type/bot-page.type';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

const bot = {
  id: 'bot-1',
  name: 'Sunrise Mind',
  status: ChatbotStatus.LIVE,
  persona: { displayName: 'Sunny' },
  settings: {},
} as never;

function dto(overrides: Partial<UpdateBotPageDto> = {}): UpdateBotPageDto {
  return {
    status: BotPageStatus.ON,
    slug: 'sunrise-mind',
    access: BotPageAccess.INVITE,
    settings: {
      branding: {
        logoUrl: null,
        accentColour: '#336699',
        title: 'Sunrise Mind',
        subtitle: 'Ask us anything',
        assistantName: 'Sunny',
        avatarUrl: null,
        disclaimer: 'Not a crisis service',
        footerLink: null,
      },
      suggestedQuestions: [' What are your fees? '],
      prechat: [
        {
          id: 'name',
          label: 'Your name',
          type: PrechatFieldType.TEXT,
          required: true,
        },
        {
          id: 'reason',
          label: 'Reason',
          type: PrechatFieldType.CHOICE,
          required: false,
          options: ['Therapy', 'Workshops'],
        },
      ],
      limits: {
        messagesPerVisitorPerHour: 30,
        maxMessageChars: 1000,
        dailyCapPerBot: 500,
      },
      language: 'auto',
    },
    ...overrides,
  } as UpdateBotPageDto;
}

describe('BotPageService', () => {
  let pages: { findOne: jest.Mock; save: jest.Mock };
  let globalSettings: typeof DEFAULT_WHATSAPP_SETTINGS;
  let service: BotPageService;

  beforeEach(() => {
    pages = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn() };
    globalSettings = { ...DEFAULT_WHATSAPP_SETTINGS, enabled: true };
    service = new BotPageService(
      pages as never,
      { findOne: jest.fn().mockResolvedValue(bot) } as never,
      { getForChatbot: jest.fn(async () => globalSettings) } as never,
      { getPresignedUrlForImageUpload: jest.fn() } as never,
      {
        botPage: { baseUrl: 'http://localhost:8081' },
        s3: { assetsBucket: 'assets' },
      } as never,
    );
  });

  describe('before the first save', () => {
    it('suggests a link from the bot’s name and prefills the crisis disclaimer', async () => {
      const view = await service.view(bot);
      expect(view.saved).toBe(false);
      expect(view.slug).toBe('sunrise-mind');
      expect(view.link).toBe('http://localhost:8081/b/sunrise-mind');
      expect(view.status).toBe(BotPageStatus.OFF);
      expect(view.access).toBe(BotPageAccess.INVITE);
      expect(view.settings.branding.assistantName).toBe('Sunny');
      expect(view.settings.branding.disclaimer).toMatch(
        /not a crisis service/i,
      );
      expect(view.publicAllowed).toBe(false);
    });

    it('leaves the disclaimer empty when the crisis classifier is off', async () => {
      globalSettings = { ...globalSettings, crisisClassifierEnabled: false };
      const view = await service.view(bot);
      expect(view.settings.branding.disclaimer).toBe('');
    });
  });

  describe('save', () => {
    it('stores the page with trimmed text', async () => {
      await service.save(bot, dto());
      const saved = pages.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        chatbotId: 'bot-1',
        slug: 'sunrise-mind',
        status: BotPageStatus.ON,
        access: BotPageAccess.INVITE,
        createdBy: 7,
        updatedBy: 7,
      });
      expect(saved.settings.suggestedQuestions).toEqual([
        'What are your fees?',
      ]);
      expect(saved.settings.prechat[1].options).toEqual([
        'Therapy',
        'Workshops',
      ]);
    });

    it('refuses public access while the platform does not allow it', async () => {
      await expect(
        service.save(bot, dto({ access: BotPageAccess.PUBLIC })),
      ).rejects.toThrow(BadRequestException);
      expect(pages.save).not.toHaveBeenCalled();
    });

    it('allows public access once botPagePublicAllowed is on', async () => {
      globalSettings = { ...globalSettings, botPagePublicAllowed: true };
      await service.save(bot, dto({ access: BotPageAccess.PUBLIC }));
      expect(pages.save).toHaveBeenCalled();
    });

    it('refuses a link another bot already has', async () => {
      pages.findOne.mockResolvedValue({
        chatbotId: 'other-bot',
        slug: 'sunrise-mind',
      });
      await expect(service.save(bot, dto())).rejects.toThrow(ConflictException);
    });

    it('turns a lost race on the unique index into the same conflict', async () => {
      pages.save.mockRejectedValue({ code: '23505' });
      await expect(service.save(bot, dto())).rejects.toThrow(ConflictException);
    });

    it.each([
      [
        'a choice with one option',
        {
          id: 'c',
          label: 'Pick',
          type: PrechatFieldType.CHOICE,
          required: true,
          options: ['Only'],
        },
      ],
      [
        'a consent with no wording',
        {
          id: 'k',
          label: 'Consent',
          type: PrechatFieldType.CONSENT,
          required: true,
        },
      ],
    ])('refuses %s', async (_label, field) => {
      const body = dto();
      body.settings.prechat = [field as never];
      await expect(service.save(bot, body)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses two questions with the same id', async () => {
      const body = dto();
      body.settings.prechat = [
        body.settings.prechat[0],
        { ...body.settings.prechat[0] },
      ];
      await expect(service.save(bot, body)).rejects.toThrow(/share an id/);
    });

    it('makes a consent question required whatever the form says', async () => {
      const body = dto();
      body.settings.prechat = [
        {
          id: 'k',
          label: 'Consent',
          type: PrechatFieldType.CONSENT,
          required: false,
          consentText: 'I agree.',
        },
      ];
      await service.save(bot, body);
      expect(pages.save.mock.calls[0][0].settings.prechat[0]).toEqual({
        id: 'k',
        label: 'Consent',
        type: PrechatFieldType.CONSENT,
        required: true,
        consentText: 'I agree.',
      });
    });
  });

  describe('checkSlug', () => {
    it.each(['mehta-clinic', 'abc', 'a1b2', 'MEHTA-Clinic'])(
      'accepts %s',
      (slug) => {
        expect(BotPageService.checkSlug(slug)).toBe(slug.toLowerCase());
      },
    );

    it.each([
      'ab',
      '-abc',
      'abc-',
      'a--b',
      'a_b',
      'has space',
      'x'.repeat(49),
      'admin',
      'login',
    ])('refuses %s', (slug) => {
      expect(() => BotPageService.checkSlug(slug)).toThrow(BadRequestException);
    });

    it('builds a valid slug from any name', () => {
      for (const name of [
        'Mehta Clinic!',
        'मेहता',
        'A',
        '---',
        'Dr. Rao & Co.',
      ]) {
        expect(() =>
          BotPageService.checkSlug(slugFromName(name)),
        ).not.toThrow();
      }
    });
  });

  describe('findAvailable (what a visitor can reach)', () => {
    const page = {
      chatbotId: 'bot-1',
      slug: 'sunrise-mind',
      status: BotPageStatus.ON,
      access: BotPageAccess.INVITE,
      settings: {},
    };

    it('returns a page that is on, for a live bot', async () => {
      pages.findOne.mockResolvedValue(page);
      expect(await service.findAvailable('sunrise-mind')).toMatchObject({
        page,
        chatbot: bot,
      });
    });

    it.each([
      ['the page is off', { ...page, status: BotPageStatus.OFF }, {}, {}],
      ['the bot is a draft', page, { status: ChatbotStatus.DRAFT }, {}],
      ['the bot is paused', page, { status: ChatbotStatus.PAUSED }, {}],
      ['the platform is off', page, {}, { enabled: false }],
      [
        'it is public while public links are blocked',
        { ...page, access: BotPageAccess.PUBLIC },
        {},
        {},
      ],
    ])(
      'returns nothing when %s',
      async (_label, stored, botPatch, settingsPatch) => {
        pages.findOne.mockResolvedValue(stored);
        globalSettings = { ...globalSettings, ...settingsPatch };
        service = new BotPageService(
          pages as never,
          {
            findOne: jest
              .fn()
              .mockResolvedValue({ ...(bot as object), ...botPatch }),
          } as never,
          { getForChatbot: jest.fn(async () => globalSettings) } as never,
          {} as never,
          { botPage: { baseUrl: 'http://x' }, s3: {} } as never,
        );
        expect(await service.findAvailable('sunrise-mind')).toBeNull();
      },
    );

    it('returns nothing for an archived bot or an unknown or malformed link', async () => {
      expect(await service.findAvailable('../etc')).toBeNull();
      expect(await service.findAvailable('nope')).toBeNull();
    });
  });
});
