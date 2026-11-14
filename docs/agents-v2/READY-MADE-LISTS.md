# Ready-made lists: the default catalogue

> 14 ready-made lists an owner can add from an assistant's home (5b). Each is **data**: definitions installed through 5a's engine, with no entries. Nothing here is code per business. Read with `CHUNK-05A-NOTES.md` (what the engine supports) and `chunk-5b.md` §6 (how they're installed). <!-- docs-path-lint: planned -->

## Rules every ready-made list follows

- **Only what 5a supports.** Field types: text, long text, number, money (INR), date, date and time, duration (minutes), select, yes/no, phone, email, URL, relation. Rules: unique (with `where`), capacity (`max` or `max_from`, with `where`), limit per person, transitions. No recurrence, rollups or formulas.
- **The assistant's defaults:**
  - **Look things up** is Do it on reference lists (prices, slots, products, listings), and on a person's own entries.
  - **Add** and **Change** start at **Never**. The owner turns them on after testing in Try it.
- **A person field** (marked ★) makes entries belong to someone. The assistant only ever sees and changes the entries of the person it's talking to.
- **Never from a conversation** (never_store) goes on any field that could hold clinical or sensitive detail. Staff fill these in; the assistant never reads or writes them.
- **Statuses** always have a transitions rule. A new entry starts in the first status.
- **Keys** are lower case with `_` (5a's slug rule). Labels are what owners see.

Notation: `key: type` with options in brackets. **Bold** means required.

## The catalogue

Grouped as the picker shows them.

### Appointments and visits

**1. Appointments** (installs with **Slots**). For clinics, therapists, salons and consultants.
- **Slots:** **starts_at**: date and time · practitioner: text · duration: duration (default 50) · open: yes/no (default yes). Title: starts_at. Sort: starts_at. Assistant: look up.
- **Appointments:** **slot**: relation → Slots · **client**★: relation → contact · service: select [your services] · status: select [booked, confirmed, completed, cancelled, no_show] · notes: long text (never from a conversation).
  - Rules: one per slot, not counting cancelled · at most 2 per person while booked or confirmed · booked → confirmed or cancelled; confirmed → completed, cancelled or no_show.
  - Assistant: look up; add and change are off at install.
- "What's free on Thursday?" · "Book 11:00" · "Cancel my appointment."

**2. Site visits** (installs with **Property listings**). For real estate agents and builders.
- **Property listings:** **title**: text · **area**: text · bhk: select [1 RK, 1 BHK, 2 BHK, 3 BHK, 4+ BHK, Plot, Shop, Office] · price: money · size_sqft: number · for: select [sale, rent] · status: select [available, on hold, sold, rented]. Rule: available → on hold, sold or rented; on hold → available, sold or rented. Assistant: look up.
- **Site visits:** **listing**: relation → Property listings · **visitor**★: relation → contact · **at**: date and time · status: select [requested, confirmed, done, cancelled].
  - Rules: one visit per listing at a time (unique on listing + at, not counting cancelled) · at most 3 per person while requested or confirmed · requested → confirmed or cancelled; confirmed → done or cancelled.
- "2BHK in Baner under 85 lakh" · "Can I see it on Saturday at 11?"

**3. Table reservations** (installs with **Tables**). For restaurants and cafés.
- **Tables:** **starts_at**: date and time · **table**: text · seats: number · open: yes/no (default yes). One row per table per time. Assistant: look up.
- **Reservations:** **table_slot**: relation → Tables · **guest**★: relation → contact · party_size: number · occasion: text · status: select [booked, seated, completed, cancelled, no_show].
  - Rules: one per table slot, not counting cancelled · at most 2 per person while booked · booked → seated, cancelled or no_show; seated → completed.
- "A table for 4 tomorrow at 8?" (the assistant looks up a table with at least 4 seats).

### Classes and events

**4. Classes** (installs with **Bookings**). For gyms, yoga, dance and coaching batches.
- **Classes:** **name**: text · **starts_at**: date and time · teacher: text · seats: number (default 20) · level: select [beginner, intermediate, advanced, all]. Assistant: look up.
- **Bookings:** **class**: relation → Classes · **member**★: relation → contact · status: select [booked, attended, cancelled].
  - Rules: no more bookings than the class's seats, not counting cancelled · one booking per member per class (unique on class + member, not counting cancelled) · booked → attended or cancelled.
- "Is there a beginners' yoga class on Saturday?" · "Book me in."

**5. Event registrations** (installs with **Events**). For workshops, webinars, camps and open days.
- **Events:** **name**: text · **starts_at**: date and time · venue: text · seats: number · fee: money · registration_open: yes/no (default yes). Assistant: look up.
- **Registrations:** **event**: relation → Events · **attendee**★: relation → contact · guests: number (default 0) · status: select [registered, attended, cancelled].
  - Rules: no more than the event's seats, not counting cancelled (each registration counts once; guests are a note for the owner) · one per person per event (unique on event + attendee, not counting cancelled) · registered → attended or cancelled.

### Sales and enquiries

**6. Leads.** For any business that follows up on enquiries.
- **name**: text · **phone**: phone · email: email · interest: select [your services] · budget: money · source: select [WhatsApp, website, walk-in, referral, other] · status: select [new, contacted, qualified, won, lost] · notes: long text.
- Rules: one live lead per phone, not counting won or lost · new → contacted or lost; contacted → qualified or lost; qualified → won or lost.
- Assistant: look up is off (leads aren't for visitors); add is off at install. Once on, "Can someone call me about the 3-month plan?" becomes a lead.

**7. Callback requests.** The honest version of "I'll pass it on".
- **phone**: phone · **requester**★: relation → contact · **reason**: text · preferred_time: select [morning, afternoon, evening, any time] · status: select [requested, called, closed].
- Rules: at most 1 per person while requested · requested → called or closed; called → closed.
- Assistant: look up (their own); add is off at install. Once on: "Call me back about my bill" → "Done: the team will call you this evening."

**8. Admissions enquiries.** For coaching institutes, schools and colleges.
- **student_name**: text · **parent**★: relation → contact · **phone**: phone · grade: select [Class 6–8, Class 9–10, Class 11–12, Graduate, Other] · course: select [your courses] · preferred_batch: select [morning, afternoon, evening, weekend] · status: select [new, counselled, enrolled, not joining].
- Rules: at most 3 per person while new or counselled · new → counselled or not joining; counselled → enrolled or not joining.
- The person is the parent. With the young-people pack on, the assistant must not collect a minor's own details, so the form asks for the parent's.

### Shops and orders

**9. Products.** For shops, pharmacies (non-prescription items only) and bakeries.
- **name**: text · category: select [your categories] · price: money · in_stock: yes/no (default yes) · stock: number · description: long text · sku: text.
- Rule: one per SKU. Assistant: look up ("Do you have whole-wheat bread? How much?").

**10. Orders.** For shops that take orders on WhatsApp.
- **number**: text · **customer**★: relation → contact · **items**: long text · total: money · delivery_address: long text · status: select [placed, packed, sent, delivered, cancelled].
- Rules: one per order number · placed → packed or cancelled; packed → sent or cancelled; sent → delivered.
- Assistant: look up (their own: "Where's my order?"); add and change are off at install.

**11. Service areas.** For delivery and home services.
- **pincode**: text · **area**: text · delivers: yes/no (default yes) · delivery_fee: money · min_order: money · eta: text.
- Rule: one per pincode. Assistant: look up ("Do you deliver to 411045?").

### Services and support

**12. Price list.** Facts that must always be answered the same way.
- **service**: text · price: money · duration: duration · category: select [your categories] · description: long text · available: yes/no (default yes).
- Rule: one per service. Assistant: look up, with every price cited.

**13. Support tickets.** For any business with after-sales questions.
- **subject**: text · **customer**★: relation → contact · details: long text · priority: select [low, normal, urgent] · order_ref: text · status: select [open, in progress, resolved, closed].
- Rules: at most 3 per person while open or in progress · open → in progress or closed; in progress → resolved; resolved → closed or open.
- Assistant: look up (their own: "Any update on my complaint?"); add is off at install.

**14. Memberships.** For gyms, clubs and subscription services.
- **member**★: relation → contact · **plan**: select [your plans] · **starts_on**: date · ends_on: date · status: select [active, paused, expired, cancelled] · sessions_left: number.
- Rules: one active membership per member (unique on member, not counting expired or cancelled) · active → paused, expired or cancelled; paused → active or cancelled.
- Assistant: look up (their own: "When does my membership end?"); add and change stay off. The team manages memberships.

## Safety notes

- **Health assistants (the medical, pharmacy and mental-health packs):**
  - free-text fields that could hold symptoms (notes, details, reason) are never from a conversation on Appointments, Support tickets and Callback requests;
  - Products is for over-the-counter items; the pack's rules still decline dosing.
- **The young-people pack:** Admissions enquiries and Classes use the parent as the person.
- **No ready-made list stores payment details,** and none takes payments.

## Options the owner fills in

The `[your services]`, `[your courses]`, `[your categories]` and `[your plans]` selects start with three example values. Each installs with a prompt to replace them ("Add your services"). Filling them from the assistant's knowledge waits for `options_from` (later).
