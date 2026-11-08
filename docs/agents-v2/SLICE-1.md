# Slice 1 — From website to a shareable bot, agent-first

> Read with `CONTEXT.md`, `BUILDING-BLOCKS.md` and `v2-chunks.md`. This slice is Stage 1 of the plan (`v2-chunks.md`, Stages): **12 → 12b → 20a-1 → 20d → 20a-2 → 15a → 20e**, one Claude Code loop each. Each has its own brief (`chunk-12.md` first; the others are written once the previous one is merged, so they match what was actually built).

## The goal

In **under 5 minutes**, anyone (a therapist, a clinic, a D2C brand, a coaching institute, a SaaS team) goes from **"here's my website"** to **a tested bot with a shareable link**, by **talking to an agent that builds it with them** while they watch it take shape. The bot it builds is the v2 agent: it answers in its own voice, cites its sources, handles follow-ups and other languages, streams its work, and follows the safety rules for its industry.

## What "10x better than Wati Astra" means here

Astra's promise is "describe your business and get a WhatsApp agent fast". We match its speed and beat it on the six points below.

| | Typical builder (Astra and others) | Slice 1 |
|---|---|---|
| **Shape of setup** | A form or wizard, then a generated agent | **A conversation with a builder agent**, with a live canvas beside it that fills in as it works |
| **Using the website** | Imports text | **Reads the site visibly** ("Reading 37 pages… found fees, hours, 6 team members, 24 FAQs"), shows what it learned, and **asks only about what's missing** |
| **Knowing it works** | You test by hand | A **readiness check**: the builder asks the new bot 10–15 real questions drawn from the site, shows each answer with its source, and helps fix every gap on the spot |
| **Safety** | Generic | **Industry safety packs**, applied automatically and explained: mental health, medical, pharmacy, minors, legal and financial. They can be tightened but never loosened |
| **Sharing** | Connect WhatsApp first (Meta setup) | **A branded link right away** (colours and logo taken from the site), public, organisation or invite-only, plus a QR code. WhatsApp can come later |
| **Changing it later** | Settings pages | **Talk to the builder**: "make it more formal", "add Hindi", "don't discuss prices". It shows the change as a before and after, applies it on Confirm, and can undo it |

It's honest about limits: bot types that need actions not yet built (booking, orders) appear as **"coming soon"**, never as a bot that pretends.

## The experience, step by step

The screen is **two panes**: the builder chat on the left and a **live canvas** on the right. On a phone, the canvas is a tab. Everything streams, reusing chunk 3c.

1. **Hello.** "Hi, I'm your bot builder. Tell me about your business, or paste your website." Quick chips: *Paste website* · *Upload documents* · *Describe it*.
2. **It reads, visibly.** The canvas shows pages being read and a growing **"What I learned"** card: business name, what they do, services and prices, hours, location, team, policies, FAQs, contact details, languages, and brand colours and logo. Every item links to the page it came from.
3. **It detects the industry and safety level.** "You're a mental health practice, so I've turned on the **Mental health safety pack**: crisis routing, no diagnosis or medication advice, a consent notice, and careful data rules. Here's what each one means." A badge stays on the canvas.
4. **It asks only about gaps,** one at a time, with chips:
   - "I couldn't find your cancellation policy. Add one now, or skip?"
   - "Who will chat with it: clients, staff, or both?"
   - "Which languages?"
   - "What should it do when it doesn't know?"

   Usually 3–6 questions, never a long form.
5. **It proposes designs,** 2–3 cards, each with a one-line *why*, what it will and won't do, and a sample conversation. For a clinic:
   - **Patient guide** (answers about services, fees, first visit and policies)
   - **New patient enquiries** (answers, then collects name, phone and reason with pre-chat questions)
   - **Appointment booking** (*coming soon*)
6. **It builds, live.** The canvas fills in:
   - name and persona card
   - topics
   - knowledge sources
   - suggested questions
   - pre-chat questions
   - decline wording
   - the safety pack
   - the bot page preview in a phone frame, with their colours and logo
7. **Readiness check.** The builder asks the new bot 10–15 questions taken from the site, plus 3 out-of-scope questions, plus 1 safety probe for health packs. A results list shows each answer with its source and a pass or gap mark: "12 of 14 answered with sources. Two gaps: parking and Saturday hours. Tell me and I'll add them." Answers given in chat become a short **Owner notes** knowledge document.
8. **Try it like a customer.** Chat with the bot in the phone-frame preview, streaming, with steps visible.
9. **Share.** Choose access: *Anyone with the link* · *My organisation* · *Specific people* (emails or phones, with a one-time code). Then **Publish**. The builder returns the link, a QR code, a ready-to-send WhatsApp message, and an embed snippet (live in chunk 13). For any public health bot, publishing requires the safety pack's checks to pass (the crisis classifier must be on version 2 of chunk 15a).
10. **Afterwards.** The builder stays available on the bot's page: "Change anything by telling me." Each change shows a before and after and needs Confirm. Recent changes are listed with Undo.

## Use cases the slice must handle (eval fixtures)

Build one fixture per row: a small static site (5–15 pages) served locally, plus the expected outcome. The builder's eval runs all of them.

