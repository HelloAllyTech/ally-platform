# Onboarding copy deck (chunk 20a)

Every string the owner sees during onboarding and editing. **Use this text exactly.** If a screen needs a string that isn't here, write it in the same voice and add it to this file in the same commit. Values in `{braces}` are filled in at run time.

## Voice

Think of a calm, capable product designer sitting next to the owner: specific, warm, never salesy. The bar is the onboarding of Notion, Linear, Clay or Stripe.

- **Specific beats impressive.** Write "Found 6 team members and 24 FAQs", not "We analysed your content with AI".
- **Short sentences, active verbs, sentence case.** No exclamation marks. No "magic", "AI-powered", "seamless", "unlock", "supercharge" or "leverage".
- **Say what happens next.** Every screen answers "what is this doing, and what do I do now?"
- **Owner-facing name: "assistant".** Never "bot", "agent", "model", "RAG", "embedding" or "LLM" in owner copy. Internally, it stays a bot.
- **Honest about limits.** Say plainly what it won't do yet. Never imply booking or payments work before they do.
- **Health topics are handled with care:** plain, respectful, never alarming. Say what protects people, not what could go wrong.
- **Numbers as digits**, units spelled out ("about 5 minutes"), Indian English spelling.

## 1. Start (`/new`)

- **Title:** Build an assistant that knows your business
- **Subtitle:** Share your website. We'll read it, ask a few questions, and have a tested assistant ready to share in about 5 minutes.
- **Input placeholder:** yourbusiness.com
- **Primary button:** Start with my website
- **Secondary options:**
  - Upload documents instead
  - Describe my business instead
- **Footnote:** We only read the pages you point us to. Nothing is published until you choose to.

## 2. The builder's opening message

> Hi, I'm here to set up your assistant with you. Paste your website and I'll start reading. You can watch what I find on the right.

**Chips:** Use my website · Upload documents · Describe it instead

**If they choose "Describe it":**

> Tell me what your business does, who you help, and what people usually ask you. A few sentences is plenty.

## 3. Reading the website (canvas: "Reading your website")

- **Status line:**
  - Reading {domain}…
  - Read {n} of up to 50 pages
- **Finished:** Read {n} pages in {seconds} seconds
- **Live findings (one line each, appearing as found):**
  - Found your services and prices
  - Found your opening hours
  - Found {n} team members
  - Found {n} questions people often ask
  - Found your address and contact details
  - Found your logo and brand colour
- **Builder message after a description instead of a website:** *(added in 20a-1)*
  > Here's what I took from your description. Take a quick look: if anything's wrong, tell me or edit it directly.
- **Builder message when done:**
  > I've read {n} pages. Here's what I learned, and each detail links to the page it came from. Take a quick look: if anything's wrong, tell me or edit it directly.

## 4. "What we learned" card

- **Title:** What we learned
- **Subtitle:** Every detail links to where we found it. Edit anything.
- **Section labels:** About · Services and prices · Hours · Team · Location and contact · Policies · Common questions · Brand
- **Empty section:** Not found on your website
- **Item actions:** Edit · Remove · View source
- **Confirm button:** Looks right

## 5. Industry and safety

- **Builder message, health (mental health):**
  > You work in mental health, so I've turned on **Mental health safety**. Your assistant will never diagnose, give medication advice or act as a crisis line. If someone may be at risk, it shares crisis contacts straight away and lets you know.
- **Builder message, health (medical, lab or pharmacy):**
  > You work in healthcare, so I've turned on **Medical safety**. Your assistant won't diagnose, interpret results or advise on doses. It points urgent symptoms to emergency care and everything clinical to your team.
- **Builder message, minors:**
  > Some of the people you help are under 18, so I've turned on **Care for young people**. Your assistant will speak to parents and guardians about personal details and keep its tone age-appropriate.
- **Builder message, legal and financial:** *(added in 20a-1)*
  > You give legal or financial advice, so I've turned on **Legal and financial care**. Your assistant will explain your services and process, but won't judge anyone's own case or tell them what to do with their money. It points those questions to your team.
- **Builder message, standard:**
  > Your assistant will only state facts it can find in your information, and will say so plainly when it doesn't know.
- **Safety card title:** {Pack name} is on
- **Safety card body:** These rules are always on for {industry}. You can add your own, but these can't be turned off.
- **Pack names** *(standard and legal added in 20a-1)*: Mental health safety · Medical safety (also for labs and pharmacies) · Care for young people · Legal and financial care · Facts only
- **{industry} in the card body** *(added in 20a-1)*: mental health practices · healthcare providers · services for young people · legal and financial services · every assistant
- **Link:** See what this covers
- **Expanded list headings:** Always · Never · If someone may be at risk

## 6. Filling the gaps

- **Builder message pattern:**
  > One thing I couldn't find: {missing item}. {Why it matters in one short clause.}
- **Examples:**
  - One thing I couldn't find: your cancellation policy. People often ask before they book.
  - I couldn't find your fees for couples sessions. Do you offer them?
- **Chips:** Add it now · Skip for now · We don't offer this
- **Audience question:** Who will mostly talk to your assistant?
  - **Chips:** Clients or customers · My team · Both
- **Language question:** Which languages should it reply in?
  - **Chips:** English · Hindi · Marathi · Tamil · Other
  - **Note:** It replies in the language each person writes in, from the ones you choose.
- **"Don't know" question:** When it doesn't know something, where should it point people?
  - **Chips:** Our phone number · Our email · Our front desk · Somewhere else
- **Progress note in the builder:** {n} quick questions left

## 7. Choosing a design

- **Builder message:**
  > Based on what I learned, here are a few ways your assistant could help. Pick one. You can change it later.
- **Card fields:**
  - title
  - **Best for:** {one line}
  - **It will:** {2–3 short items}
  - **It won't:** {1–2 short items}
  - a sample exchange of 2–4 lines
- **Primary button on card:** Choose this
- **Coming soon card:**
  - **Badge:** Coming soon
  - **Body:** Booking and payments are on the way. For now, your assistant can collect details and pass them to you.
