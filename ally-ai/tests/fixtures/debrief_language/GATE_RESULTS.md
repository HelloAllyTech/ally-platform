# Debrief language judge: gate results

Run 2026-11-19, rubric v2 plus the code checks (mixed-script words, verbatim-quote exemption), 15 synthetic debriefs written by the real Writer (3 per language), 3 runs per case for the configured judge, 1 for the reference judge. Reproduce: `PYTHONPATH=. python scripts/debrief_language_perturbations.py --models gpt-5-mini,gpt-5:1` from `ally-ai`.

History: the first rubric (v1) failed the gate (wrong_language 0.60, false-flag 0.22, flip 0.29): it typed whole English sentences as untranslated_chunk, flagged natural code-mixing, and missed a stray Devanagari letter in an English word. v2 sharpened the decision rules; script_mix and the verbatim-quote exemption moved into code.

```
judge model (configured): gpt-5-mini [openai]; Writer: gemini-3-flash-preview [gemini]; different family from the Writer: True

=== judge gpt-5-mini (openai) ===
calls 378, tokens in/out 738435/1133066, no usable answer 0
catch rate by fault type (type match AND the judge's quote on the planted words), pooled over languages:
  wrong_language       15/15 = 1.00 [0.80-1.00]
  script_mix           15/15 = 1.00 [0.80-1.00]
  untranslated_chunk   11/12 = 0.92 [0.65-0.99]
  quote_altered        15/15 = 1.00 [0.80-1.00]
  (exact type only: wrong_language 15/15 = 1.00 [0.80-1.00], untranslated_chunk 8/12 = 0.67 [0.39-0.86])
catch rate by language (gated types pooled):
  en-IN    9/9 = 1.00 [0.70-1.00]
  hi-IN    11/12 = 0.92 [0.65-0.99]
  mr-IN    12/12 = 1.00 [0.76-1.00]
  ta-IN    12/12 = 1.00 [0.76-1.00]
  kn-IN    12/12 = 1.00 [0.76-1.00]
cells (language x type; thin, shown with intervals, not gated):
  en-IN: wrong_language=3/3  script_mix=3/3  quote_altered=3/3
  hi-IN: wrong_language=3/3  script_mix=3/3  untranslated_chunk=2/3  quote_altered=3/3
  mr-IN: wrong_language=3/3  script_mix=3/3  untranslated_chunk=3/3  quote_altered=3/3
  ta-IN: wrong_language=3/3  script_mix=3/3  untranslated_chunk=3/3  quote_altered=3/3
  kn-IN: wrong_language=3/3  script_mix=3/3  untranslated_chunk=3/3  quote_altered=3/3
false-flag rate on look-alike non-faults: 2/54 = 0.04 [0.01-0.13]
    latin_name     1/15 = 0.07 [0.01-0.30]
    loanword       0/15 = 0.00 [0.00-0.20]
    english_quote  0/12 = 0.00 [0.00-0.24]
    code_mix       1/12 = 0.08 [0.01-0.35]
flip rate (cases whose 3 answers disagree): 10/111 = 0.09 [0.05-0.16]
clean good debriefs with any finding (could be a real Writer fault, informational): 13/15 = 0.87 [0.62-0.96]
findings on the clean debriefs by type (judge runs; real Writer faults or false flags, informational): {'grammar_or_agreement': 14, 'meaning_drift': 7, 'quote_altered': 2, 'wrong_language': 35, 'stiff_register': 4, 'script_mix': 3, 'untranslated_chunk': 1}
NOT GATED (no checked planting): stiff_register, literal_translation, grammar_or_agreement, meaning_drift; seen on clean debriefs (judge runs): {'grammar_or_agreement': 14, 'meaning_drift': 7, 'stiff_register': 4}

=== judge gpt-5 (openai) ===
calls 126, tokens in/out 246145/405883, no usable answer 0
catch rate by fault type (type match AND the judge's quote on the planted words), pooled over languages:
  wrong_language       15/15 = 1.00 [0.80-1.00]
  script_mix           15/15 = 1.00 [0.80-1.00]
  untranslated_chunk   11/12 = 0.92 [0.65-0.99]
  quote_altered        13/15 = 0.87 [0.62-0.96]
  (exact type only: wrong_language 15/15 = 1.00 [0.80-1.00], untranslated_chunk 11/12 = 0.92 [0.65-0.99])
catch rate by language (gated types pooled):
  en-IN    9/9 = 1.00 [0.70-1.00]
  hi-IN    9/12 = 0.75 [0.47-0.91]
  mr-IN    12/12 = 1.00 [0.76-1.00]
  ta-IN    12/12 = 1.00 [0.76-1.00]
  kn-IN    12/12 = 1.00 [0.76-1.00]
cells (language x type; thin, shown with intervals, not gated):
  en-IN: wrong_language=3/3  script_mix=3/3  quote_altered=3/3
  hi-IN: wrong_language=3/3  script_mix=3/3  untranslated_chunk=2/3  quote_altered=1/3
  mr-IN: wrong_language=3/3  script_mix=3/3  untranslated_chunk=3/3  quote_altered=3/3
  ta-IN: wrong_language=3/3  script_mix=3/3  untranslated_chunk=3/3  quote_altered=3/3
  kn-IN: wrong_language=3/3  script_mix=3/3  untranslated_chunk=3/3  quote_altered=3/3
false-flag rate on look-alike non-faults: 2/54 = 0.04 [0.01-0.13]
    latin_name     0/15 = 0.00 [0.00-0.20]
    loanword       0/15 = 0.00 [0.00-0.20]
    english_quote  0/12 = 0.00 [0.00-0.24]
    code_mix       2/12 = 0.17 [0.05-0.45]
flip rate (cases whose 3 answers disagree): 0/111 = 0.00 [0.00-0.03]
clean good debriefs with any finding (could be a real Writer fault, informational): 13/15 = 0.87 [0.62-0.96]
findings on the clean debriefs by type (judge runs; real Writer faults or false flags, informational): {'grammar_or_agreement': 2, 'wrong_language': 12, 'script_mix': 1, 'literal_translation': 1, 'stiff_register': 1}
NOT GATED (no checked planting): stiff_register, literal_translation, grammar_or_agreement, meaning_drift; seen on clean debriefs (judge runs): {'grammar_or_agreement': 2, 'literal_translation': 1, 'stiff_register': 1}

=== gpt-5-mini vs gpt-5: kappa on 'flagged the planted span' = 0.928 over 111 cases
recall gpt-5-mini 56/57 = 0.98 [0.91-1.00] vs gpt-5 54/57 = 0.95 [0.86-0.98]; z = 1.02
cost gpt-5-mini: $2.4507 for 15 debriefs x 3 runs x 8 cases = about $0.00648 per judge call
cost gpt-5: $4.3665 for 15 debriefs x 1 runs x 8 cases = about $0.03465 per judge call
gpt-5-mini is not measurably worse than gpt-5 on recall

GATE (gpt-5-mini): PASS
```
