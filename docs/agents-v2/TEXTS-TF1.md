# TF1: new wording, for one approval

Every new line a person or an owner can see, from the TF1 fixes. In code each one is marked
`// COPY: needs approval`. Nothing here ships to customers until you approve it.

| Issue | Where | Text |
|---|---|---|
| S1 | Overview, the one switch, for an assistant that was never live | Finish setup and go live |
| S1 | Overview, when turning on is refused | Couldn't turn it on. {reason} |
| S1 | Overview, when turning on fails without a reason | Couldn't turn it on. Try again. |
| S2 | Go live, once live, when a starting budget was set aside | We set aside ${amount} of your free credits so it can answer people. Change this in Settings, under Budget. |
| S2 | Go live, once live, when nothing could be set aside | It can't answer anyone yet: no credits are set aside for it. Add some in Settings, under Budget. |
| S4 | Settings → Safety, under "When someone may be at risk" | Your helpline number ({numbers}) isn't in crisis replies yet. Check it's right, then confirm it. |
| S4 | the same, its button | Use it in crisis replies |
| S4 | the same, after confirming | Crisis replies now give {numbers} beside the national numbers. |
| S4 | the same, when it fails | Couldn't confirm it. Try again. |
| S4 | Helpline and Mental-health practice templates, the helpline question's hint (was "Every crisis reply gives this number beside the national ones.") | Crisis replies give this number beside the national ones once you confirm it in Settings, under Safety. |
| S7 | the end of every reply to a worry about a child's safety (India) | If a child is in danger right now, call 112. Childline: 1098, free, any time. |
| S7 | the same, in Hindi | अगर किसी बच्चे को अभी खतरा है, तो 112 पर कॉल करें। चाइल्डलाइन: 1098, मुफ़्त, किसी भी समय। |
| S7 | the same, outside India | If a child is in danger right now, call your local emergency number. |
| S7 | the same, outside India, in Hindi | अगर किसी बच्चे को अभी खतरा है, तो अपने यहाँ के आपातकालीन नंबर पर कॉल करें। |
| S6 | Create → Pick a template, below the use-case templates | More starting points |
| S5 | Inbox row, a person with more than one chat | {n} chats |
| S5 | Inbox chat, the person's other chats | Their other chats |
| S5 | Inbox, an older chat when they have a newer one | They've started a newer chat. Reply there so they see it. |
| S5 | the same, its link | Open their latest chat |
| S5 | Inbox badge for a chat the crisis check flagged (was "Needs a person · undefined") | Needs a person · May be at risk |
| F4 | Create → Sources, a file held for personal details (was a raw "needs_review") | Waiting for you: check it for personal details below |
| F19 | emergency reply, a rescue (flood, fire, trapped), India | This sounds like an emergency. Call 112 now and ask for rescue. Move to the safest, highest place you can and stay there until help reaches you. |
| F19 | emergency reply, someone collapsed or not breathing, India | This sounds like an emergency. Call 112 or 108 now for an ambulance, and stay with them. The person on the call will tell you what to do until help arrives. |
| F19 | the same two outside India | "…Call your local emergency number now and ask for rescue…" / "…Call your local emergency number now for an ambulance…" |
| F19 | the same in Hindi and Hinglish | in `ally-be/src/bot-draft/safety-pack/safety-packs.ts` (`KIND_FIRST`) |
| F19 | holding line after an emergency (was the self-harm help line), India | Someone from the team will reply to you. If anyone is in danger, call 112 now. |
| F19 | the same outside India, Hindi and Hinglish | in `ally-be/src/chatbot/safety/crisis-copy.ts` (`EMERGENCY_HOLDING_COPY`) |