- **Example titles:**
  - Client guide
  - New client enquiries
  - Patient guide
  - Order and product help
  - Admissions guide
  - Help centre

## 8. Building

- **Canvas title:** Building your assistant
- **Steps (each ticks as done):**
  1. Writing its introduction and tone
  2. Organising what it knows
  3. Setting safety rules
  4. Adding suggested questions
  5. Preparing your page
- **Builder message when done:**
  > Your assistant is ready to check. I'm going to ask it the kind of questions your {clients} ask, and show you every answer.

## 9. Checkup (the readiness check)

- **Canvas title:** Checkup
- **Running:** Asking question {n} of {total}…
- **Summary pass:** {passed} of {total} answered well, each with its source
- **Summary with gaps:** {passed} of {total} answered well. {gaps} need your input.
- **Row states:**
  - Answered with a source
  - Politely declined, as it should
  - Needs your input
- **Gap prompt in the builder:**
  > Your assistant couldn't answer "{question}". If you tell me the answer, I'll add it.
- **After adding:** Added. Your assistant will use this from now on.
- **Safety probe row:** Handled a sensitive message safely
- **All clear:**
  > Every question was answered well or declined appropriately. You're ready to try it yourself.

## 10. Try it

- **Canvas title:** Try it yourself
- **Subtitle:** Talk to it the way a {client} would. Nothing here is shared yet.
- **Suggested prompts:** {3 suggested questions}
- **Builder message:**
  > Have a go in the preview. If anything sounds off, just tell me what to change.

## 11. Share

- **Builder message:**
  > Your assistant is ready. Choose who can use it, and I'll create your link.
- **Title:** Who can use it?
- **Options:**
  - **Anyone with the link:** Best for your website, Instagram or WhatsApp status.
  - **People in your organisation:** They'll confirm their work email with a code.
  - **Only people you invite:** Add their emails. They'll confirm with a code.
- **Public disabled note** (while `botPagePublicAllowed` is off): Public links are coming soon. Start with your organisation or invited people.
- **Primary button:** Publish
- **Live title:** Your assistant is live
- **Live subtitle:** Share the link, or put the QR code where people will see it.
- **Actions:** Copy link · Download QR code · Share on WhatsApp · Open page
- **Copied toast:** Link copied
- **WhatsApp share text:** Have a question for {business}? Ask our assistant: {link}
- **Next step card:**
  - **Title:** Want it on WhatsApp too?
  - **Body:** Connect your WhatsApp number and the same assistant will reply there.
  - **Button:** Connect WhatsApp

## 12. Changing it later (builder on the assistant's page)

- **Panel title:** Change your assistant
- **Intro line, before anything is asked** *(added in 20a-2)*: Tell me what you'd like to change. I'll show you the change before anything happens.
- **Placeholder:** Tell me what to change, for example "make it more formal"
- **Examples (chips):**
  - Make it more formal
  - Add Hindi
  - Don't discuss prices
  - Add our new branch
- **Proposal card:**
  - **Title:** Here's the change
  - **Columns:** Before · After
  - **Buttons:** Apply · Not quite
- **Applied toast:** Changed. Undo
- **History title:** Recent changes
- **Undo confirmation:** Undo "{change}"? Your assistant will go back to how it was before this change.
- **Safety refusal:**
  > That would turn off a safety rule, so I can't make that change. I can add a rule of your own instead.

## 13. Problems and empty states

- **Site unreachable:** We couldn't reach {domain}. Check the address, or upload documents instead.
- **Blocked by the site:** {domain} asks automated readers not to visit, so we've respected that. Upload documents or describe your business instead.
- **Script-heavy site:** Your site loads most of its content with scripts, so we could only read {n} pages. Add a few documents to fill the gaps.
- **Very little found:** We found very little to work with. A short description or a document or two will make a big difference.
- **Upload limits:** PDFs, Word documents and text files, up to 10 at a time, 20 MB each.
- **Taking long:** Still reading. Large sites can take up to 2 minutes.
- **Daily limit:** You've reached today's setup limit. Your progress is saved, so pick up tomorrow.
- **Resume banner:** Welcome back. Pick up where you left off with {business}'s assistant.
- **Generic error:** Something went wrong on our side. Your progress is saved. Try again.
- **Leaving mid-way:** Your progress is saved. You can come back any time.

## 14. Health pack wording (shown in "See what this covers")

**Mental health safety**
- **Always:** Explains it's an assistant, not a therapist. Shares crisis contacts straight away if someone may be at risk. Lets you know when that happens.
- **Never:** Diagnoses, gives medication advice, offers therapy or counselling, or comments on anyone's situation.
- **If someone may be at risk:** Replies only with crisis contacts and encourages them to reach out now. Your team is alerted.

**Medical safety**
- **Always:** Points urgent symptoms to emergency care. Refers clinical questions to your team.
- **Never:** Diagnoses, interprets test results, or advises on doses or changing medication.

**Care for young people**
- **Always:** Speaks to parents or guardians about personal details. Keeps an age-appropriate tone.
- **Never:** Collects personal details from under-18s without a guardian.

**Legal and financial care** *(added in 20a-1)*
- **Always:** Explains your services, fees and process from your information. Points questions about someone's own case to your team.
- **Never:** Judges anyone's own legal case or tells them what to do with their money.

**Facts only** *(added in 20a-1)*
- **Always:** States only facts it can find in your information. Says plainly when it doesn't know, and where to go instead.
- **Never:** Invents prices, offers, availability or contact details.

## 15. One screen at a time (onboarding frame)

- **Saved indicator:** Saved
- **Back button:** Back
- **Footer, left:** Step {n} of {total} · {step name}
- **Step names:** Start · Reading your website · What we learned · Safety · A few questions · Choose a design · Building · Make it yours · Checkup · Share
- **Order:** Choose a design → Building → Make it yours (edits the assistant just built) → Checkup → Share. Until the checkup exists, Make it yours goes straight to Share.
- **Footer, right:** Your progress is saved. You can come back any time.
- **Enter hint:** press Enter ↵
- **Option hint (screen readers):** Press {keys} to choose
- **Talk to the builder, collapsed:** Tell me something else
- **Talk to the builder, placeholder:** Correct something, or tell me what I missed
- **Reading, done button:** See what I learned
- **Questions eyebrow:** {n} quick questions left · 1 quick question left
- **Building, done button:** Continue
- **Safety, button:** Continue
- **Answer box** (a question with no quick replies)**:** placeholder "Type your answer" · button "OK"
- **Talk to the builder, buttons:** Send · Stop
- **Progress bar, for screen readers:** Your progress

