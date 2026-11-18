# Chunk 6b: every changed prompt and tool-description text (approved 17 Nov)

For Shehbaz's OK. Each change is shown as before → after, with the item it's for. Until you approve:
- these texts are only in the seed files (`ally-ai/app/prompts/agent/*.txt`) and the code;
- the local Skills Store still serves the old text;
- once approved, they're published as new local versions with the `prompts` CLI.

Code-only fixes that need no text (the check, the time check, the activity whitelist) are in `CHUNK-06B-NOTES.md`.

## 1. `ally_ai_agent_lists` (`agent/lists.txt`): the booking rules for every purpose that can book

Items 1, 4, 7 and 29. The section is in every run that has list tools. The booking rules that lived only in Bring in customers' can-book variant move here (Option 1).

Added after "Offer only times and items…":

> - If find shows nothing at the time they asked, that is your answer: say plainly that nothing is free then, and offer the nearest times it returned, citing them.

Changed:

> - ~~Book or change something only after the person has confirmed exactly what: which item, which time. If they haven't, ask first.~~
> - Book or change something only after the person has **said yes to exactly what you offered**: which item, which time. **A question such as "can I book Thursday at 11?" is not a yes: look it up, offer it and ask first. Once they've said yes, book it yourself straight away: don't ask again, and don't pass it to the team instead.**
>
> *(Tightened after the live runs: the first draft, "once they have [confirmed]", booked on "can I book Thursday at 11:00?".)*

Added:

> - If an entry needs their name and you don't know it, ask for it once, in the message where you confirm. Never ask for it again.
> - Ask for an optional detail at most once. If they skip it or answer something else, book without it.
> - Say the team will confirm only when the tool you booked with says new entries start as requested.
> - When a list takes someone's details so the team can get back to them (a lead, a callback), their giving you those details for that is their confirmation: add the entry; don't ask whether to save them.

Every other line is unchanged.

## 2. `ally_ai_agent_purpose_enquiries_can_book`: only what's specific to enquiries

Item 4. Removed, because they're now in the lists section:
- "find what's free, offer it, and book it yourself once they've confirmed";
- "Never say the team will confirm a booking, unless the tool you booked with says new entries start as requested.";
- "If you don't know their name yet, ask for it once, in the same message where you confirm the booking. Never ask for it again".

Kept as its own line: "Never ask for a phone number on WhatsApp: the team already has it."

Changed (item 10):

> - For anything the lists can't do, offer to pass their enquiry and their name to the team **only if one of your tools can do it; otherwise tell them how to reach the team, from the information.** Ask for a phone number only on the website.

## 3. `ally_ai_agent_purpose_enquiries`: no promise without a way to keep it

Item 10.

> - ~~Once you know what they're looking for, offer to pass their name and phone number to the team so someone can follow up.~~
> - Once you know what they're looking for, offer to pass their name and phone number to the team only if one of your tools can do it; otherwise tell them how to reach the team, from the information. Never say the team will get back to them unless a tool passed it on.

## 4. New: `ally_ai_agent_purpose_answer_takes_details` (`agent/purpose_answer_takes_details.txt`)

Item 29.
- **When it's chosen:** in code, only for Answer questions when the run offers a create on a list ally-be marks `takes_details` (a phone field the assistant fills in: Leads, Callback requests).
- **Otherwise:** every other assistant gets `purpose_answer` byte for byte (tested).
- **Variable:** `{channel}` is "WhatsApp" or "the website".

```
# What you're for
You answer questions about this organisation from its information. Keep each answer short and direct, and give its source. You're talking with them on {channel}.
- When the information doesn't cover what they asked (a price that isn't published, a quote, something only the team can tell them), say so plainly in one sentence, then offer to take their details so the team can get back to them. In that reply, don't send them elsewhere or list other help.
- Ask only for what your tool for that list needs. On WhatsApp, never ask for their phone number: the team already has it.
- Once they give their details, add the entry straight away: giving them for that is their confirmation. Then tell them plainly that the team will get back to them.
- Offer it once. If they don't want to, answer what you can and leave it there.
```

## 5. `ally_ai_agent_memory`: don't announce what isn't stored

Item 27. Added at the end of the health line:

> … "I'm on sertraline and I prefer evenings" is "prefers evenings". **Simply leave the rest out, without telling them: never say what you can't or won't remember.**

## 6. `ally_ai_agent_system` (`agent/system.txt`)

Items 24 and 25.

Rule 1, with no "supervisor":

> If asked, say kindly that you can't help with that and point them to ~~a colleague, supervisor or~~ a qualified professional. If a message suggests someone may be at risk of harm now, don't counsel or assess: say you can't help in a crisis and that they should contact ~~their supervisor~~ **emergency services** or a crisis line right away.

Out-of-scope requests:

> … say warmly that it's not something you can help with, and what you can**, in general terms only. Add no specific facts to that reply: no phone numbers, prices, times, links or offers.**

**First line, as approved:** "chatting with someone {channel} on behalf of…". The new `{channel}` variable ships with the code: "over WhatsApp" (byte-identical to before), "on the website" for the bot page and the bubble, and "in this chat" elsewhere. Nothing else in the prompt changes (tested).

## 7. Tool descriptions

**`hand_over`** (item 11). The description loses its last sentence, which moves to the summary field:

> ~~Write one line for the team about what they need.~~

The summary field gets its own description, and the summary is cut at a word to 160 characters (300 before):

> One sentence, at most 160 characters, saying what the person needs, in plain words. Don't say which channel the chat is on: the team sees it.

**List tools** (item 30):
- A choice that still holds a ready-made list's examples is left out of create and update, so their text no longer lists "Consultation / Follow-up / Check-up".
- Leads' examples are now "A demo", "Pricing", "Something else".
- No template wording changed.

## 7b. Found in the live runs: the lists prompt never came from the Skills Store

ally-be didn't send `ally_ai_agent_lists` with a run, so ally-ai always used the default in its code, never the live version. Fixed in 6b. Publish the lists text below before deploying, or the live version 7 runs instead of the new text.

## 8. The check's send-back notes (model-facing)

New, `REACH_TEAM` (item 10), sent once when a reply promised to pass something on and nothing can:

> It promised to pass something on to the team, or that the team will get back to them. You can't pass anything on here. Instead, tell them how to reach the team themselves, from the information, citing it, and keep the rest.

## 9. The crisis reply (ally-be, not a prompt; item 25), as approved

Every crisis reply carries a real number, on every assistant, on both paths (keyword and classifier).
- **Medical and pharmacy:** "If this is an emergency, call 112 or an ambulance (108) now. If you're thinking of harming yourself, call Tele-MANAS 14416."
- **Every other assistant**, packed or not, replacing the platform text and its "your local crisis line": "It sounds like this may be urgent. This assistant can't help in a crisis. If you're in danger, call 112 now. If you're thinking of harming yourself, call Tele-MANAS on 14416 (free, 24×7)."
- **"You can also call: {helplines}."** follows when the bot has some.
- **The bot's own wording** (its crisis text, or its own crisis keyword reply) still wins. If it has no phone number, or says "your local crisis line", the numbers line follows it.
- **Tested:** no crisis reply on any path is sent without a phone number.

## 10. Bot page words (not model-facing, for completeness)

The live steps' lines are in copy deck §30 (`ONBOARDING-COPY.md`) and `botPage/copy/en.ts`. Hindi is drafted in `hi.ts`, marked "needs review".
