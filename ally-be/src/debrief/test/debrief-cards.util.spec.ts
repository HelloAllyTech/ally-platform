import {
  ADVISORY_CHECKS,
  checkWeight,
  DebriefCards,
  DebriefCheckCode,
  inLanguageScript,
  isTranscriptGap,
  normaliseForQuote,
  renderCards,
  replyCheckFailures,
  runDebriefChecks,
  speakerRuns,
  TranscriptTurn,
  withPointIds,
} from '../util/debrief-cards.util';

const transcript: TranscriptTurn[] = [
  { turn_index: 1, role: 'counselor', text: 'What brings you here today?' },
  {
    turn_index: 2,
    role: 'client',
    text: "I don't see the point of anything anymore.",
  },
  {
    turn_index: 3,
    role: 'counselor',
    text: 'That sounds really heavy. Can you tell me more?',
  },
  { turn_index: 4, role: 'client', text: 'Exams, mostly.' },
];

const good = (): DebriefCards => ({
  opening:
    'You stayed with a client who was struggling and kept the door open.',
  important_moment: {
    turn_index: 2,
    quote: "I don't see the point of anything anymore",
    handled_well: true,
    lead: 'You noticed an important moment and stayed with it.',
    body: 'When the client said this, you asked them to say more rather than moving on.',
  },
  what_worked: [
    {
      skill: 'open questions',
      turn_index: 1,
      quote: 'What brings you here today?',
      lead: 'Your opening question let the client lead.',
      body: 'It invited them to start wherever felt right.',
    },
  ],
  work_on_this: [
    {
      skill: 'exploring risk',
      turn_index: 3,
      quote: 'Can you tell me more?',
      lead: 'Ask about safety directly when hopelessness comes up.',
      why: 'Asking directly is how you learn whether someone is at risk.',
      try_saying:
        'Sometimes when people feel this way they think about ending their life. Has that crossed your mind?',
    },
  ],
  practise_next: { skill: 'exploring risk', reason: 'It came up today.' },
  skill_words: [{ skill: 'open questions', word: 'strength' }],
  reflective_question: 'What made it hard to ask about safety directly?',
  progress_note: null,
});

const safety = {
  risk_cues: [
    {
      turn_index: 2,
      quote: "I don't see the point",
      category: 'hopelessness',
      learner_response: 'explored',
    },
  ],
  learner_distress: [],
};

const run = (
  cards: DebriefCards,
  overrides: Partial<Parameters<typeof runDebriefChecks>[0]> = {},
) =>
  runDebriefChecks({
    cards,
    transcript,
    safety,
    language: 'en',
    shortForm: false,
    hasProgress: false,
    ...overrides,
  }).map((f) => f.code);