### From 20a-1 *(added in 20a-1)*

Labels the 20a-1 screens use that the sections above don't name. Same voice.

- **AI Chatbots button:** New assistant
- **On a draft assistant whose setup isn't finished:** Continue setup
- **The old form, for platform admins:** Advanced setup
- **Builder header:** Set up your assistant
- **Back button:** Back
- **Phone tabs:** Chat · Your assistant
- **Description box placeholder:** What does your business do, who do you help, and what do people usually ask?
- **Description button:** Continue
- **Upload button:** Choose files
- **Edit buttons:** Save · Cancel
- **Source of a detail the owner gave:** From you
- **Chat note after an edit on the canvas:** Updated {what}, for example "Updated your hours"
  - **{what} for a detail:** what we learned about you · your services and prices · your hours · your team · your address and contact details · your policies · your common questions · your brand
  - **{what} for the assistant:** your assistant's name · its introduction · its instructions · its tone · its languages · its topics · its suggested questions · its questions before the chat · what it says when it doesn't know · your own rules · your page · who can use it · your notes · its design
- **While the builder works:**
  - Reading your message
  - Working out your industry
  - Checking what's missing
  - Choosing designs
  - Writing your assistant
  - Writing the reply
- **"Your assistant" card:**
  - **Title:** Your assistant
  - **Labels:** Name · Introduction · Topics · Suggested questions · Questions before the chat · When it doesn't know · Safety
  - **Empty field:** Not set yet
- **Invite field:**
  - **Label:** Their emails
  - **Placeholder:** asha@example.com, ravi@example.com
  - **Help:** Separate emails with commas or new lines.
- **Publishing:** Publishing…
- **Coming soon card title:** Booking and payments

## 16. Make it yours

- **Title:** Make it yours
- **Subtitle:** You can change all of this later.
- **Labels:** Name · Logo and cover image · Colour · Tone · Opening line
- **Colour hint:** first one is from your logo
- **Logo notes:** From your website · {file name} · Initials will show instead
- **Logo actions:** Upload · Remove
- **Cover slot, empty:** Add a cover image
- **Cover slot, filled:** {file name} · Change
- **Image hint:** PNG, JPG or WebP, up to 5 MB. The cover shows at the top of your page.
- **Tone options:** Warm · Balanced · Formal
- **Preview status line:** Usually replies in seconds
- **Primary button (before the checkup exists):** Continue
- **Primary button (with the checkup):** Run the checkup

## 17. Checkup in plain words (20a-2)

- **Page subtitle:** We asked your assistant {total} questions your {clients} ask, and checked every answer against your information. Last run {when}.
- **Run again button:** Run again
- **Summary title, all clear:** Ready for {clients}
- **Summary title, with gaps:** Ready for {clients}, with {gaps} small gaps
- **Summary body, with gaps:** It answered {passed} of {total} questions correctly and showed where each answer came from. The other {gaps} weren't wrong: your information doesn't cover them yet, so it pointed people to {fallback}. Answer them below and it will know.
- **Trend caption:** Accuracy over the last {n} checkups
- **Section titles:** What we checked · Needs your input · Every question we asked
- **Explain toggle:** What do these mean? · Hide explanations
- **Measures** (title · technical word · meaning · explanation):
  - **Gets facts right** · Accuracy · When it answered, the answer matched your information. · We know the right answer to each question from your website and documents, so we compare. {gaps} questions had no answer in your information yet.
  - **Shows where it found it** · Sources · Every answer linked to the page it came from. · An answer without a source could be made up. Your assistant only states what it can point to.
  - **Says when it doesn't know** · Honesty · Instead of guessing, it pointed people to {fallback}. · Guessing is the most common way assistants go wrong. We ask questions your information can't answer on purpose.
  - **Handles sensitive messages safely** · Safety · Declined medical questions and shared crisis contacts when needed. This one must always be perfect. · We send messages about medication, diagnosis and risk. Each must get the response your safety rules require, every time.
- **Gap card label:** What it said
- **Gap answer label:** Your answer
- **Gap buttons:** Add answer · We don't offer this
- **Gap counter:** {n} of {total} · All done
- **Filters:** All {total} · Answered · Safety · Needs input

## 18. Landing page (20e)

- **Card after publishing, title:** Give it a landing page
- **Card body:** A one-page site with your services, hours and team, and your assistant built in.
- **Card button:** Create landing page
- **Unavailable note (not public):** Landing pages are for assistants anyone can use. Change who can use it to "Anyone with the link" first.
- **Ask box suggestions:** {suggested questions}
- **Default section titles:** Services and fees · Our team · Inside {business} · Visit us · Common questions
- **Call to action (health):** Not sure who to see? · Tell our assistant what you're looking for and the language you prefer. It will point you to the right person and how to book.
- **Call to action (other):** Have a question? · Our assistant knows our services, prices and hours, and answers straight away.
- **Button:** Ask a question
- **Footer credit:** Assistant by Ally
- **Edit mode:** Replace logo · Replace image · Add photo · + Add images · Show in search engines
- **Publish button (first time):** Publish landing page

## 19. Look and feel, and images

- **Screen title:** Look and feel
- **Section titles:** Logo · Images · Team photos · Style
- **Logo hint:** Shown on your page, in the chat header and on your landing page
- **Images hint:** Drop photos here, or click a slot. PNG, JPG or WebP, up to 5 MB each.
- **Slot names:** Bot page cover · Landing main photo · Gallery {n} · Link preview image
- **Slot, empty:** Add image
- **Team photos hint:** The assistant can show a photo when it recommends someone.
- **Team photo actions:** Add photo · Replace
- **Toast after a change:** Changed · Undo
- **Heading styles:** Classic · Modern · Friendly
- **Theme:** Light · Dark · Match the visitor's device
- **Preview switch:** Bot page · Landing page
- **Save notes:** Changes save as you go · Saved. Live on your page now.
- **Upload errors:**
  - Too large: That image is over 5 MB. Try a smaller one, or export it at a lower size.
  - Wrong type: We can only use PNG, JPG or WebP images (and SVG for logos).
  - Too many: This assistant has 50 images, the most it can hold. Remove one to add another.
  - Failed: That upload didn't finish. Try again.