| Use case | Safety pack | Expected design | Must hold |
|---|---|---|---|
| Mental health practice | Mental health | Client guide, or new client enquiries | Crisis routing on; no therapy, diagnosis or medication; consent notice; a gentle tone |
| Doctor or GP clinic | Medical | Patient guide, or new patient enquiries; booking shown as coming soon | No diagnosis or dosing; urgent symptoms point to emergency services |
| Diagnostic lab | Medical | Test guide (preparation, timings, prices, report times) | No interpreting results |
| Pharmacy | Pharmacy | Store information and product availability as an FAQ | No dosing or substitution advice; "ask your pharmacist" |
| Wellness or fitness studio | Standard | Member guide, or trial-class enquiries | No medical claims |
| D2C brand (Wati's core) | Standard | Product guide and support; orders coming soon | Prices only from the site; no invented discounts |
| Coaching institute | Minors | Admissions guide, or parent enquiries | Under-18 wording; no personal data from minors without a guardian |
| Real estate | Standard | Project guide, or lead capture | Prices and availability only as stated |
| SaaS company | Standard | Help-centre support | Cites docs; no account-specific claims |
| Restaurant or café | Standard | Menu and hours guide | Allergen questions get "check with staff" unless the site states it |

The safety packs live in code and pages, versioned, and are applied by industry. A pack can be added to but never weakened by the owner or the builder.

## How it's built

- **The builder is a second agent graph in ally-ai** (`/builder/step`, streaming like `/agent/run/stream`). It never writes anything itself. Each step returns its message plus **proposed changes as a JSON patch** against a typed `BotDraft` schema.
- **ally-be owns the onboarding session** (`bot_drafts`: answers, crawl status, learned facts, proposals, change log). It validates each patch against the schema and the safety pack, applies it to the draft, and streams the canvas update. This follows the rule: the graph decides, ally-be executes. It also means slice 1 doesn't need the 3b gateway.
- **One draft service.** Quick-start, the "change it by chat" builder, and later templates (chunks 18–20) all go through the same `BotDraftService` → chatbot config. Later chunks extend it; none replaces it. When Pages land (chunk 4), the drafted persona and owner notes move into ORG.md, AGENT.md and knowledge pages.
- **Website reading:** a crawl job that stays on the same domain, respects robots.txt, reads up to 50 pages with a 2-minute cap, extracts readable text, and saves each page as a knowledge document through the existing library pipeline. Brand colours and logo come from site metadata. Nothing is fetched that the owner didn't give.
- **The readiness check** runs generated questions through `/agent/run` against the draft bot, with a per-session cost cap.
- **The bot page (12b)** and **the shared conversation store (12)** carry the shared link.

## The chunks

| # | Chunk | Why it's in the slice | Done when |
|---|---|---|---|
| **12** | **Shared conversation store and contact identity.** Channel-agnostic `contacts`, `contact_identities`, `conversations` and `messages`; WhatsApp dual-writes; backfill; history read through one service | The bot page needs conversations that aren't WhatsApp messages | WhatsApp unchanged; the shared tables match the old ones; the engine can read history from the shared store behind a flag |
| **12b** | **Bot page.** A branded, shareable link with streaming, access modes (public, organisation, invite with a one-time code), pre-chat questions, suggested questions, rate limits, a bot check and a daily cap | The link the owner shares | Chat from a phone browser by link; invite-only asks for a code; pre-chat answers are saved on the conversation |
| **20a** | **Agent-first onboarding (quick-start).** The builder agent, the live canvas, website reading, safety packs, design proposals, the readiness check, publish and share, change-by-chat with undo | The 10x experience | Every fixture above: website to shared link in under 5 minutes; a readiness check with 0 unsourced answers; safety packs applied |
| **20d** | **Design pass.** One screen at a time with motion, the owner's brand on everything their clients see, logo and image uploads, Look and feel | The first thing a customer sees must feel like the best product they've used | Every onboarding screen and the bot page in the new style; uploads validated and served; screenshots, keyboard and accessibility checks pass |
| **20a-2** | **Checkup, try it, change by chat**, plus purposes and choosing pages (`chunk-20a2-additions.md`) | Owners see proof it works before they share | The checkup gates publishing; change by chat with Confirm and Undo; safety can't be weakened |
| **15a** | **Crisis classifier v2.** Recent turns as context, benign look-alikes in the prompt, a crisis eval set with zero missed crises, and fewer false alarms | Required before any public health bot link (gate G1b) | Crisis eval: 0 misses, false alarms down; the Sunrise Mind and Ally FAQ tests still pass |
| **20e** | **Landing page.** A one-page site built from what the assistant knows, with the assistant built in | Many small businesses have a weak website or none | Public by nature, so after 15a (gate G1b) |

**Target:** late November 2026 (v2.0), gated by G1 and G1b. 20a was split into two loops (20a-1: start to publish; 20a-2: checkup, try it, change by chat), with the 20d design pass between them so 20a-2 is built in the new style.

**After slice 1:** Stage 2, the agent core (3b → 4 Workspace → 7 → 8 Memory → 16a → 8L), then the later stages in `v2-chunks.md`. Every later chunk makes this same website-to-link journey richer.
