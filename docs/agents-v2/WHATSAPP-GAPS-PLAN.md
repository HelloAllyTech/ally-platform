# WhatsApp: the gaps against Wati and AiSensy, and the plan to close or beat them (23 Nov 2026)

> Read from the code on `fix/agents-v2-q4` (`ally-be/src/whatsapp`: the Meta provider, the inbound service, the entities, the controllers' routes, the settings type) and from `chunk-bt1.md`, `FIXES-22NOV.md` and `EVALS-ROUND8-22NOV.md`. Not every file in the module was read, and nothing was run. Competitor facts come from Wati's and AiSensy's own pages; platform rules from Meta's developer docs and press reports (sources at the end). Neither competitor was tested. Durations are estimates at the current pace. <!-- docs-path-lint: planned -->

## 1. In one paragraph

Today Ally on WhatsApp is a **reply engine**: it answers a person who writes first, in plain text, safely. Wati and AiSensy are **outbound and acquisition engines** with a bot attached: templates, broadcasts, segments, retargeting, ads that open WhatsApp, forms, catalogues, payments, and self-serve number connection. The gap is everything that starts a conversation or reaches someone after 24 hours. Ally has none of it yet. The plan closes the outbound gap in four weeks of work, skips commerce, and aims to beat them on what happens **after** the broadcast lands: the reply, consent, cost and safety.

## 2. What Ally has on WhatsApp today (from the code)

| Area | State |
|---|---|
| Connection | Meta Cloud API directly, no reseller in between. A number is connected by hand: phone number ID, business account ID, token, app secret; checked with Meta; stored encrypted. The code names an Embedded Signup source, but no sign-up flow exists in ally-web |
| Inbound | One webhook per number, signature checked, queued, deduplicated. Text is read. A tap on a button or list row is read as its title. **Images, voice notes, documents and locations get a fixed "can't read this" reply** |
| Sending | **Plain text only** (`sendText`). No template, button, list, image or document can be sent. A reply after 24 hours fails, with a clear reason logged |
| Presence | Read ticks and "typing…" while the answer is prepared (already built; my earlier note that it was missing was wrong) |
| Consent | STOP and START handled in code; a first-contact disclaimer; opted-out people get silence |
| Limits | Per-sender rate limits; block and unblock; the spend cap |
| People | A contact per number with consent and opt-out dates, a count and a locale. **No name, tags, custom fields, segments or import** |
| Delivery | Status callbacks are read **only for cost** (billable messages). Delivered, read and failed are not stored per message |
| Team | Inbox with take over and hand back; a team reply is sent as text |
| Other | Retention sweep, erase, analytics of answers, quick replies by keyword, Graph API v25 |

## 3. The gaps

| # | Capability | Wati and AiSensy | Ally today | Decision |
|---|---|---|---|---|
| 1 | Template messages (reach someone after 24 hours) | Template manager, approval tracking | None | **Close** (Stage B) |
| 2 | Broadcasts to a segment, scheduled | Core product; AiSensy schedules up to 2 months ahead | None | **Close** (Stage C) |
| 3 | Contacts: import, tags, attributes, segments | Yes | None | **Close** (Stage B) |
| 4 | Campaign results: delivered, read, replied, clicked; retarget those who didn't read | Yes | None | **Close** (Stage C) |
| 5 | Buttons, list menus, images, documents out | Yes, plus carousels | Text only | **Close** (BT1 + Stage A) |
| 6 | Voice notes, images, documents in | Varies; Wati answers unsupported types politely | Fixed "can't read this" | **Exceed** (Stage A): transcribe voice notes in Indian languages |
| 7 | Self-serve number connection (Embedded Signup), keep using the WhatsApp Business app on the same number (coexistence) | Yes | By hand, by Ally | **Close** (Stage E; needs Meta Tech Provider status) |
| 8 | Ads that open WhatsApp, with the source of each lead | Both, with ads managers; Wati sends conversions back to Meta and Google | None | **Partly** (Stage D): capture the ad source on the first message; no ads manager |
| 9 | Links, QR codes, widget into WhatsApp | Yes | Bot page and bubble only | **Close** (Stage D, small) |
| 10 | Forms inside WhatsApp (WhatsApp Flows) | Both | None | **Later** (Stage F), for surveys and registrations |
| 11 | Drip sequences and reminders | Yes | None | **Close** (Stage B reminders; ROADMAP Phase 3 flows) |
| 12 | Catalogue, cart, abandoned-cart recovery, Shopify | Both | None | **Skip** (commerce is not the wedge) |
| 13 | Payments in chat | Both (AiSensy: WhatsApp Pay, UPI, cards) | None | **Later**: a payment link only |
| 14 | Instagram, Facebook, TikTok inboxes | Wati | None | **Skip** for now |
| 15 | WhatsApp calling, voice agents | Wati | None | **Later** |
| 16 | Blue tick help, onboarding support by phone | Both | None | Ops, not code |

Two platform risks found on the way, not competitor gaps:
- **Usernames.** Since 31 March 2026 Meta's webhooks carry a business-scoped user ID instead of a phone number for people who adopt usernames. Ally's contacts are keyed by phone number, and I found no handling of that ID in the provider. Check before any volume.
- **The general-purpose AI ban.** Since 15 January 2026 Meta forbids open-ended assistants on the Business API; business-specific bots for support, bookings and updates are allowed. Every Ally assistant must stay tied to one organisation's own information. The "Custom" purpose and general-answer mode should be reviewed against this before self-serve opens.

## 4. Where to exceed, not just match

Their broadcast tools stop at "sent, read, clicked". The reply goes to a flow or a person. Ally's advantage starts there.

| # | Exceed on | What it means | Measure |
|---|---|---|---|
| 1 | **Every broadcast is a conversation** | A reply to a campaign is answered by the assistant, which knows which message the person is replying to, can book, register or take details with consent, and hands over when needed | Share of replies resolved without a person; bookings or sign-ups per 100 delivered |
| 2 | **Consent you can show** | Opt-in recorded per person with when, how and for what; checked at send time; opt-out in any language the assistant reads, not only the word STOP | 0 sends to opted-out people; an export of the consent record |
| 3 | **Meta's price, no markup, known before sending** | As a Tech Provider each organisation pays Meta directly. Before a send: the count, the category, the cost in rupees, who will be skipped and why | Estimated against billed cost within 5% |
| 4 | **A number that stays healthy** | Sends paced to the portfolio's daily limit; an automatic pause when quality drops or failures spike; marketing sent only to people likely to receive it under Meta's per-user caps | No number flagged or restricted |
| 5 | **Voice notes and Indian languages** | Voice notes transcribed and answered; templates drafted in the audience's language with a native-review flag | Voice-note answer rate; languages covered |
| 6 | **Describe it, don't build it** | "Remind everyone booked tomorrow at 6 pm" or "tell volunteers the drive moved to Saturday" becomes a drafted template, an audience and a preview to approve | Minutes from idea to an approved send |
| 7 | **Safety on outbound** | Crisis always wins; health reminders say only time and place; no marketing to someone in an at-risk conversation; quiet hours by default | 0 breaches in every round |

## 5. The plan

| Stage | Name | What ships | About |
|---|---|---|---|
| **0** | **Your number, this week** (no code) | Verify the business with Meta; set the display name and profile; connect the number to an internal assistant; subscribe the app to message, template-status and account/quality webhooks; submit 5 templates now (appointment reminder, booking confirmed, callback follow-up, event update, opt-in confirmation), since approval takes days; note that a new portfolio starts at 250 business-initiated conversations a day and grows with quality; confirm rupee billing for the account before 31 Dec; run the WhatsApp checks from the roadmap's block 1.3 on it | 1 day |
| **A** | **Reply parity** | BT1 on WhatsApp (list messages, reply buttons, numbered-text fallback). A send interface for interactive, image and document messages. Voice notes transcribed (the monorepo already has Indian speech providers) and answered; images and documents accepted where a list field takes a file, declined politely otherwise. Delivered, read and failed stored per message. The business-scoped user ID handled | 3 days (BT1 separate) |
| **B** | **Outbound foundation** | Template manager: create, submit to Meta, track approval, variables, language versions. Contacts: name, tags, custom fields, CSV import, segments from lists and chats. Opt-in ledger. One send engine for every business-initiated message: 24-hour window check, template required outside it, opt-out and quiet hours at send time, idempotency key, pacing to the daily limit, retries only on transient failures. First uses: booking confirmation, reminder the day before, callback follow-up | 4 days |
| **C** | **Campaigns** | Broadcast to a segment, now or scheduled; the cost and skip preview; a test send to yourself; results per campaign (delivered, read, replied, clicked, opted out, failed with reasons); re-send to those who didn't read; tracked links; the quality guard and auto-pause. **Replies answered by the assistant with the campaign as context** | 4 days |
| **D** | **Acquisition, light** | Capture the ad or link source on a person's first message and show it on the contact and in reports; wa.me links and QR codes per assistant with a prefilled message; "Continue on WhatsApp" from the bot page and bubble | 2 days |
| **E** | **Self-serve connection** | Become a Tech Provider (business verification, app review). Embedded Signup in setup, including coexistence so an owner keeps the WhatsApp Business app on the same number. Each organisation adds its own payment method with Meta | 3 days of code; Meta's review time is outside our control |
| **F** | **Flows, forms and sequences** | The roadmap's flows (When / Only if / Then) on the send engine: reminders, drips, surveys, onboarding. WhatsApp Flows forms for surveys and registrations. Carousels. A payment link | with ROADMAP Phase 3 |

**Order against the roadmap:** Stage 0 now. Stage A right after Q4 light and BT1. Stages B and C replace "Outbound and the Scheduler" in Phase 3 and move ahead of the Phase 2 benchmark work in a second worktree, because every pilot will ask for reminders first. Stage E needs the Tech Provider application started now.

**Not building:** catalogue and cart, abandoned-cart recovery, Shopify and WooCommerce sync, an ads manager, Instagram and TikTok inboxes, WhatsApp calling.

## 6. Gates

| After | Must be true |
|---|---|
| A | A booking done by taps on WhatsApp in 3 taps or fewer; a Hindi voice note answered; delivery status visible in the Inbox |
| B | A reminder reaches a test contact the day before, outside 24 hours, once; nothing is sent to an opted-out contact or in quiet hours; a retry never sends twice |
| C | A 200-person test broadcast: cost estimate within 5% of billed; results match Meta's; replies answered in context; auto-pause triggers on a forced failure spike |
| E | A new owner connects their own number in setup without Ally's help |

## 7. Outside the code (Shehbaz)

- Start Meta business verification and the Tech Provider application now.
- Decide whose Meta app pilots' numbers sit on until Stage E.
- Template wording approved by you before submission; a native speaker for non-English versions.
- An opt-in policy: how each pilot's contacts agreed to be messaged, in writing, before any import.
- Read Meta's messaging and commerce policies for health and mental-health content before the first health campaign.

## Sources (read 23 Nov 2026)

- Wati: [platform overview](https://support.wati.io/en/articles/11375155-wati-overview-features-channels-and-integrations), [plans and features](https://www.wati.io/?p=50663), [marketing page](https://www.wati.io/lp/wati/)
- AiSensy: [features](https://m.aisensy.com/features/), [marketing platform](https://aisensy.com/best-ai-whatsapp-marketing-platform), [payments](https://aisensy.com/products/whatsapp-marketing)
- Meta: [pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), [messaging limits change](https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes/), [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/), [coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4-public-preview/), [becoming a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- Policy and rates: [TechCrunch on the general-purpose chatbot ban](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform), [respond.io on what's allowed](https://respond.io/blog/whatsapp-chatbot-policy-2026), [NewsBytes on India rates](https://www.newsbytesapp.com/news/science/whatsapp-business-messages-get-costlier-in-india-from-today/story), [MEF on usernames](https://mobileecosystemforum.com/2026/04/08/whatsapp-business-april-2026/), [Alibaba Cloud on portfolio limits](https://www.alibabacloud.com/help/en/chatapp/notice-on-changes-to-whatsapp-messaging-limits), [Freshworks on frequency caps](https://crmsupport.freshworks.com/support/solutions/articles/50000009847-everything-you-need-to-know-about-meta-s-frequency-capping-for-whatsapp-business)