- **Alt text label:** Describe this image for people who can't see it

## 20. Your assistant's home (after it's built)

The page an owner comes back to. Every field saves on its own; the words below are what the server
says when a save can't be made. More lines for the home's sections are added here as they're built.

- **Changed in another tab:** This changed while you were editing. Here is what it says now.
- **Field names, as the messages use them:** The name · Your assistant's name · The introduction · The tone · Extra instructions · What it says when it doesn't know · The disclaimer · What it says when someone may be at risk · What it says when someone sends too many messages · What it says to a number it doesn't know · What it says when it can't read a message
- **Field errors:**
  - Empty: {Field} can't be empty.
  - Too long: {Field} can be at most {n} characters.
  - Suggested questions: Up to 4 suggested questions.
  - Questions before the chat: Up to 8 questions before the chat.
  - A choice question needs its options.
  - A consent question needs its wording.
  - Choose a language.
  - Choose on or off.
  - Choose who can use it.
  - Public links are turned off for now. Choose organisation or specific people.
- **Your own rules:**
  - Write the rule in a few words.
  - A rule can be at most 200 characters.
  - You already have this rule.
  - Up to 20 rules of your own.
  - That rule is no longer there.
  - Touching a safety pack rule: the builder's line in §12 ("That would turn off a safety rule, so I can't make that change. I can add a rule of your own instead.")
- **Correct this:** Write the correction in up to 500 characters.

### The home's screens

- **Breadcrumb:** Assistants
- **Couldn't load:** We couldn't load this assistant. Try again.
- **Header actions:** Try it · Open page
- **Status:** Live · Paused · Not live yet
- **Sections:** Overview · What it knows · Personality · Safety · Page · Checkup · Conversations · Share
- **Section subtitles:**
  - Overview: How your assistant is doing, and what needs you.
  - What it knows: Everything your assistant answers from.
  - Personality: How it introduces itself and how it talks.
  - Safety: Rules your assistant always follows.
  - Page: How your page looks, and what it asks before a chat.
  - Checkup: A check that your assistant answers well and stays safe.
  - Conversations: What people asked, and what your assistant said.
  - Share: Who can use your assistant, and where.
- **Saving:** Changes save as you go · Saving… · Saved · Couldn't save. Try again.
- **Overview:**
  - Live: Your assistant is live
  - Paused: Your assistant is paused. People see a note that it's away.
  - Not live: Your assistant isn't live yet
  - Buttons: Pause · Turn on
  - Link: Your link · Copy link · Link copied · Download QR code
  - Numbers: Last 30 days · People · Messages · Answered · Couldn't answer · All numbers
  - Needs you: Needs your input · {n} questions it couldn't answer · 1 question it couldn't answer · Review · Nothing needs you right now.
  - Remove: Remove assistant · Remove {name}? Its page stops working and nobody can chat with it. Conversations are kept.
- **What it knows:**
  - Groups: From your website · Your notes · Documents · Needs your input
  - Facts: Correct this · Show original · Hide original · Corrected by you · Original
  - Correcting: What's right? · Save correction · Cancel
  - Corrected on the page: Corrected. Your assistant now uses your words.
  - Corrected in notes only: Saved to your notes. We couldn't find this line on the page, so the original may still come up.
  - Notes hint: Anything else your assistant should know. It reads these alongside your website.
  - Notes placeholder: For example: we're closed on public holidays.
  - Documents hint: Pages we read, and files you added.
  - Documents: Upload or remove documents · Ready · Reading · Couldn't read
  - No facts: Nothing was read from a website for this assistant.
- **Personality:**
  - Name: Name · The name your assistant uses.
  - Introduction: Introduction · The first thing it says.
  - Tone: Tone · Warm · Balanced · Formal
  - Languages: Languages · English · Hindi · The visitor's language
  - Suggested questions: Suggested questions · Shown under the chat box. Up to 4. · Add a question
  - Quick replies: Quick replies · Short answers it sends on WhatsApp.
  - When it doesn't know: When it doesn't know · What it says, and where it sends people.
  - Extra instructions: Extra instructions · Your own guidance for how it answers. Safety rules always come first.
- **Safety:**
  - Your own rules: Your own rules · Things your assistant must never do, on top of the rules above. · Add a rule · Never… · Edit · Remove · Always on
  - Disclaimer: Disclaimer · Shown before every chat.
  - At risk: When someone may be at risk · What it says before pointing people to help.
- **Page:**
  - Business name: Business name · Shown at the top of your page.
  - Page switch: Your page is on · Your page is off · Turn on · Turn off
  - Questions before the chat: Questions before the chat · Asked one at a time before the chat starts. Up to 8. · Question {n} · Add a question · Required
  - Question types: Short answer · Email · Phone · Choice · Date · Agreement
  - Options: Options, one per line
  - Agreement text: What they agree to
  - Limits: Limits · Messages per person per hour · Longest message, in characters · Messages per day, across everyone
  - Too many messages: When someone sends too many messages
- **Checkup:** Checkup · Your first checkup runs after your next change.
- **Share:**
  - Title: Who can use it
  - On your page: On your page · People who can open your assistant's page.
  - On WhatsApp: On WhatsApp · Numbers that can message your assistant on WhatsApp.
  - WhatsApp messages: Messages on WhatsApp
  - WhatsApp numbers: WhatsApp numbers
  - Team: Team · People who can change this assistant.
- **Try it:** Try your assistant · Chats here aren't saved. · Close · New chat
- **Platform admins only:** Engine · How this assistant answers. Only platform admins see this. · Classic view

## 21. Overview and feedback (Q2a)

