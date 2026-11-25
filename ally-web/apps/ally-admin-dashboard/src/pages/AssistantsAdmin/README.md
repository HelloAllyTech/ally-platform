# Assistants admin

Ally staff's one home for running the Assistants product (`/assistants-admin/<section>?view=<view>`).
It replaces six sidebar items (Models, Costs, Plans, Credits, Safety packs, Chatbot defaults) and the
staff support page. The old paths still work: `LEGACY_STAFF_PATHS` in `routes/RouteLayout.tsx`
redirects each to its place here.

## Who it is for, and the jobs

The person is Ally staff, rarely in a hurry except in an incident. They arrive with a job in mind
("give this builder more credits", "why did spend jump", "release a safety pack"), not a feature name.
So the tab is organised by job, and the first screen says what needs doing.

| Section            | The job                                   | Screens inside                                                                     |
| ------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Overview           | What needs me today? Where do I go for X? | Attention cards (live), month so far, a shortcut per common job                    |
| Builders & credits | Money builders hold                       | Accounts, grant or adjust, move a budget, starting-credits cutover                 |
| Pricing & costs    | What it costs Ally, and what we charge    | Costs, Model prices, WhatsApp rates, Plans & seats                                 |
| Safety             | How every chatbot handles risk            | Safety packs (draft, test, release, roll back)                                     |
| Defaults & library | What every chatbot starts from            | Starting settings, Quick replies, Knowledge library, Templates, Channels & numbers |
| Support            | Look inside a builder's chatbot           | Search, then open read-only (logged)                                               |
| Launch & data      | The jobs that run outside this screen     | Kill switches, Launch checklist, Data clean-up                                     |

Order follows a working day: look, then money, then safety, then content, then support, then the rare
launch jobs.

## Design rules

- **Two levels, no more.** Section tabs (Carbon-style underline tabs, `Tabs` from ui-shared) and, where
  a section has several screens, a Carbon `ContentSwitcher`. A one-line hint under the switcher says
  what the selected view is for.
- **Every section opens with a purpose line and the jobs you can do there**, so nobody has to guess.
- **Only what you can use.** Each section needs one grant (costs toggle, safety-pack curator grant,
  system access). A section you can't use is not shown; a direct link to one redirects to Overview.
  ally-be checks the same grants on every call.
- **Overview is live, not a menu.** Each attention card reads the same endpoints the sections use and
  opens the place to fix it.
- **Honest about gaps.** Kill switches, the cutover and the data jobs have no screen yet, so Launch &
  data says plainly that they run outside this screen and what to run. It changes nothing.
- **Reuse, don't rewrite.** Each existing staff screen is embedded unchanged except for an `embedded`
  prop that drops its own page title (the section header stands in). IBM Plex Serif and Carbon tokens
  come from the app theme.

## Adding to it

A new staff screen: add a panel to `panels/embedded.tsx`, a view to its section in `sections.tsx` and its
wording to `copy.ts`. A new section needs a grant in `accessFrom` and an entry in `buildSections`.
`LaunchPanels.tsx` mirrors `ally-be/docs/assistants-cutover-runbook.md`; keep the two in step.
