import {
  ScribeNoteHarnessService,
  toSpecFields,
} from '../scribe-note-harness.service';
import { LoggerService } from '../../../logger/logger.service';
import {
  CustomFieldDefinition,
  CustomFieldFillMode,
  CustomFieldType,
} from '../../../custom-fields/entity/custom-field-definition.entity';
import { PreferenceName } from '../../../common/constants/user.constants';

const def = (over: Partial<CustomFieldDefinition>): CustomFieldDefinition =>
  ({
    id: 'cf-1',
    name: 'Key concerns',
    fieldType: CustomFieldType.MULTILINE_TEXT,
    sectionKey: 'sessionSummary',
    fillMode: CustomFieldFillMode.AI,
    options: undefined,
    aiInstruction: undefined,
    ...over,
  }) as CustomFieldDefinition;

describe('ScribeNoteHarnessService', () => {
  const chatRepository = { findOne: jest.fn() };
  const draftRepository = {
    create: jest.fn((x) => x),
    save: jest.fn(),
  };
  const customFieldsService = { getAiDefinitions: jest.fn() };
  const preferenceService = { getPreference: jest.fn() };
  const dataSource = { query: jest.fn() };
  let service: ScribeNoteHarnessService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);
    service = new ScribeNoteHarnessService(
      chatRepository as any,
      draftRepository as any,
      customFieldsService as any,
      preferenceService as any,
      dataSource as any,
    );
  });

  describe('toSpecFields', () => {
    it('maps AI definitions to NoteSpec fields with ordered option ids', () => {
      const fields = toSpecFields([
        def({
          id: 'cf-ref',
          name: 'Referral source',
          fieldType: CustomFieldType.SINGLE_SELECT,
          aiInstruction: 'How they heard of us',
          options: [
            { id: 'o2', label: 'Walk-in', order: 2 },
            { id: 'o1', label: 'Phone', order: 1 },
          ],
        }),
      ]);
      expect(fields).toEqual([
        {
          id: 'cf-ref',
          label: 'Referral source',
          type: 'SINGLE_SELECT',
          section: 'sessionSummary',
          instruction: 'How they heard of us',
          options: [
            { id: 'o1', label: 'Phone' },
            { id: 'o2', label: 'Walk-in' },
          ],
        },
      ]);
    });

    it('never sends a session number field to the model', () => {
      const fields = toSpecFields([
        def({ id: 'a', name: 'Session No' }),
        def({ id: 'b', name: 'session number' }),
        def({ id: 'c', name: 'Session #' }),
        def({ id: 'd', name: 'Session summary' }),
      ]);
      expect(fields.map((f) => f.id)).toEqual(['d']);
    });
  });

  describe('buildRequest', () => {
    beforeEach(() => {
      chatRepository.findOne.mockResolvedValue({
        id: 5,
        tenantId: 'acme',
        createdAt: new Date('2026-11-18T10:00:00Z'),
      });
      customFieldsService.getAiDefinitions.mockResolvedValue([def({})]);
    });

    it('returns nothing when the org has the harness off', async () => {
      preferenceService.getPreference.mockResolvedValue(null);
      await expect(service.buildRequest(5)).resolves.toBeUndefined();
      expect(customFieldsService.getAiDefinitions).not.toHaveBeenCalled();
    });

    it('builds the request from the org AI fields when on', async () => {
      preferenceService.getPreference.mockResolvedValue({
        value: { enabled: true },
      });
      const request = await service.buildRequest(5);
      expect(preferenceService.getPreference).toHaveBeenCalledWith(
        PreferenceName.SCRIBE_NOTE_HARNESS_SHADOW_ENABLED,
        'acme',
        'ORGANIZATION',
      );
      expect(request).toEqual({
        shadow: true,
        note_spec: { fields: [expect.objectContaining({ id: 'cf-1' })] },
        context: { session_date: '2026-11-18' },
      });
    });

    it('looks up the tenant code when the chat carries the uuid', async () => {
      chatRepository.findOne.mockResolvedValue({
        id: 5,
        tenantId: '0b8e6a52-1c1d-4e8e-9a4f-1f2e3d4c5b6a',
      });
      dataSource.query.mockResolvedValue([{ code: 'acme' }]);
      preferenceService.getPreference.mockResolvedValue(null);
      await service.buildRequest(5);
      expect(preferenceService.getPreference.mock.calls[0][1]).toBe('acme');
    });

    it('never throws into the transcription publish', async () => {
      chatRepository.findOne.mockRejectedValue(new Error('db down'));
      await expect(service.buildRequest(5)).resolves.toBeUndefined();
    });
  });

  describe('recordDraft', () => {
    it('stores the report with its numbers derived', async () => {
      chatRepository.findOne.mockResolvedValue({ id: 5, tenantId: 'acme' });
      await service.recordDraft({
        chatId: 5,
        shadow: true,
        correlationId: 'c-1',
        report: {
          mode: 'SCRIBE',
          path: 'single',
          segments: 1,
          llm_calls: 2,
          repaired: true,
          duration_ms: 900,
          budget: {
            transcript_minutes: 12.5,
            transcript_words: 1800,
            narrative_words: 350,
          },
          validation: { reordered: false },
          draft: {
            narrative: [
              {
                t: '00:00:10',
                text: 'Client called about sleep.',
                turn_ids: [1],
              },
              { t: '00:01:00', text: 'Agreed a plan.', turn_ids: [4] },
            ],
            fields: { 'cf-1': { value: 'Sleep', evidence_turn_ids: [1] } },
          },
        },
      });
      expect(draftRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 5,
          tenantId: 'acme',
          shadow: true,
          mode: 'SCRIBE',
          llmCalls: 2,
          repaired: true,
          transcriptMinutes: 12.5,
          narrativeWordsTarget: 350,
          narrativeWords: 7,
          narrativePoints: 2,
          fieldsFilled: 1,
          correlationId: 'c-1',
        }),
      );
    });

    it('stores a failed run with its error and no draft', async () => {
      chatRepository.findOne.mockResolvedValue({ id: 5, tenantId: 'acme' });
      await service.recordDraft({
        chatId: 5,
        report: { mode: 'SCRIBE', error: 'timeout' },
      });
      expect(draftRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'timeout',
          draft: null,
          narrativeWords: null,
          fieldsFilled: null,
        }),
      );
    });

    it('ignores a draft for an unknown chat', async () => {
      chatRepository.findOne.mockResolvedValue(null);
      await service.recordDraft({ chatId: 9, report: {} });
      expect(draftRepository.save).not.toHaveBeenCalled();
    });
  });
});