- **Feedback under an answer:** Was this helpful? (thumbs up · thumbs down)
- **After thumbs down:** What was wrong? · Wrong information · Didn't answer my question · Something else
- **Optional note placeholder:** Tell us more (optional)
- **Thanks:** Thanks, this helps the team improve it.
- **Overview headline:** This week: {conversations} conversations. {answered_pct} answered with a source. {unknown} questions it didn't know.
- **Overview labels:** Conversations · Answered with a source · Didn't know · Handed to a person · Thumbs up · Safety replies
- **Comparison:** vs {value} last week
- **Unanswered list title:** Questions it didn't know
- **Unanswered action:** Answer it
- **Thumbs-down list title:** Answers people weren't happy with
- **Thumbs-down actions:** Correct this · It was fine
- **Checkup card:** Last checkup: {passed} of {total} answered well · View checkup
- **Empty state:** No conversations yet this week. Share your link to get started.
- **The rest of the screen** *(added in Q2a)*:
  - Section titles: This week · Answered with a source, last 7 days
  - Thumbs, for screen readers: Helpful · Not helpful
  - After choosing a reason: Send · Skip
  - Answer it box: Your answer · Write the answer in a sentence or two. · Save answer · Cancel
  - After Answer it or Correct this: Saved to your notes. The next checkup will ask this.
  - Under a thumbs-down: They asked · It said · Why
  - Reasons as the owner reads them: Wrong information · Didn't answer the question · Something else
  - Nothing to show: Nothing it didn't know this week. · No one has marked an answer unhelpful.
  - Suspected wrong declines, under Didn't know: {n} may have been in your information

## 22. Website widget (13)

- **Share section title:** On your website
- **Body:** Add a chat bubble to your website. Copy this line into your site, just before the closing body tag.
- **Copy button:** Copy code · Copied
- **Allowed websites label:** Websites where it can appear
- **Allowed websites hint:** Add your domain, for example yourclinic.in. It won't open anywhere else.
- **Options:** Bubble position: Right · Left · Bubble label · Open on its own after {n} seconds · Show on phones
- **Default bubble label:** Ask us
- **Public note (while public links are off):** For now, only people in your organisation or people you invite can chat in the bubble. Public chat is coming soon.
- **Help titles:** Add it to WordPress · Add it to Wix · Add it to Shopify · Add it to any website
- **Help bodies:**
  - WordPress: In WordPress, use a plugin that adds code to every page (such as WPCode), choose the footer, and paste the line.
  - Wix: In Wix, go to Settings, then Custom code. Add the line, choose All pages, and place it in Body - end.
  - Shopify: In Shopify, go to Online Store, then Themes, then Edit code. Open theme.liquid and paste the line just before </body>.
  - Any website: Paste the line just before </body> on every page where the bubble should appear.
  - Any website, with a Content-Security-Policy: If your site sets a Content-Security-Policy, allow {scriptOrigin} in script-src and frame-src, and {apiOrigin} in connect-src and img-src.
- **Websites list:** Add · Remove · No websites yet. The bubble won't appear until you add one.
- **Website input label:** Website address
- **Open on its own (input label):** Seconds
- **Widget, inside the panel:** Close · This chat isn't available on this website.
- **The panel's name:** Chat with {business}
- **Conversation badge:** Website
- **Website refused (under the list):**
  - {domain} is shared by many websites, so the bubble could appear on sites that aren't yours. Add your own address on it, for example yourclinic.{domain}.
  - {domain} isn't a website address. Add your domain, for example yourclinic.in.
  - localhost only works while testing. Add your real website address.
  - You can add up to 10 websites.
  - Add your website addresses as a list.
- **Option refusals:** Choose how the bubble looks. · Choose right or left. · Choose between 3 and 120 seconds.

## 23. Inbox and handing over (11a)

- **Nav label:** Inbox
- **Filters:** Needs a person · Live now · All
- **Channel filter:** All channels · WhatsApp · Bot page · Website
- **Chat actions:** Take over · Hand back to assistant
- **Taken over banner:** You're replying. Your assistant is paused in this chat.
- **Someone else has it:** {name} is replying in this chat.
- **Safety label:** Safety
- **To the visitor, hand-over in hours:** I've asked the team to join. They usually reply within {hours}.
- **To the visitor, hand-over out of hours:** The team is away now. They'll reply when they're back at {time}.
- **To the visitor, auto hand-back:** The team couldn't reply this time, so I'm back to help. You can ask for a person again any time.
- **Human reply name shown to visitor:** {first name} from {business}
- **Notification:** {business}: someone needs a person
- **Email subject:** A conversation needs you
- **Settings:** Hand back to the assistant after {hours} hours without a reply · Email me if nobody opens it within {minutes} minutes
- **The rest, added in 11a:**
  - Visitor link in the chat: Talk to a person
  - Email body (no message text): Someone talking to {assistant} would like a person. Nobody has opened the conversation yet. Open it: {link}
  - WhatsApp after 24 hours: WhatsApp only lets you reply within 24 hours of their last message. You can reply again when they next write.
  - WhatsApp window, while open: You can reply on WhatsApp until {time}.
  - Reply box placeholder: Write a reply
  - Buttons: Send · Take over · Hand back to assistant
  - Settings section title: When someone asks for a person
  - Settings labels: They usually reply within · Opening hours (optional) · Days · From · To · Show the team member's first name · Hours before it hands back · Minutes before the email
  - Day names: Sun · Mon · Tue · Wed · Thu · Fri · Sat
  - The inbox sits in AI Chatbots: a tab named Inbox, and each assistant's own Inbox section, subtitled: Chats from every channel. Take one over to reply yourself.
  - Assistant filter: All assistants
  - On a phone, from a chat: Back to chats
  - Settings hint for opening hours: Without opening hours, visitors are always told when you usually reply.
  - List labels: Needs a person · Safety · {name} is replying · Your assistant
  - Reasons: Asked for a person · Couldn't help twice
  - Empty inbox: No conversations yet. They'll appear here as people chat.
  - No chat open: Pick a chat to read it.
  - Nothing needs a person: Nobody is waiting for a person.
  - Notifications: Sound on · Sound off · Turn on notifications
  - Notification for Safety: {business}: a safety message
  - Visitor page, team joined: {sender} has joined the chat.
  - Visitor page, handed back: You're chatting with the assistant again.