describe('debrief checks', () => {
  it('passes a well-formed debrief', () => {
    expect(run(good())).toEqual([]);
  });

  it('catches a quote that is not in the anchored turn, and a broken anchor', () => {
    const c = good();
    c.what_worked[0].quote = 'How are you feeling today?';
    c.work_on_this[0].turn_index = 99;
    expect(run(c)).toEqual(
      expect.arrayContaining([
        DebriefCheckCode.QUOTE_MISMATCH,
        DebriefCheckCode.BROKEN_ANCHOR,
      ]),
    );
  });

  it('lets a quote run across one speaker’s split turns, never into the other’s', () => {
    const split: TranscriptTurn[] = [
      { turn_index: 1, role: 'counselor', text: 'It sounds like work' },
      { turn_index: 2, role: 'counselor', text: 'is wearing you down.' },
      { turn_index: 3, role: 'client', text: 'It is.' },
    ];
    const c = good();
    c.important_moment = null;
    c.what_worked[0] = {
      ...c.what_worked[0],
      turn_index: 1,
      quote: 'work is wearing you down',
    };
    c.work_on_this[0] = {
      ...c.work_on_this[0],
      turn_index: 2,
      quote: 'wearing you down. It is.',
    };
    const codes = runDebriefChecks({
      cards: c,
      transcript: split,
      safety: { risk_cues: [], learner_distress: [] },
      language: 'en',
      shortForm: false,
      hasProgress: false,
    });
    expect(
      codes
        .filter((f) => f.code === DebriefCheckCode.QUOTE_MISMATCH)
        .map((f) => f.section),
    ).toEqual(['work_on_this[0]']);
  });

  it('never credits the counsellor with the client’s words', () => {
    const c = good();
    c.what_worked[0].turn_index = 4;
    c.what_worked[0].quote = 'Exams, mostly.';
    expect(run(c)).toContain(DebriefCheckCode.WRONG_SPEAKER);
  });

  it('C-4: records a debrief over 220 words without blocking it', () => {
    const c = good();
    c.opening = Array(230).fill('word').join(' ');
    const fails = runDebriefChecks({
      cards: c,
      transcript,
      safety,
      language: 'en',
      shortForm: false,
      hasProgress: false,
    });
    const total = fails.filter(
      (f) => f.code === DebriefCheckCode.TOTAL_TOO_LONG,
    );
    expect(total).toHaveLength(1);
    expect(ADVISORY_CHECKS.has(DebriefCheckCode.TOTAL_TOO_LONG)).toBe(true);
    expect(checkWeight(total)).toBe(0);
    // Short form: 120.
    const s = good();
    s.opening = Array(100).fill('word').join(' ');
    expect(run(s, { shortForm: true })).toContain(
      DebriefCheckCode.TOTAL_TOO_LONG,
    );
    expect(run(s)).not.toContain(DebriefCheckCode.TOTAL_TOO_LONG);
  });

  it('C-11: gives every card a point id that survives a rewrite, and refuses duplicates', () => {
    const c = withPointIds(good());
    const ids = [
      c.important_moment!.point_id,
      c.what_worked[0].point_id,
      c.work_on_this[0].point_id,
    ];
    expect(new Set(ids).size).toBe(3);
    const reworded = good();
    reworded.work_on_this[0].lead = 'Different words, same point.';
    expect(withPointIds(reworded).work_on_this[0].point_id).toBe(ids[2]);
    expect(run(c)).toEqual([]);
    c.what_worked[0].point_id = c.work_on_this[0].point_id;
    expect(run(c)).toContain(DebriefCheckCode.DUPLICATE_POINT);
  });

  it('C-12: refuses terms of art a lay counsellor was never taught', () => {
    const c = good();
    c.work_on_this[0].why = 'This is classic countertransference.';
    expect(run(c)).toContain(DebriefCheckCode.JARGON);
    expect(run(good())).not.toContain(DebriefCheckCode.JARGON);
  });

  it('C-13: never quotes from a gap in the transcript', () => {
    expect(isTranscriptGap('[inaudible]')).toBe(true);
    expect(isTranscriptGap('...')).toBe(true);
    expect(isTranscriptGap('Exams, mostly.')).toBe(false);
    const gapped = transcript.map((t) =>
      t.turn_index === 3 ? { ...t, text: '[inaudible]' } : t,
    );
    const c = good();
    c.work_on_this[0].quote = '[inaudible]';
    expect(run(c, { transcript: gapped })).toContain(
      DebriefCheckCode.QUOTE_FROM_GAP,
    );
  });

  it("lets an Ask Ally quote span one speaker's split turns, never the other's", () => {
    const split: TranscriptTurn[] = [
      { turn_index: 1, role: 'counselor', text: 'Tell me something' },
      {
        turn_index: 2,
        role: 'counselor',
        text: 'silly that happened recently.',
      },
      { turn_index: 3, role: 'client', text: 'I burnt a cake.' },
    ];
    const ok = 'You asked, "Tell me something silly that happened recently."';
    expect(replyCheckFailures(ok, speakerRuns(split))).toEqual([]);
    expect(
      replyCheckFailures(
        ok,
        split.map((t) => t.text),
      ),
    ).toContain(DebriefCheckCode.QUOTE_MISMATCH);
    const across = 'You said "silly that happened recently. I burnt a cake."';
    expect(replyCheckFailures(across, speakerRuns(split))).toContain(
      DebriefCheckCode.QUOTE_MISMATCH,
    );
  });

  it('refuses turn numbers the learner cannot see', () => {
    const c = good();
    c.what_worked[0].body = 'You asked this in turn 5, which helped.';
    expect(run(c)).toContain(DebriefCheckCode.TURN_NUMBER);
  });

  it('requires every risk cue to be covered, not only the most serious', () => {
    const twoCues = {
      risk_cues: [
        ...safety.risk_cues,
        {
          turn_index: 4,
          quote: 'Exams',
          category: 'hopelessness',
          learner_response: 'missed',
        },
      ],
      learner_distress: [],
    };
    expect(run(good(), { safety: twoCues })).toContain(
      DebriefCheckCode.RISK_CUE_UNCOVERED,
    );
    const c = good();
    c.important_moment!.others = [
      { turn_index: 4, quote: 'Exams, mostly.', note: 'You moved on.' },
    ];
    expect(run(c, { safety: twoCues })).toEqual([]);
    expect(renderCards(c)).toContain('Other moments like this:');
    c.important_moment!.others = [
      { turn_index: 3, quote: 'Can you tell me more?', note: 'x' },
    ];
    expect(run(c, { safety: twoCues })).toEqual(
      expect.arrayContaining([
        DebriefCheckCode.WRONG_SPEAKER,
        DebriefCheckCode.RISK_CUE_UNCOVERED,
      ]),
    );
  });

  it('requires the important moment whenever there is a risk cue', () => {
    const c = good();
    c.important_moment = null;
    expect(run(c)).toContain(DebriefCheckCode.RISK_CUE_UNCOVERED);
  });

  it('refuses scores, diagnoses, exclamations and unsupported progress claims', () => {
    const c = good();
    c.opening = 'You scored 7/10 today!';
    c.what_worked[0].body = 'You are anxious when silence falls.';
    c.reflective_question = 'You have improved since last time — what changed?';
    const codes = run(c);
    expect(codes).toEqual(
      expect.arrayContaining([
        DebriefCheckCode.SCORE_MENTIONED,
        DebriefCheckCode.EXCLAMATION,
        DebriefCheckCode.DIAGNOSES_TRAINEE,
        DebriefCheckCode.UNSUPPORTED_PROGRESS,
      ]),
    );
    expect(run(c, { hasProgress: true })).not.toContain(
      DebriefCheckCode.UNSUPPORTED_PROGRESS,
    );
  });

  it('enforces 1–3 work-on-this cards with a try-saying line, and length limits', () => {
    const c = good();
    c.work_on_this = [];
    expect(run(c)).toContain(DebriefCheckCode.STRUCTURE);
    const d = good();
    d.work_on_this[0].try_saying = '';
    d.work_on_this[0].lead = Array(30).fill('word').join(' ');
    expect(run(d)).toEqual(
      expect.arrayContaining([
        DebriefCheckCode.NO_TRY_SAYING,
        DebriefCheckCode.TOO_LONG,
      ]),
    );
  });

  it('a short-form debrief needs no strengths or question', () => {
    const c = good();
    c.what_worked = [];
    c.reflective_question = '';
    expect(run(c, { shortForm: true })).toEqual([]);
  });

  it('checks the debrief is in the session’s script, ignoring quotes', () => {
    expect(
      inLanguageScript('यह एक अच्छा सत्र था और आपने अच्छे प्रश्न पूछे', 'hi'),
    ).toBe(true);
    expect(
      inLanguageScript(
        'This was a good session and you asked good questions',
        'hi',
      ),
    ).toBe(false);
    expect(run(good(), { language: 'hi' })).toContain(
      DebriefCheckCode.WRONG_LANGUAGE,
    );
    expect(
      inLanguageScript('anything at all here in some unknown script', 'xx'),
    ).toBe(true);
  });

  it('treats whitespace and curly quotes as the same quote', () => {
    expect(normaliseForQuote('  I don’t  see  ')).toBe("i don't see");
  });

  it('renders cards with turn anchors the judge can check', () => {
    const text = renderCards(good());
    expect(text).toContain('(turn 2)');
    expect(text).toContain('Try saying:');
    expect(text).toContain('One question to think about:');
  });
});
