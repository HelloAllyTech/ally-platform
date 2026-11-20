# Part 0b: booking cases, before and after (18 Nov, local stack)

Cases: `ally-be/src/chatbot/basics/cases/prod-17nov-booking.json`, run with the basics runner
(`docker exec -w /app ally-be-app-1 node dist/chatbot/basics/run-basics.js --bot <id> --cases src/chatbot/basics/cases/prod-17nov-booking.json --only <ids> --concurrency 1`)
on The Bombay Canteen (Tables, Reservations) and Host (Slots, Appointments). Transcripts are beside this file.

| Finding | Before (`0b-before-*`) | After (`0b-after-*`) |
|---|---|---|
| F5 free means free (tables) | T2 listed as free right after Priya booked it | T2 left out: "T3 and T1 are free" |
| C19 on Appointments | Neha's 12:00 offered as free to the next person | 12:00 left out |
| F4 a taken table, in words | Already in words in this run ("already taken") | "T2 at 1:00 PM isn't free", with the nearest free ones |
| F3 the at-most-2 rule | In words, but sent as a decline (counts toward the hand-over) | In words, sent as an answer |
| F1 a pick isn't a yes | "T3 please" booked at once | "Shall I book Thursday 26 Nov 2026 at 14:00 for 3 people at table T3?", booked after "yes" |
| "Can I book …?" (Appointments) | Booked without asking | "Would you like me to book that slot for you?" |
| F2 automatic hand-over | Two declines in a row handed over with hand-over off | Three declines in a row, no hand-over; booked at turn 9 |
| C21 dates ("27/11", "25 Nov", "Tuesday") | Passed | Passed |
| C21 the reservation names its table | "Thu 26 Nov 2026, 14:00" | "Thu 26 Nov 2026, 14:00 · T3" (Postgres spec) |

Not Part 0b, seen in these runs:
- **Run cap hits:** 4 of 51 turns after (2 of 40 before) hit the 20 s run cap; Part 2's speed item. Since Part 0, those turns get the fixed run-failed reply, never v1.
- **Internal voice:** "I don't have any passage that says…" once; Part 2.
- **Leftover citation markers:** "(I see it here:." twice; Part 2.
