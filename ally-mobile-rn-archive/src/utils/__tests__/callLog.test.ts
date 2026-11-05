import {getLogSourceLabelConfig} from '../callLog';
import {ChatProvider} from '@/types/message';

describe('utils/callLog getLogSourceLabelConfig', () => {
  it('returns uploaded label for AUDIO_UPLOAD', () => {
    const cfg = getLogSourceLabelConfig(ChatProvider.AUDIO_UPLOAD);
    expect(cfg.label).toBe('calls.source.uploaded');
    expect(typeof cfg.color).toBe('string');
  });

  it('returns liveSession label for other providers', () => {
    const cfg = getLogSourceLabelConfig(ChatProvider.MICROPHONE);
    expect(cfg.label).toBe('calls.source.liveSession');
    expect(typeof cfg.color).toBe('string');
  });
});


