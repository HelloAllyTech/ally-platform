# Agent runtime parity report

Cases: 22 · must-match failures: 2 · translation differs: 1 · baseline failures: 1

p50 latency: v1 5812 ms · v2 5779 ms · delta -0.6% (budget +15%)

| Case | Kind | Status | Diffs | Intent v1 / v2 | Citation overlap | Answer similarity | ms v1 / v2 | Trace steps | v1 vs master baseline |
|---|---|---|---|---|---|---|---|---|---|
| in-what-is-ally | in_scope | match |  | answer / answer | 100% | 0.77 | 9764 / 8309 | 7 | match |
| in-get-access | in_scope | mismatch | cited_chunk_ids | answer / answer | 50% | 0.73 | 8848 / 8159 | 7 | mismatch (cited_chunk_ids) |
| in-assist-consent | in_scope | match |  | answer / answer | 100% | 0.95 | 5804 / 4801 | 7 | match |
| in-audio-stored | in_scope | match |  | answer / answer | 100% | 0.15 | 6596 / 6458 | 7 | match |
| in-roleplay | in_scope | match |  | answer / answer | 100% | 0.78 | 10665 / 7170 | 7 | match |
| in-real-clients | in_scope | match |  | answer / answer | 100% | 0.23 | 5820 / 7284 | 7 | match |
| in-xp-levels | in_scope | match |  | answer / answer | 100% | 0.79 | 13616 / 7049 | 7 | match |
| in-report-problem | in_scope | match |  | answer / answer | 100% | 0.94 | 6187 / 5860 | 7 | match |
| out-weather | out_of_scope | match |  | decline / decline | n/a | 1.00 | 1322 / 1168 | 4 | match |
| out-recipe | out_of_scope | match |  | decline / decline | n/a | 1.00 | 1131 / 1176 | 4 | match |
| out-football | out_of_scope | match |  | decline / decline | n/a | 1.00 | 1484 / 1803 | 4 | match |
| out-tax | out_of_scope | match |  | decline / decline | n/a | 1.00 | 4649 / 1072 | 4 | match |
| lang-hindi | non_english | mismatch | cited_chunk_ids | answer / answer | 50% | 0.68 | 8129 / 10438 | 7 | match |
| lang-marathi | non_english | match |  | answer / answer | 100% | 0.33 | 10784 / 8576 | 7 | translation_differs |
| lang-hinglish | non_english | translation_differs |  | answer / answer | 100% | 0.74 | 8871 / 6676 | 7 | translation_differs |
| amb-help-client | ambiguous | match |  | decline / decline | n/a | 1.00 | 1607 / 1233 | 4 | match |
| amb-it-doesnt-work | ambiguous | match |  | decline / decline | n/a | 1.00 | 1143 / 1091 | 4 | match |
| gen-in-scope | general | match |  | answer / answer | 100% | 0.78 | 5396 / 5699 | 7 | match |
| gen-out-of-scope | general | match |  | answer / answer | n/a | 0.15 | 6745 / 7491 | 7 | match |
| empty-selection | empty_selection | match |  | decline / decline | n/a | 1.00 | 1206 / 1147 | 4 | match |
| extra-other-tenant-doc | out_of_scope | match |  | decline / decline | n/a | 1.00 | 1416 / 1747 | 4 | match |
| extra-follow-up | in_scope | match |  | decline / decline | n/a | 1.00 | 1230 / 1167 | 4 | match |
