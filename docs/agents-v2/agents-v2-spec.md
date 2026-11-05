# Agents v2: Product and Experience Spec

Nov 5, 2026 · @Shehbaz

**v2 in one line:** an agent a business owner sets up in 10 minutes like Wati Astra, that remembers people and improves every week like Hermes, where every memory, action and lesson is visible and needs the owner's say-so.

v2 is built on what Stage 1 already runs (configurable chatbots, knowledge answers, WhatsApp, safety and Preview) and upgrades the engine to LangGraph. It covers onboarding, readable memory and profiles, history with "Why?", eight built-in abilities, a scheduler, a self-learning loop and an owner mode on WhatsApp, and it runs both on WhatsApp and as a chat widget on any website. Connectors, MCP, the skills store and forms are left for v3, and v2 is designed so each of them plugs in without rework.

## What we take from Wati Astra and Hermes

Wati Astra wins on how fast a non-technical owner gets a working bot; Hermes wins on how much the agent remembers and how it improves itself. v2 keeps both and fixes what users complain about in each ([earlier research](https://claude.ai/artifact/71FAL4cp6DYrYeVGctgHQr)).

| What users love | Where | How v2 delivers it | What v2 fixes |
| --- | --- | --- | --- |
| A working bot without a developer | Astra | Paste a website or a few lines; the agent drafts itself in about a minute | Astra's stacked fees and credits: no credits, a visible monthly cap |
| Training on what you already have | Astra | Import from a website, documents or a typed description; review what it learned | Imports land as drafts you check, not silent changes |
| Memory that follows the person | Hermes | A profile per contact the agent fills in, visible and editable | Hermes's wrong memories that persist: every line shows its source and can be forgotten |
| It improves from experience | Hermes | A nightly reflection turns gaps and corrections into lessons | Hermes grading itself and overwriting tuned skills: lessons need approval, and anything the owner locks is never touched |
| Search across past conversations | Hermes | Full history, searchable, with a summary per conversation | Hermes is single-user; v2 does this per business, per contact |
| Schedules in plain words | Hermes | "Follow up with her on Friday" becomes a scheduled job | Respects WhatsApp's 24-hour rule automatically |
| Small files, clearly layered | Hermes | Readable pages for the business, the agent, and each contact | Size limits and a "why it knows this" link on every fact |

## Scope: v2 versus v3

v2 makes one agent excellent with built-in abilities only; v3 opens it to the outside world. This moves forms out of v2, compared with the earlier plan.

| Area | v2 (this spec) | v3 |
| --- | --- | --- |
| Setup | 10-minute onboarding from a website, documents or a description; WhatsApp plus a chat widget for any website | One-click WhatsApp (Embedded Signup), more channels |
| Runtime | LangGraph agent with checkpoints and a tool loop | Same, with more tools plugged in |
| Memory | Business pages, contact profiles, agent notebook, full history, shared between WhatsApp and the website widget | Shared across channels |
| Tools | Built-in only: search knowledge, look up facts, remember, recall history, schedule, hand over, notify the team, save and read files | Connectors, MCP servers, any API |
| Scheduling | Follow-ups, reminders, routines, owner digests, message templates; flows such as collecting reviews, product updates and reminders, with rules | Flows started by connected systems (bookings, payments, orders) and flow steps that act in them |
| Learning | Nightly reflection, lessons inbox, approve on web or WhatsApp | Skills learned and shared as packages |
| Skills | Fixed built-in behaviours | Skills store and skill creator |
| Forms | Not in v2; the agent collects details conversationally into the profile | Form builder and WhatsApp Flows |
| Trust | Never list, approvals, handoff with tracked reply times, crisis protocol | Full commitment check across connector actions |

## The experience at a glance

[Diagram not included in this export: owner journey · 5 moments]

The first four moments happen once, in one sitting; the fifth becomes a two-minute evening habit, usually on WhatsApp. Each section below follows one of these moments, then the screens that support them.

## Onboarding: the first 10 minutes

The owner should be chatting with their own agent on their own phone within 10 minutes, without reading any help. Every step shows a working result before asking for more input.

1. **"What's your business?" (about 1 minute)**
   - One box: paste a website, upload up to 5 documents, or just type a few lines ("We're a physiotherapy clinic in Pune, open 9 to 7, home visits on weekends").
   - One question: "What should your agent mainly do?" with four choices: answer questions, capture enquiries, follow up with people, support existing customers. More than one can be picked.
2. **The agent drafts itself (about 1 minute, shown live)**
   - A progress list fills in as it works: "Reading your website… Found 14 pages… Writing about your business… Found prices for 6 services… Couldn't find opening hours."
   - Behind the scenes it writes the business page (ORG.md), the agent's instructions (AGENT.md), a facts table and 10–20 likely questions with answers.
3. **"Here's what I learned. Check it." (about 3 minutes)**
   - A review screen in plain sections: About you, Prices and services, Hours and locations, Common questions. Each item has Keep, Edit or Remove.
   - Gaps are shown first, highlighted: "I couldn't find your opening hours. Add them?" with an inline field.
   - Nothing goes live until the owner taps "Looks right"; this is the first lesson that the agent shows its work.
4. **Personality and boundaries (about 1 minute)**
   - Name, greeting and languages (English, Hindi, Hinglish by default for India), with a live preview of the greeting.
   - A short "What can your agent do?" list with three settings per row, **Do it**, **Ask me first** or **Never**: share prices, schedule follow-ups, remember details about people, hand over to a person, offer discounts. Sensible defaults are pre-set; offering discounts starts at Never.
5. **Try it (about 2 minutes)**
   - A chat on the left with suggested test questions drawn from the business, plus three tricky ones: "Can I get a discount?", a question it can't answer, and an emergency phrase.
   - Each reply has a "Why?" link and a "That's wrong" button. Correcting a reply updates the agent immediately and shows "Learned: …" so the owner sees learning work in minute 8.
6. **Put it on your phone (about 1 minute)**
   - A QR code opens a chat with the agent on the owner's phone straight away, through a shared sandbox number that Ally owns: the QR pre-fills a join code that routes that phone to this agent. The owner tries it on WhatsApp before connecting their own number. (Meta's test numbers only deliver to allow-listed phones, so a real sandbox number is needed.)
   - "Connect my WhatsApp number" is offered next, guided step by step; it can be done later. Beside it, "Add to my website" gives one line of code and a live preview of the chat bubble on the owner's own site (see Website chat widget).
7. **Go live in learning mode**
   - For the first 7 days the agent answers what it is sure about; anything it is unsure about goes to the owner as a draft to approve, while the customer is told the team will confirm. A short digest arrives each evening.
   - A checklist on Home shows what's left: connect your number, add your team, review this week's lessons.

**What we never ask during onboarding:** model choice, thresholds, prompts, API keys or anything technical. Those live in Settings with good defaults.

## The agent workspace

Eight sections, named for what owners do rather than how the system works. Every section has an everyday view, plus a deeper view ("View as file", "Technical trace") for admins who want it.

| Section | What it's for |
| --- | --- |
| Home | Needs you, this week's numbers, what the agent learned |
| Conversations | Every chat, searchable, with the person's profile beside it |
| People | Everyone the agent has talked to, with their profiles |
| Knowledge | About, Agent, Facts and Documents: everything the agent knows |
| Lessons | What the agent wants to learn, waiting for approval |
| Schedules | Everything set to happen later |
| Test | A playground, plus saved test questions that run before every change |
| Settings | Channels, team, abilities, memory fields, safety, model and spending cap |

[Diagram not included in this export: mock-up · Conversations with the profile panel]

The conversation screen is where owners spend most time, so it shows three things side by side: what was said, what the agent did (as action cards), and what it now remembers, with the source under every line.

## Memory you can read

Everything the agent knows is a page a person can read, edit, trace to its source and roll back. Under the hood each page is a small markdown file in the layered context; on screen it looks like a tidy document, with **View as file** one click away for people who want the raw text.

**Four kinds of memory**

| Memory | What it holds | On screen | Who changes it |
| --- | --- | --- | --- |
| About the business (ORG.md) | Who you are, what you offer, tone, policies | Knowledge › About | Owner and admins; lessons propose edits |
| How the agent behaves (AGENT.md) | Name, greeting, what it does and never does, how to hand over | Knowledge › Agent | Owner and editors; lessons propose edits |
| Facts | Prices, hours, locations, services, anything with an exact answer | Knowledge › Facts (a table) | Owner and editors; lessons propose rows |
| Contact profiles (USER.md per person) | Name, language, preferences, what they asked about, open items, a short relationship summary | People › a person, and the side panel in every conversation | The agent (allowed fields only), staff |

On top of these sits the **agent's notebook**, Hermes's idea in a business-safe form: short working notes the agent keeps about patterns ("Many people ask about parking; the answer is in Facts › Locations"). It is never shown to customers, is visible to the owner, is capped in size, and any note that should become a fact turns into a lesson.

**What a contact profile looks like**

```markdown
# Priya Sharma
- Language: Hinglish                         · said in chat, 2 Nov
- Prefers: evening slots after 6 pm          · said in chat, 2 Nov
- Interested in: knee physiotherapy package  · learned by agent, 2 Nov
- Open item: wants a call back about pricing · due 6 Nov, owner: Rahul

## Summary
First contacted on 2 Nov after an Instagram ad. Asked about knee physio
and home visits. Prefers Hindi replies. Waiting for a pricing call.
```

On screen the source after each line is a small chip; tapping it opens the exact message it came from.

**Rules that keep memory trustworthy**

- **Every line has a source:** said by the person, added by staff, imported, or learned by the agent, with a date and a link.
- **Every line can be edited or forgotten** in one tap; "Forget this person" clears the profile and history after a confirm, for privacy requests.
- **Allowed fields only.** Each agent has a list of what it may remember about people, which the owner configures (see below); anything not on the list is never stored, and sensitive kinds such as health or payment details are off by default.
- **Expiry.** Open items close when done; preferences can be set to expire, for example after 12 months without contact.
- **Small by design.** Profiles and pages have size limits so they stay readable and cheap to load; the agent summarises when one gets long, and the summary is shown as a change, not done silently.
- **History for every page.** Each change shows who or what made it (owner, staff, import, lesson) with a diff and a restore button.

### Configurable memory: fields and files

Each business decides what its agent remembers about people, including documents such as invoices, quotes and business cards. Settings › Memory holds two lists.

**Profile fields.** These start from defaults (name, language, preferred times, open items) and the owner adds their own, typed as text, number, date, choice, phone, email or file. Examples: company and designation, GST number, membership plan, renewal date. Each field sets who may fill it (the agent, staff or both), whether the agent may tell the person what is stored, and an optional expiry.

**File types.** These are the documents that can be kept on a profile, for example invoices, past invoices, quotes and business cards. Each type sets:

| Setting | Example for invoices |
| --- | --- |
| Formats | Image or PDF |
| Who can add | The person (sent on WhatsApp or the widget) and staff (upload) |
| What to read from it | Invoice number, date, amount, due date |
| Apply read values | Straight away, or as suggestions for staff to confirm |
| Who can see it | Owner and admins only |
| Keep for | A period the owner chooses |
| Direction | Received from the person, sent by the business, or both (a salon sends invoices; a clinic sends prescriptions) |

**How it works in a conversation**

- When someone sends a photo or PDF, the agent checks it against the allowed file types ("this looks like a business card"), saves it to their profile and reads it. A business card fills name, company, phone and email; an invoice fills number, date, amount and due date. Each value shows the file as its source.
- Files never sit in the agent's context. It sees the values read from them and a one-line summary, and opens a file only when needed, through the Files ability ("What was the amount on my March invoice?").
- Sending a file back ("Send me my last invoice") is set to Ask me first by default.
- A document of a type that isn't allowed is not stored; the agent says so and offers a person.
- Files appear under a Files tab on each profile with their read values; they are encrypted, visible only to the roles the owner picks, and removed by "Forget this person".
- Sensitive types (health records, ID proofs, bank statements) are off by default and show a warning when turned on; in healthcare deployments the platform's safety rules still apply.

**Documents the business sends**

Staff can also put a document on a person's profile and have the agent deliver it: a clinic sends a prescription after a visit, a salon sends the invoice after a service. The file type's Direction setting decides which types can go out.

- **From the dashboard:** on a profile's Files tab, Upload, then Send now or Send at a time, with an optional note ("Here is your prescription from today's visit").
- **From WhatsApp, as the owner or staff:** forward the PDF or photo to the agent and say "send this to Priya"; it shows who, which file and the message, then sends on Confirm.
- **As a routine:** "Send the invoice after every completed appointment" attaches the latest invoice of that type when the visit is marked done.
- **Outside WhatsApp's 24-hour window** the file goes in an approved template with a document attached, which the template manager prepares.
- **Delivery is tracked:** sent, delivered and read appear on the file, and a failed send lands in Needs you.
- **Asked again later** ("Send me my prescription again"), the agent re-sends the latest file of that type, following its Do it or Ask me first setting.

For clinical documents such as prescriptions, the agent only delivers and re-sends them. It never reads them out, explains them or answers questions about the medicines; those questions go to the clinician as a handover, and these file types are visible only to the roles the clinic chooses.

## History and "why did it say that?"

Every conversation is kept, searchable and explainable in plain words; the technical trace exists for engineers, but owners never need it.

**Conversations**

- A list with filters people actually use: needs you, handed over, unanswered, used a tool, scheduled something, this week.
- Search across every conversation by words or meaning ("people who asked about home visits"), like Hermes's session search but per business.
- Each conversation opens with a two-line AI summary at the top, then the full thread, with the person's profile beside it.
- The agent can search history itself through its "recall" tool, so "same as last time" works.

**"Why?" on every reply.** One tap opens a plain-language card:

```text
Why the agent said this
• Price from Facts › Services: "Knee physio package — ₹4,500 for 6 sessions"
• Language from Priya's profile: prefers Hinglish
• Followed Agent › Rules: "Offer a call back when someone asks about packages"
• Scheduled a follow-up for Fri 6 Nov, 6:30 pm (allowed: Do it)
Not used: discounts (set to Never)
```

From the card the owner can fix the source directly (edit the fact, change the rule) or tap "That's wrong", which creates a lesson. Admins also get a "Technical trace" link to the full LangGraph run.

**Unanswered and handed-over chats** are grouped into topics ("insurance questions: 4 this week") so the owner sees patterns, not a pile of messages. These groups are the main input to the learning loop.

## How the agent uses tools

In v2 the agent has eight built-in abilities; owners see them as plain verbs with three settings (**Do it**, **Ask me first**, **Never**), never as tools, schemas or APIs.

| Ability | What it does | Default | What the customer sees |
| --- | --- | --- | --- |
| Search knowledge | Searches the business's documents and answers with sources | Do it | A normal answer |
| Look up facts | Reads an exact price, time or location from Facts | Do it | A normal answer, always the same |
| Remember | Saves an allowed detail to the person's profile | Do it | Nothing; it simply remembers next time |
| Recall | Searches this person's past conversations | Do it | "Last time you asked about…" |
| Schedule | Sets a follow-up, reminder or check-in | Ask me first | "Shall I remind you on Friday at 10?" |
| Hand over | Passes the chat to a person with a summary | Do it | "I've passed this to Rahul; he usually replies within 2 hours." |
| Notify the team | Sends a message to the owner or team | Do it | Nothing |
| Files | Saves a document the person sends (invoice, business card) to their profile, reads it into fields, finds it again, shares it back, or delivers one that staff attached (a prescription, an invoice) | Do it to save and read; Ask me first to share | "Saved your invoice: ₹12,400, due 20 Nov." |

**How it behaves**

- **Plan, act, confirm.** For anything that changes something (schedule, hand over), the agent says what it will do, does it, and confirms what it did.
- **Two kinds of "ask first".** Asking the *customer* ("Shall I remind you?") happens in the chat. Asking the *owner* happens through a WhatsApp message with Approve and Change buttons; the customer is told "Let me check with the team" and the conversation pauses.
- **Honest failure.** If an ability fails, the agent never pretends it worked: it tells the person, offers a person instead, and alerts the team.
- **Limits.** At most 4 ability steps per reply; then it hands over rather than looping.

**What the owner sees.** Every action appears inline in the conversation as a small card ("Scheduled a follow-up · Fri 6 Nov, 10:00 · Cancel"), and in each person's profile under Open items. Settings › Abilities lists each ability, its setting, and how often it was used this week.

## Scheduler

Anything that should happen later can be set up in plain words, by the owner, by staff or by the agent itself, and every scheduled item is visible in one place.

**Four kinds of schedule**

| Kind | Example | Who usually sets it |
| --- | --- | --- |
| Follow-up | "Check in with Priya on Friday if she hasn't replied" | The agent, during a conversation |
| Reminder | "Remind me the day before my session" | The customer, through the agent |
| Routine | "Every Monday at 9, send me last week's summary" | The owner |
| Announcement | "On Friday at 10, tell everyone who asked about the workshop that seats are open" | The owner; only people who have opted in |

**Three ways to create one**

- **In the customer's chat:** the agent offers ("Shall I remind you?") and schedules it after a yes.
- **On WhatsApp as the owner:** "Remind everyone who asked about the workshop on Friday at 9" → the agent replies with a preview: who (12 people), when, the exact message, then Confirm or Change.
- **On the Schedules screen:** a calendar and list view with a New button.

**What the Schedules screen shows:** each item's when, who, message, why (a link to the conversation it came from), who set it, and its status: upcoming, sent, failed, cancelled. Failed items are pinned to the top with the reason in plain words.

**Rules handled for the user, not by them**

- **WhatsApp's 24-hour rule:** inside the window the agent sends a normal message; outside it, it uses an approved message template. If no approved template fits, the screen says so before the schedule is saved, and offers to submit one to Meta.
- **Quiet hours** (default 9 pm to 8 am in the business's time zone) push messages to the next morning.
- **Opt-outs** are checked at send time, so someone who said STOP after a reminder was set never gets it.
- **Runs once.** Every job has a key, so a restart or retry never sends twice.
- **Smart wake-ups:** a follow-up can wake the agent instead of sending fixed text, so it reads the latest conversation and decides what to say, or decides nothing is needed because the person already replied.

## Flows

The Scheduler sends one message at a time. A flow is a small process that keeps running in the background: ask for a review after every visit, tell interested customers about a new product, remind people before an appointment or a payment. The owner picks a ready-made flow, changes a few settings, tests it and switches it on. Nobody has to draw a diagram.

**What a flow is made of**

- **When it starts:** a date in a profile (appointment, renewal, last visit, birthday), something that happened in a conversation (booking confirmed, handover closed, an invoice or prescription sent), a tag being added, or a fixed schedule.
- **Who it is for:** rules on profile fields, tags and history, such as "visited in the last 7 days, not asked for a review in 90 days, no open complaint". People who opted out are always left out.
- **What it does:** send a message or template, wait, ask a question and branch on the answer, update a profile field or tag, send a file, notify the team, or hand over to a person.
- **When it stops:** the person replies, books, says STOP or reaches the last step. A flow never messages someone who is in a live chat with staff.

**Ready-made flows**

| Flow | What it does | What the owner sets |
| --- | --- | --- |
| Collect reviews | After a visit or completed booking, asks for a 1–5 rating. People who give 4 or 5 get the review link; people who give 1 to 3 are thanked, asked what went wrong, and shown to the owner in Needs you | Delay after the visit, review link, rating cut-off, how often one person can be asked |
| Product updates | Tells opted-in people in a segment about a new product, service, offer or price change, then answers their questions as the normal agent | Who gets it, the message, send time, monthly cap per person |
| Reminders | Reminds people before a date in their profile: appointment, payment due, renewal, refill, next service. Can ask Confirm or Reschedule and updates the profile | How far ahead, how many reminders, what to do if there is no reply |
| After a document | Follows up on something the business sent: a payment nudge after an invoice, a check-in a few days after a prescription | Which file type, delay, message |
| Win-back | Reaches people who have not been back in a set time | The gap, the offer, the cap |

Owners can copy any of these, change it, and save it as their own. Templates (from the earlier plan) can include flows, so a salon template arrives with review and win-back flows already set up and switched off.

**Three ways to build one**

- **Pick a ready-made flow** and answer three or four setup questions.
- **Describe it in plain words**, on WhatsApp or in the dashboard: "After every haircut, wait two hours and ask for a rating. Send happy people our Google link and tell me about unhappy ones." The agent turns it into a flow and replies with a preview: when it starts, who it is for (with today's count), each step with the exact wording, then Confirm or Change.
- **Use the rule builder:** a list of When, Only if, Then and Stop when blocks in plain words, edited with drop-downs. It is a step list, not a canvas. Advanced users can see the same flow as a file.

**Rules the owner sets on every flow**

- **Caps:** how often one person can get this flow, and a limit across all flows (for example, no more than two business-started messages a week).
- **When it may send:** send window, business days only, and quiet hours.
- **Approval:** Do it, or Ask me first for the first few sends or for any batch over a set size.
- **Priority:** if two flows want the same person on the same day, the higher one goes and the other waits.
- **Exit words:** extra words that stop the flow, on top of STOP.

**Before it goes live**

- **Test** with a sample contact in the playground or on the sandbox number. A dry run shows who would get what this week without sending anything.
- **Template check:** every step that might land outside the 24-hour window needs an approved template. Missing ones are flagged and offered for submission to Meta.
- **Safety:** each message goes through the same Never check as replies. For healthcare, reminders only say the time and place, never the reason for the visit, and review requests are off by default for roles such as therapy, where asking patients for testimonials can be inappropriate.

**Watching it run.** Each flow has a page with an on/off switch, the people in it now, and its numbers: sent, replied, finished, stopped, and the result it exists for (reviews collected, bookings made, reminders confirmed). A person's timeline in Conversations shows which flow sent each message and why. Problems such as a rejected template, a jump in opt-outs or very few replies appear in Needs you. The learning loop can suggest changes ("more people reply when the review request comes the next morning"), and the owner approves them like any other lesson.

**Under the hood.** A flow is a saved definition (trigger, rules, steps) that the scheduler runs. Each person in a flow is a run with its own state, and each step is a scheduled job with a key, so a restart never sends twice. A message step can be fixed text or a smart wake-up, where the agent writes the message after reading the conversation. In v2, flows start from what Ally already knows: profile dates, conversation events, tags and files. In v3, connectors add outside triggers (a booking in a calendar, a paid invoice, a shipped order) and outside steps, without changing how flows are built.

## Website chat widget

Any website gets the same agent as a floating chat bubble by pasting one line of code, in the style of Zoho's and AiSensy's website chat. It shares memory, history, abilities and learning with WhatsApp, so it is one agent on two channels, not two bots.

**Setup, under 2 minutes**

1. Settings › Channels › Website: pick colour, logo, bubble position, greeting and button text, with a live preview.
2. Copy one line and paste it before `</body>`: `<script src="https://…/widget.js" data-agent="…" async></script>`. Short guides show where to paste it on WordPress, Shopify, Wix and Webflow; no plugins are needed in v2.
3. List the domains it may run on; it loads nowhere else.
4. "Preview on my site": type your web address and see the bubble on your own page before turning it on.

**What visitors see**

- A small bubble that opens a chat panel (full screen on phones), with the AI disclosure in the first message.
- An optional proactive greeting, by rule: after some seconds, or on chosen pages ("Questions about pricing?"), at most once per visit.
- Quick-reply chips for the top questions.
- **Continue on WhatsApp:** a button that opens WhatsApp with a pre-filled message carrying a short code, so the conversation and profile carry over.
- When a person is needed and nobody is online, the agent asks how to reach them (WhatsApp number or email, conversationally; forms arrive in v3) and tracks the promise to reply.

**Same agent, same memory**

- Each visitor gets a profile tied to a first-party cookie; when they share a phone number or continue on WhatsApp, the two profiles merge, and the merge is shown in the profile's history.
- The agent knows the page the visitor is on (title and address are passed as context), so "how much is this?" works on a product page.
- Conversations carry a channel badge (WhatsApp or Website), with one history per person.

**Owner controls:** which pages show it, behaviour outside business hours, proactive greetings on or off, the privacy notice text, and an off switch. Insights can be split by channel, and widget conversations feed the same learning loop.

**Under the hood:** a `web` connector registered in the existing connector registry; messages over a WebSocket with a fallback; a small script that loads without slowing the page; rate limits and bot protection per domain. It needs the shared, channel-agnostic conversation store, which therefore moves from Stage 3 into v2.

## The self-learning loop

The agent gets better every week the way Hermes does, by reflecting on its own conversations, but every change is shown with its evidence and needs the owner's approval. That fixes Hermes's two biggest complaints: it grades its own failures as passes, and its learning overwrites things people tuned by hand.

[Diagram not included in this export: self-learning loop · 5 steps, owner approval in the middle]

**Signals that feed learning**

- Questions it couldn't answer, and replies it declined
- What staff wrote after a handover (the human's answer is the best teacher)
- "That's wrong" corrections in Test and on the "Why?" card
- The owner teaching on WhatsApp
- People repeating or rephrasing the same question, a sign the answer missed
- Contradictions ("your website says ₹500")
- Patterns in the agent's notebook

**Nightly reflection.** A scheduled job groups the day's signals by topic, drafts lessons, checks each against current memory, and runs an impact preview: it replays the last 30 days of related questions with the lesson applied ("changes 7 answers: 5 newly answered, 2 reworded").

**Six kinds of lesson:** a new fact, a fixed fact, a new answer, a behaviour change (an edit to the Agent page), a profile detail, and a notebook note.

**A lesson card** shows a one-line title, the evidence ("4 people asked about insurance this week" with links), the change as before and after, the impact preview, and four buttons: Approve, Edit, Reject, Not now. Up to three lessons a day also appear in the WhatsApp digest, approvable with a single reply.

**Who decides.** Each kind of lesson has a setting: Ask me (the default), Apply on its own, or Off. Only profile details and notebook notes apply on their own by default, and both are always visible and undoable. Owners can lock any page or line; locked text is never proposed for change, and nothing the owner wrote is replaced without an approved lesson.

**Judged by outcomes, not by itself.** After a lesson applies, the agent watches its topic: if handovers, rephrasings or "That's wrong" taps on that topic go up instead of down, the lesson is flagged for undo. A weekly report tells the owner what was learned and what changed ("6 lessons, answered rate 78% → 86%").

## The owner on WhatsApp

Owners live in WhatsApp, so the agent recognises their number and switches to a manager mode: the same agent, a different role file, and more abilities.

| The owner says | The agent does |
| --- | --- |
| "We're closed this Monday" | Adds a dated closure rule, replies "Got it: closed Mon 9 Nov. I'll tell anyone who asks. Undo?" |
| "Physio package is now ₹4,800" | Shows the old and new value, updates Facts on Confirm |
| "How many people asked today?" | Answers from history: "17 chats, 3 handed over, 2 unanswered about insurance" |
| "What did Priya want?" | Reads her profile and last conversation summary |
| "Pause the bot" / "Resume" | Switches the agent off or on, with a confirmation |
| Replies 1, 2 or 3 to the digest | Approves, edits or rejects that day's lessons |

**The daily digest** arrives at a time the owner picks (default 9 pm) and fits on one phone screen: today's numbers, anything waiting on them, and up to three lessons to approve.

**Safety rules for manager mode:** the role comes from the sender's number, never from what the message claims ("I'm the owner" from another number does nothing); every change is confirmed in one line before it applies, logged in history and undoable; and safety settings can't be changed from WhatsApp.

## Trust and safety in the experience

Safety is built in and visible, but it never asks the owner to configure anything technical. Today's protections stay exactly as they are and v2 adds four.

**Kept from today:** crisis keywords and the AI crisis check, consent and STOP handling, rate limits, the access list, and the rule that a bot can only tighten safety.

**Added in v2**

- **The Never list is enforced in code.** Abilities set to Never can't run, and before sending, a reply is checked for the obvious promises the owner hasn't allowed (discounts, refunds, prices not in Facts). A failing reply becomes "Let me check that with the team" plus a handover. The full commitment check comes in v3, when connectors can take real actions.
- **Handover promises are tracked.** "Rahul will reply within 2 hours" creates an open item with a deadline; if it passes, the team is alerted and the customer gets an honest update.
- **Uncertain answers in learning mode** go to the owner as drafts for the first week, instead of out to customers.
- **The agent says it's an AI** in its first message to every new person, and whenever asked.

**What customers experience when the agent can't help:** a clear handover, a realistic reply time, and no loops. After two failed attempts at the same question the agent offers a person instead of trying again.

## Home and insights

Home answers one question when the owner opens it: "Is my agent doing well, and does anything need me?"

**Top: Needs you.** Handovers waiting, drafts to approve, lessons to review, failed schedules and overdue promises, each with the action button on the card.

**Middle: This week, in five numbers**

| Number | Meaning |
| --- | --- |
| Answered | Share of questions answered without a person |
| Handed over | Share passed to the team, with the top three reasons |
| Unanswered topics | Groups of questions it couldn't answer, each one tap from becoming a lesson |
| Promises kept | Share of handover and follow-up promises met on time |
| Cost | Spend this month against the cap the owner set |

**Bottom: What it learned.** "This week your agent learned 6 things" with the list, and the effect: "answered 78% → 86% since last week." Seeing the agent get better is what makes owners keep teaching it.

Costs are shown in rupees per month and per conversation, never in tokens or credits. When the cap is reached the agent hands every new chat to the team rather than going silent.

## Quality bars

World-class means measurable: these are the targets v2 ships against, checked on Ally's internal agents before anyone else gets v2. They are proposed targets, to be tuned once real numbers exist.

| Area | Target |
| --- | --- |
| Setup | Median time from sign-up to the first real answer on the owner's phone under 10 minutes; 9 in 10 owners finish onboarding without help |
| Answers | At least 80% of in-scope questions answered by the end of week 1; under 2% wrong in a weekly sampled review |
| Speed | WhatsApp reply in under 12 seconds for 9 in 10 messages (today 5–12 seconds) |
| Memory | Zero stored fields outside the allowed list; every remembered line traceable to a message |
| Learning | Owners spend under 2 minutes a day on lessons; the answered rate rises over the first 4 weeks |
| Explainability | Every reply has a "Why?" card; every change to memory has a source and an undo |
| Scheduling | Every job runs once, on time to the minute, and never breaks WhatsApp's rules |
| Safety | Crisis handling identical to today; no reply ever performs an ability set to Never |

## Build breakdown

v2 is thirteen epics; the engineering detail for the runtime, gateway, tables and rollout is in the [three-stage plan](https://claude.ai/artifact/71FAL4cp6DYrYeVGctgHQr). Sizes are rough: S is about a week of one engineer, M two to three weeks, L four or more.

| # | Epic | What the user gets | Repos | Needs | Size |
| --- | --- | --- | --- | --- | --- |
| 1 | LangGraph runtime and parity | Nothing visible yet; same answers on the new engine | ally-ai, ally-be | Stage 1 parity set | L |
| 2 | Business pages and Facts | About, Agent and Facts as readable, versioned pages | ally-be, ally-web, ally-ai | 1 | M |
| 3 | Contact profiles and agent notebook | Profiles with sources, edit and forget; configurable fields; files such as invoices and business cards, read into fields; the notebook | all three | 1, 2 | M |
| 4 | History search, summaries and "Why?" | Searchable conversations; a plain-language card on every reply | all three | 1 | M |
| 5 | Onboarding and self-drafting | Website or description in, a reviewed agent out, in 10 minutes | ally-ai, ally-be, ally-web | 2 | L |
| 6 | Sandbox number with join codes | Try the agent on WhatsApp before connecting a number | ally-be | none | S |
| 7 | Built-in abilities and approvals | Eight abilities with Do it, Ask me first, Never; owner approvals on WhatsApp | ally-be, ally-ai, ally-web | 1 | L |
| 8 | Scheduler, flows and message templates | Follow-ups, reminders, routines, announcements; ready-made and plain-words flows with rules, test runs and flow pages; template submission to Meta | ally-be, ally-web | 7 | L |
| 9 | Trust additions | Never check before sending, tracked handover promises, learning-mode drafts | ally-ai, ally-be | 7 | M |
| 10 | Self-learning loop | Nightly reflection, lessons inbox, impact preview, apply and undo | all three | 2, 3, 4 | L |
| 11 | Owner manager mode and digest | Teach, ask, approve and pause from WhatsApp | ally-be, ally-ai | 7, 8, 10 | M |
| 12 | Home, insights and cost cap | Needs-you list, five weekly numbers, what it learned | ally-web, ally-be | 4 | S |
| 13 | Website chat widget and shared conversation store | A chat bubble on any website, sharing memory and history with WhatsApp; Continue on WhatsApp | ally-be, ally-web | 1, 3 | L |

**Order:** 1, then 2, 3, 4 and 6 in parallel, then 5, 7 and 13, then 8 and 9, then 10, then 11 and 12. This makes v2 larger than the 10-week Stage 2 in the earlier plan: onboarding, the learning loop, manager mode and insights are now in, and forms moved out. With the website widget and flows added, expect roughly 15–17 weeks with two to three engineers and a designer; this is an estimate to check with the team.

**What v2 leaves ready for v3**

- **Connectors and MCP:** abilities already run through ally-be's tool gateway with a registry, risk levels and Do it / Ask me first / Never, so a connector or MCP server is just another registered ability.
- **Skills store:** the `/skills/` layer is reserved in the context files, and lessons already handle versioned, reviewed changes, so installing or updating a skill uses the same review flow.
- **Forms:** profiles already have allowed fields and the scheduler already exists, so a form simply writes into a profile and can trigger a follow-up.
- **More tools:** the "Why?" card, history and approvals work for any new ability without changes.

## Sources

- [Open-Source Agent Workspace: Research & Product Design](https://claude.ai/artifact/71FAL4cp6DYrYeVGctgHQr) (the research on Wati Astra, Hermes and Botpress, and the three-stage plan)
- [Ally: AI Chatbots implementation and data flow](https://claude.ai/artifact/MSwmsu57XFYeNphiF6vHnD) (what Stage 1 already does)
- [Capterra: Astra by Wati](https://www.capterra.com/p/10039763/Astra/)
- [eesel: Hermes Agent review](https://www.eesel.ai/blog/hermes-agent-review)
- [Composio: OpenClaw vs Hermes Agent](https://composio.dev/content/openclaw-vs-hermes-agent)
- [AI Agent Store: 20 biggest problems with Hermes Agent](https://aiagentstore.ai/agentic-ai-and-workflow-automation/en/the-20-biggest-problems-with-hermes-agent-what-thousands-of-reddit-and-x-users-are-actually-struggling-with-ranked)
- [Fast.io: Hermes Agent scheduled automations](https://fast.io/resources/hermes-agent-scheduled-automations-cron/)
- [LangChain: Deep Agents backends](https://docs.langchain.com/oss/python/deepagents/backends)