## 24. Purposes, choosing pages and topics to avoid (20a-2)

*(From `archive/chunk-20a2-additions.md` §4, plus the checkup lines 20a-2's screens need. §20 is the assistant's home, so these are §24.)*

- **Screen title:** What should your assistant do?
- **Builder message:** Based on what I learned, here's what I'd suggest. You can pick something else, and change it later.
- **Badge:** Recommended for you
- **Purpose names and one-liners:**
  - **Answer questions:** Replies to questions about your services, prices, hours and policies, with a link to where it found each answer.
  - **Bring in customers:** Helps people find the right service, then passes their name and number to you.
  - **Train my team:** Explains your procedures to staff and quizzes them when they ask.
  - **Guide people step by step:** Walks people through a process one step at a time, like test preparation or setting up a product.
  - **Something else:** Describe what you need, and I'll set it up.
- **Something else prompt:** What should your assistant help with? A sentence or two is plenty.
- **Defaults confirmation:** I've set it up for {purpose}: {defaults}. You can change any of this on the next screen.
- **Honest limits:**
  - Enquiries: It can't book or take payments yet. It sends you each new enquiry by email.
  - Training: It doesn't keep track of each person's progress yet.
- **What each purpose will and won't do** *(added in 20a-2; fixed in code, so a card never promises what doesn't work)*:
  - Answer questions. It will: Answer questions from your information · Link each answer to where it came from · Say plainly when it doesn't know. It won't: Book, take orders or take payments
  - Bring in customers. It will: Recommend the service that fits · Ask one question at a time · Pass each person's name and number to you. It won't: Book, take orders or take payments · Promise discounts or slots you haven't listed
  - Train my team. It will: Explain your procedures in short steps · Quiz your team when they ask · Link each answer to your documents. It won't: Make up a procedure
  - Guide people step by step. It will: Give one step at a time · Check each step is done before the next · Keep your steps in order, safety steps included. It won't: Skip or reorder steps · Book, take orders or take payments
- **Sample exchanges when the builder's own don't fit** *(added in 20a-2)*:
  - Answer questions: "What are your opening hours?" / "Here's when we're open, from our website."
  - Bring in customers: "Which service would suit me?" / "Happy to help. What are you looking for help with?"
  - Train my team: "Test me on our procedures." / "Sure. First question: what's the first step?"
  - Guide people step by step: "How do I get ready?" / "Here's the first step. Tell me when it's done."
- **Defaults confirmation parts** *(added in 20a-2)*: Pre-chat: {fields} · Access: {access} · name, phone, what they're looking for · nothing before the chat · people in your organisation · anyone you choose
- **Lead alert email subject:** New enquiry from your assistant
- **Lead alert body:** {name} asked about {topic}. Phone: {phone}. {summary} Open the conversation: {link}
- **Lead alert, when a detail wasn't given** *(added in 20a-2)*: Someone (no name) · your services (no topic). An email address stands in for the phone when that's what they gave.
- **Reading choice:** Read everything · Choose pages
- **Choose pages title:** Which pages should it read?
- **Choose pages shortcuts:** Leave out blog and news · Leave out careers
- **Choose pages note:** It only learns from the pages you choose. You can change this later.
- **Topics to avoid label:** Anything it shouldn't talk about?
- **Topics to avoid placeholder:** For example, prices or other clinics
- **Topics to avoid errors:** Up to 10 topics. · A topic can be at most 80 characters.
- **Removing a source:** Remove {page}? Your assistant will forget {n} details that came only from this page.
- **Choose pages and Sources, the rest of the screen** *(added in 20a-2)*:
  - Choose pages buttons: Save these pages · Read everything
  - The home page's section: Home page (always read)
  - A page not read yet: Not read yet
  - Section checkbox: All of {section}
  - After saving: Saved. It reads only the pages you chose. · Saved. It forgot {n} pages you left out. Undo
  - Sources group title and hint: Pages it learned from · Remove a page and your assistant stops using it.
  - A page's count: {n} details
  - A removed page: Removed · Put back
  - Buttons: Remove · Keep it
- **Topics to avoid, the add button** *(added in 20a-2)*: Add a topic

### The checkup in onboarding and on the home *(added in 20a-2)*

- **Onboarding checkup, eyebrow:** Checkup
- **Onboarding checkup, title with gaps:** {passed} of {total} answered well. {gaps} need your input.
- **Onboarding checkup, title all clear:** {passed} of {total} answered well, each with its source
- **Stat tiles:** Accuracy · Safety · With sources
- **Buttons:** Answer the {n} questions · Answer the question · Try it yourself · Skip for now
- **Publish blocked by a safety answer:** We're double-checking a safety answer. Try again in a few minutes.
- **Home header chip:** {pct}% accurate · {n} to fix (with nothing to fix: {pct}% accurate)
- **Row state, a reply that wasn't right:** Needs a fix
- **Row state, not asked yet:** Asking…
- **Source shown for a safety question:** Safety rule
- **Measure units:** of {n} questions · of {n} answers · of {n} unknowns · of {n} checks
- **Gap answer placeholder:** Write the answer in a sentence or two.
- **Summary ring label:** accurate
- **Publish blocked, no checkup yet:** Run the checkup before you publish.
- **Publish blocked, an answer without a source:** One answer had no source. Look at it in the checkup, then run it again.
- **Checkup couldn't start:** The checkup couldn't start. Try again in a minute.
- **Too many checkups today:** You've run the checkup 5 times today. It runs again after your next change, or tomorrow.

## 25. Polish and control pass (20d-2)

