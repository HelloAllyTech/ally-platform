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
