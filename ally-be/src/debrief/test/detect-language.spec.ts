import { detectLanguage } from '../util/detect-language';

describe('detectLanguage (FR-39, a session with no recorded language)', () => {
  it('reads Tamil, Kannada and English by script', () => {
    expect(
      detectLanguage(['உங்களுக்கு என்ன கவலை இருக்கிறது என்று சொல்லுங்கள்']),
    ).toEqual({
      language: 'ta',
      source: 'detected',
    });
    expect(detectLanguage(['ನಿಮಗೆ ಏನು ಚಿಂತೆ ಇದೆ ಎಂದು ಹೇಳಿ ದಯವಿಟ್ಟು'])).toEqual({
      language: 'kn',
      source: 'detected',
    });
    expect(
      detectLanguage(['What brings you in today? Tell me more about it.']),
    ).toEqual({
      language: 'en',
      source: 'detected',
    });
  });

  it('tells Marathi from Hindi by their common words', () => {
    expect(
      detectLanguage([
        'तुम्ही काय करत आहात? मला सांगा, मी ऐकत आहे आणि काळजी करू नका',
      ]).language,
    ).toBe('mr');
    expect(
      detectLanguage([
        'आप क्या कर रहे हैं? मुझे बताइए, मैं सुन रहा हूँ और चिंता मत करो',
      ]).language,
    ).toBe('hi');
  });

  it('flags a close or thin call as low confidence', () => {
    expect(detectLanguage(['ok']).source).toBe('detected_low_confidence');
    expect(detectLanguage(['नमस्ते, सब ठीक'])).toEqual({
      language: 'hi',
      source: 'detected_low_confidence',
    });
  });
});