*(The brief's lines, plus every new line the 20d-2 screens need. §24 is purposes, so these are §25.)*

- **Checkup intro:** A checkup asks your assistant the questions customers would ask, then checks each answer against your own pages.
- **Steps:** Writing questions from your pages · Asking your assistant ({n} of {total}) · Checking each answer against your pages · Your result
- **Results:** Passed · Partly · Failed · Must pass
- **Add:** Add a question · What should happen · A good answer includes · It must not say · Must pass
- **Outcomes:** It should answer · It should say it doesn't know · It should politely decline · It should offer a person
- **Badges:** Written by Ally · Added by you · From a chat
- **Locked:** Safety questions can't be turned off. They keep your clients safe.
- **Banner:** You changed your assistant. Run a checkup to see the effect. · Run checkup
- **Compare:** Before: {a} of {n} · After: {b} of {n}
- **Change panel:** Describe a change in your own words. I'll show exactly what will change. Nothing changes until you approve it, and you can undo it.
- **How it works intro:** Everything your assistant follows, in the order it applies. You can edit the parts marked as yours.
- **Locked layer:** Set by Ally to keep answers accurate and safe. You can add to safety rules, not remove them.
- **Inbox:** Pick a chat to read it · Add to checkup · Sound for new chats: on · Sound for new chats: off

### Lists on the home: who can open the page, WhatsApp, the team, documents, quick replies *(added in 20d-2)*

- **Any list:** Add · Remove {item} · We couldn't load this list. Try again. · Try again
- **On your page:** Email address · Name (optional) · Add many at once · Paste emails, one per line · Add these emails · Nobody is on the list yet, so nobody can open the page. Add the emails of people who should. · No organisation is on the list yet. Add yours so its people can open the page. · Add {organisation} · Your organisation
- **On WhatsApp:** Who can message it · Anyone who messages it · Anyone with an Ally account · Only the people on this list · Everyone else gets your “not on the list” message. Crisis replies always go out. · Phone number · Email address · Phone · Email · Organisation · Add many at once · Paste phone numbers, one per line · Add these numbers · The list is empty, so no one can message it yet. Add their numbers.
- **WhatsApp numbers:** Connected · Waiting for WhatsApp · Needs attention · Last message {when} · No messages yet · Connect a WhatsApp number · Connect your WhatsApp number · Finish setup · Check it · It's working. · Stop using it here · Stop using {number} for this assistant? People who message it get no reply until it's connected again. · Stop using it · Keep it · Only the assistant's owner can connect a number. · No number yet.
- **Team:** Their email address · What they can do · Can view and try it · Can change it · Owner: also manages the team · You · Only an owner can change the team.
- **Documents:** Upload a file · PDF, Word or EPUB, up to 25 MB. · Add from your library · Documents in your library · There are no other documents in your library. · Your file · From your library · Uploading {name}… · We can only read PDF, Word or EPUB files. · That file is over 25 MB. Try a smaller one. · That upload didn't finish. Try again. · No documents yet. Upload a file, or add one from your library. · Close
- **Quick replies:** Fixed answers it sends on WhatsApp when someone writes certain words, without searching. · Add a quick reply · Name · When someone writes · Words or phrases, separated by commas · It replies · Save reply · Cancel · Set by Ally · Reworded by you · Off · Reword · Turn off · Turn on · Safety reply: it can be reworded, never turned off. · Use Ally's wording · No quick replies of your own yet. · Yours
- **Overview, numbers:** See all numbers

### Explaining each section, and the header *(added in 20d-2)*

- **The `?` button's name:** What is {section}?
- **Overview, explained:** How many people your assistant talked to, how often it answered from your information, and the questions it couldn't answer yet. Answer those and it learns them.
- **What it knows, explained:** Your assistant only answers from what's here: the pages it read, your notes and your documents. If something is wrong, correct it here and the next answer uses your words.
- **Personality, explained:** How your assistant sounds. It never changes what it knows or its safety rules.
- **Safety, explained:** Ally's safety rules for your kind of practice are always on. You can add rules of your own and topics it should never talk about. You can't turn Ally's rules off.
- **How it works, explained:** Everything your assistant follows, in the order it applies. The parts marked as yours can be edited here.
- **Page, explained:** Your page is where people chat with your assistant. Choose how it looks and what it asks first.
- **Checkup, explained:** A checkup asks your assistant the questions customers would ask, then checks each answer against your own pages.
- **Inbox, explained:** Every chat from your page, your website and WhatsApp. Take one over to reply yourself; your assistant waits in that chat until you hand it back.
- **Share, explained:** Who can use your assistant on your page, on your website and on WhatsApp, and who on your team can change it.
- **Header menu (`···`):** More · How it answers · Classic view · Open page. How it answers and Classic view are for Ally staff only; on phones the menu also holds Open page.
- **Inbox, the rest (20d-2):** Today · Yesterday (the date line, once a day) · Helpful · Not helpful (a rating under an answer)
- **When someone asks for a person, the checkbox under Opening hours (20d-2):** Set opening hours
- **AI Chatbots list page (20d-2):** Your assistants answer people's questions from your own pages, on your page, your website and WhatsApp. · Assistants · No assistants yet · You haven't been added to an assistant yet · Give us your website and we'll set one up with you in about ten minutes. · Ask the assistant's owner to add you to its team. · Not on WhatsApp yet · {count} messages, last 30 days · {count} people

### The Checkup the owner controls *(added in 20d-2)*

- **Checkup, while it runs:** Writing questions from your pages · Asking your assistant ({n} of {total}) · Checking each answer against your pages · Your result · You can leave this page. The checkup keeps going, and you'll see where it got to when you come back.
- **How checking works:** How checking works · Passed: the answer matched your pages and said where it came from. · Partly: it was right on some tries but not all. Must pass questions are asked 3 times, because the same question can get different words each time. · Failed: the answer was wrong, made something up, or missed what a good answer includes. · Needs your input: your pages don't cover it yet. Answer it and your assistant will know. · Must pass: a question your assistant has to get right. If one you added fails, we ask you before your assistant goes live. · A failed safety question, or an answer without a source, always stops your assistant going live until it's fixed.
- **Checkup results and filters:** Passed · Partly · Failed · Needs your input · Couldn't check · Not asked yet · Must pass · Off · All · Failed · Partly · Passed · Must pass · Added by you · Written by Ally · Written by Ally · Added by you · From a chat
- **A checkup question:** A good answer includes · It must not say · What it said · Why · Where it looked · {s} s to answer · Last checkups · Nothing yet · Edit · Turn off · Turn on · Delete · Try this one · Asking… · Details · Hide details · Run all · Run only failed
- **Adding or editing a question:** Add a question · Edit the question · Question · What should happen · A good answer includes · In your own words. Press Enter after each one. · It must not say · Must pass · Your assistant has to get this right. · Language · The question's own · Save question · Cancel · Add · Remove {item} · It should answer · It should say it doesn't know · It should politely decline · It should offer a person · Safety questions can't be turned off. They keep your clients safe. · You can add to a safety question, not take anything away.
- **After a change:** You changed your assistant. Run a checkup to see the effect. · Run checkup · Before: {a} of {n} · After: {b} of {n}
- **Suggest more questions:** Suggest more questions · Writing questions from your pages… · Tick the ones to keep. Nothing is added until you do. · Keep {n} questions · Keep 1 question · No new questions to suggest right now. · Added {n} questions to your checkup. · Not now · You've tried 30 questions today. Try again tomorrow, or run the whole checkup.
- **Why a question didn't pass:** It missed something a good answer includes. · It said something it must not say. · It said something that isn't in your pages. · It answered without saying where it found it. · It answered when it should have declined. · It didn't answer the question. · It said it didn't know, but the answer was in your pages. · It used formatting your page can't show. · It should have answered, and didn't. · It should have declined, and didn't. · It didn't give the reply for someone who may be at risk. · We couldn't finish checking this one. Run it again. · It took too long, so a shorter answer went out. · It didn't do what it should.
- **Checkup summary, the rest (20d-2):** No questions of this kind yet. · Ready for {clients}, with 1 small gap
- **Inbox, adding to the checkup (20d-2):** Add to checkup · Added to your checkup. It's asked in the next one.
- **Answer it and Correct this, the box (20d-2):** Also add to checkup
- **Publishing, when an owner's own Must pass question failed (20d-2):** This question you marked Must pass failed. Go live anyway? · Go live anyway

### Change your assistant, How it works and Why this answer *(added in 20d-2)*

- **Change panel:** Describe a change in your own words. I'll show exactly what will change. Nothing changes until you approve it, and you can undo it. · What I can change · Welcome message · Tone · Languages · Business details · Your instructions · Topics to avoid · Quick replies · Pages it knows · What I can't change · Safety rules: these can only be added to. · Who can open your page: that's in Share. · Not this · Change · History · You changed your assistant. Run a checkup to see the effect. · Run checkup · Nothing has changed yet. · From the Change panel · Edited by hand · Undo · Restore · Undone · {who} · {when}
- **Field names in the History:** Business name · Your assistant's name · The introduction · The tone · Your instructions · What it says when it doesn't know · The disclaimer · What it says when someone may be at risk · Suggested questions · Topics to avoid · Questions before the chat · Limits · Languages · Your page · Who can open your page · When someone asks for a person · The website bubble · Who can message it on WhatsApp · What it says when someone sends too many messages · What it says to a number it doesn't know · What it says when it can't read a message · Your own rules
- **How it works:** Everything your assistant follows, in the order it applies. You can edit the parts marked as yours. · Set by Ally to keep answers accurate and safe. You can add to safety rules, not remove them. · Yours · Set by Ally · Show exact text · Hide exact text · Show the full instructions · Hide the full instructions · This is the whole text your assistant gets, with your parts highlighted. Where it says {question}, it gets the visitor's message; the parts of your pages it finds go in for each question. · Edit · Edit in {section} · {n} of {max} characters · Saved. Your assistant still follows its safety and base rules first, so text that tries to override them has no effect. · We couldn't load this. Try again in a moment. · Nothing here yet. · your kind of practice · answering questions · Anything else it should know or do
- **How it works, Ally's base rules:** Ally's base rules · Answer from your pages, say where each answer came from, never make things up, and say plainly when it doesn't know.
- **How it works, Safety rules:** Safety rules · Always on for {pack}. Your own rules are added after Ally's.
- **How it works, What it's for:** What it's for · Set by the purpose you chose: {purpose}. Change it by choosing another purpose.
- **How it works, Business details:** Business details · The name your assistant uses.
- **How it works, Tone and style:** Tone and style · How it sounds.
- **How it works, Your instructions:** Your instructions · Anything else it should know or do. Safety and base rules always come first.
- **How it works, Topics to avoid:** Topics to avoid · Subjects it politely declines.
- **How it works, How it finds answers:** How it finds answers · Searches your pages up to {searches} times a question and uses the best {passages} parts it finds, from {documents} documents.
- **Why this answer:** Why this answer? · Hide · Where it looked · It didn't use any of your pages for this. · {s} s to answer · Topics to avoid: {topic} · It said it didn't know.
- **Personality, the link to How it works:** See everything it follows
- **How it works, in the section list (20d-2):** How it works · Everything your assistant follows, and the parts you can change.
- **Your instructions, when the check can't run (20d-2, at approval):** Couldn't check this right now. Try again in a minute.
- **When someone may be at risk, before the owner writes their own (20d-2, at approval):** From your safety rules. This is what it says now, and you can add to it.
- **Overview numbers, with the 7 / 30 days switch (20d-2, at approval):** Your numbers · Show the last · 7 days · 30 days
- **Overview, All numbers (CL1, replacing the classic usage tab; opens in place under the numbers):** See all numbers · Hide all numbers · Show the last · 7 days · 30 days · 90 days · Messages in · People · Didn't know · Of the questions it was asked · Too few questions to say · Typical reply time · 1 in 20 took {s} s or longer · {s} s · What happened to each message · Answered · Didn't know · Asked to clarify · Safety replies · From numbers it didn't recognise · Errors on our side · Other · Replies per day · {day}: {n} replies · Languages · Language · Questions · Documents it used most · {n} times · Not used in this period: 1 document · Not used in this period: {n} documents · No messages in this period yet. · We couldn't load these numbers. · Try again
- **The header's `···` menu, staff only (CL1, replacing the classic view's Settings tab):** Settings · This assistant's own engine settings. Only platform admins see this.
