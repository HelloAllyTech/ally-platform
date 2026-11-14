# Agent runtime parity report

Cases: 22 · must-match failures: 0 · translation differs: 1 · baseline failures: 0

p50 latency: v1 5879 ms · v2 5934 ms · delta +0.9% (budget +15%)

| Case | Kind | Status | Diffs | Intent v1 / v2 | Citation overlap (should match) | Answer similarity | ms v1 / v2 | Trace steps | v1 vs master baseline |
|---|---|---|---|---|---|---|---|---|---|
| in-what-is-ally | in_scope | match |  | answer / answer | 100% | 0.57 | 12153 / 6947 | 7 | match |
| in-get-access | in_scope | match |  | answer / answer | 100% | 0.32 | 7339 / 12631 | 7 | match |
| in-assist-consent | in_scope | match |  | answer / answer | 100% | 1.00 | 7955 / 6657 | 7 | match |
| in-audio-stored | in_scope | match |  | answer / answer | 100% | 0.12 | 7376 / 6821 | 7 | match |
| in-roleplay | in_scope | match |  | answer / answer | 100% | 0.23 | 6237 / 6213 | 7 | match |
| in-real-clients | in_scope | match |  | answer / answer | 100% | 0.46 | 7571 / 9017 | 7 | match |
| in-xp-levels | in_scope | match |  | answer / answer | 100% | 0.97 | 6416 / 7035 | 7 | match |
| in-report-problem | in_scope | match |  | answer / answer | 100% | 0.95 | 7292 / 6622 | 7 | match |
| out-weather | out_of_scope | match |  | decline / decline | n/a | 1.00 | 4941 / 1313 | 4 | match |
| out-recipe | out_of_scope | match |  | decline / decline | n/a | 1.00 | 1149 / 1260 | 4 | match |
| out-football | out_of_scope | match |  | decline / decline | n/a | 1.00 | 1127 / 1487 | 4 | match |
| out-tax | out_of_scope | match |  | decline / decline | n/a | 1.00 | 1829 / 1627 | 4 | match |
| lang-hindi | non_english | match |  | answer / answer | 50% | 0.22 | 13283 / 10036 | 7 | match |
| lang-marathi | non_english | translation_differs |  | answer / answer | 100% | 0.47 | 14147 / 8365 | 7 | match |
| lang-hinglish | non_english | match |  | answer / answer | 100% | 0.88 | 5521 / 5554 | 7 | match |
| amb-help-client | ambiguous | match |  | decline / decline | n/a | 1.00 | 1581 / 1505 | 4 | match |
| amb-it-doesnt-work | ambiguous | match |  | decline / decline | n/a | 1.00 | 1813 / 1856 | 4 | match |
| gen-in-scope | general | match |  | answer / answer | 100% | 0.73 | 5424 / 8312 | 7 | match |
| gen-out-of-scope | general | match |  | answer / answer | n/a | 0.19 | 7230 / 5654 | 7 | match |
| empty-selection | empty_selection | match |  | decline / decline | n/a | 1.00 | 1630 / 1135 | 4 | match |
| extra-other-tenant-doc | out_of_scope | match |  | decline / decline | n/a | 1.00 | 1804 / 1495 | 4 | match |
| extra-follow-up | in_scope | match |  | decline / decline | n/a | 1.00 | 3550 / 1750 | 4 | match |
