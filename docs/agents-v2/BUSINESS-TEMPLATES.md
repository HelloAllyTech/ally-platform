# Business templates: the default catalogue

> 14 business templates that set up a whole assistant for one kind of business: who talks to it, what it knows, which lists it uses, what it may do for each kind of person, the reminders it sends, and the checkups it must pass. Read with `TEMPLATE-DATA-MODEL.md` (a template is data: definitions, never code), `READY-MADE-LISTS.md` (the lists these use) and `BUILDING-BLOCKS.md`. <!-- docs-path-lint: planned -->

## What a template holds

One package, installed into a new or existing assistant:

| Part | What it is | Built in |
|---|---|---|
| **Roles** | Who talks to it. Most templates have customers and staff; a restaurant has guests and waiters. Each role has its own instructions and its own abilities | Roles, light (new, see below) |
| **Pages** | What it knows and how it behaves for each role: `/org`, `/agent`, `/roles/<role>`, `/skills`, `/knowledge` (see below) | 4a Workspace, light |
| **Lists** | From `READY-MADE-LISTS.md`, plus the new lists below | 5a, 5b |
| **Abilities** | Per role and per list: look up, add, change, hand over, each Do it, Ask me first or Never | 3b, 6; Ask me first in 14a |
| **Follow-ups** | Reminders and messages after a change ("the day before", "2 hours after completed") | 6F and 10a (next sprint) |
| **Checkups** | Questions the assistant must pass before it goes live | Q1, today |
| **Safety pack** | The minimum for the business type; the owner can raise it, never lower it | 20a, today |
| **Setup questions** | Asked once when installing: business name, hours, services, staff | Onboarding, today |

**One template serves many use cases** because everything in it is data: the same tables hold a clinic's appointments and a restaurant's table orders, and only the rows differ (`TEMPLATE-DATA-MODEL.md` §1). Saving any assistant as a new template (18a) packages exactly these parts.

## Pages a template writes: how the assistant acts like it

Installing a template writes its pages into the assistant's workspace (4a). The agent acts as that business because of these files, not because of code, and the owner can edit any of them.

| Page | Loaded | What the template puts there |
|---|---|---|
| `/org/ORG.md` | Always | Filled from the setup questions: the business's name, what it does, locations, hours, tone. Shared by all the organisation's assistants, so a template only fills what's empty |
| `/agent/AGENT.md` | Always | Who the assistant is for this kind of business, what it helps with, what it never does |
| `/roles/<role>.md` | Only for that role | How to treat guests, waiters or the manager; what each may ask for |
| `/skills/<name>.md` | Its name always; the page when relevant | Step-by-step how-tos that use the lists |
| `/knowledge/*.md` | On demand | Starter FAQs the owner replaces ("Do you take large groups?") |

**The restaurant, for example:**

- `/agent/AGENT.md`: "You're the assistant for {name}, a restaurant. You help guests with the menu, today's availability, opening hours and table bookings. Never guess about allergens: if the menu doesn't say, tell them to check with the staff."
- `/roles/guest.md`: menu and availability questions, reservations, takeaway callbacks; never sees table orders.
- `/roles/waiter.md`: short, fast replies; turn "table 4: 2 paneer tikka, 1 dal makhani, less spicy" into a table order; mark dishes sold out; read back what was placed.
- `/roles/manager.md`: today's reservations and orders by status.
- `/skills/take-table-order.md`: read the table and items, check each item against the Menu, confirm once, then `create_table_orders`.
- `/skills/book-a-table.md`: party size, day and time; `find_tables` with enough seats; offer what's free; book only after the guest confirms.

**Rules:**
- A role's page is never loaded for another role: a guest's run can't see the waiter's page.
- Skills only describe how to use tools the role is allowed; they never grant abilities. Abilities stay in the abilities settings.
- Safety comes before every page and can't be edited by a template.
- When a template is upgraded, the owner sees a before and after for each page they changed, and their changes are kept (18).

## Roles, light: what the staff-facing templates need

Today everyone who chats is treated the same. Staff-facing use, such as a waiter on WhatsApp, a receptionist checking the day's bookings or an employee asking HR, needs:

- **Staff by number:** the owner adds team members' WhatsApp numbers (or emails, for the bot page), each with a role.
- **The run knows the role:** the agent gets that role's page and abilities. A guest can see the menu and book a table; a waiter can also place a table order, mark a dish as sold out, and see today's bookings.
- **Abilities per role:** the same `create_table_orders` is Never for guests and Do it for waiters.
- **The safety layer is the same for everyone.**

This is a new small chunk, **7a Roles, light** (about 6 hours). It comes before any staff-facing template can work. Customer-facing parts work without it.

## New lists these templates add

These go into `READY-MADE-LISTS.md` alongside the 14 already there. Same rules: 5a's field types and rules only, and Add and Change off at install.

- **Menu:**
  - **name**: text · category: select [starters, mains, breads, rice, desserts, drinks] · price: money · veg: select [veg, non-veg, egg, vegan] · spice: select [mild, medium, hot] · allergens: text · available_today: yes/no (default yes);
  - one per name;
  - guests and waiters look it up.
- **Table orders:**
  - **table**: text · **items**: long text · notes: text · waiter: text · status: select [placed, preparing, served, billed, cancelled];
  - placed → preparing or cancelled; preparing → served; served → billed;
  - waiters add and change; guests never see it.
- **Rooms** (hotels and homestays): **room**: text · type: select [standard, deluxe, suite, dorm bed] · rate: money · capacity: number · features: text.
- **Stays:**
  - **room**: relation → Rooms · **guest**★: relation → contact · **check_in**: date · **check_out**: date · guests: number · status: select [requested, confirmed, checked in, checked out, cancelled];
  - one stay per room per check-in date, not counting cancelled (overlapping nights need a range rule, which comes later: until then the owner confirms each one).
- **Tests** (diagnostic labs): **name**: text · price: money · preparation: long text · report_time: text · home_collection: yes/no.
- **Service jobs** (car and appliance service):
  - **vehicle_or_item**: text · **customer**★: relation → contact · problem: long text · status: select [received, inspecting, waiting for approval, in progress, ready, delivered];
  - transitions in that order, with cancelled possible before "in progress".
- **Leave requests** (internal HR):
  - **employee**★: relation → contact · **from**: date · **to**: date · type: select [casual, sick, earned] · status: select [requested, approved, rejected];
  - staff add their own; only the owner approves.

## The 14 templates

★ marks a staff-facing part that needs 7a. "Later" names the chunk a part waits for; everything else works once 5b and 6 ship.

### 1. Restaurant or café
- **Roles:** guests; ★ waiters; ★ the manager.
- **Guests:** the menu and today's availability, veg and allergen questions ("check with staff" unless the menu states it), opening hours, table reservations (Table reservations), takeaway enquiries (Callback requests).
- **★ Waiters:** "table 4: 2 paneer tikka, 1 dal makhani, less spicy" becomes a table order; "mark the prawn curry sold out" turns off available_today; "what's pending for table 7?".
- **★ The manager:** today's reservations; orders by status.
- **Lists:** Menu, Tables, Reservations, Table orders, Callback requests.
- **Later:** a reservation reminder 2 hours before, and a review request the next day (6F, 10a).
- **Safety:** standard, plus an allergen checkup.

### 2. Cloud kitchen or home bakery
- **Customers:** the menu, prices, service areas and fees ("do you deliver to 411045?"), order status (their own Orders).
- **★ Staff:** move orders from placed to packed to sent.
- **Lists:** Menu (or Products), Orders, Service areas.
- **Later:** "out for delivery" messages (10a); payments (v3).

### 3. Clinic or GP
- **Patients:** hours, doctors, fees from the Price list; booking from Slots (Appointments); "where's my report?" goes to the team.
- **★ The receptionist:** today's appointments; mark visits completed or no-show.
- **Lists:** Slots, Appointments, Price list, Callback requests.
- **Later:** a reminder the day before (6F); approval for late cancellations (14a).
- **Safety:** the medical pack (and the declines fix from the next sprint).

### 4. Therapy or mental-health practice
- **Clients:** the therapists, fees and formats; booking a first session; the crisis reply always comes first.
- **Lists:** Slots, Appointments (notes never from a conversation), Callback requests.
- **Later:** reminders (6F). No reviews are asked for, by design.
- **Safety:** the mental-health pack; `hand_over` on.

### 5. Diagnostic lab
- **Patients:** test prices and preparation ("fasting 10–12 hours"), report times, home collection by pincode, booking a home-collection slot.
- **Lists:** Tests, Service areas, Slots and Appointments.
- **Safety:** the medical pack; never reads a result.

### 6. Salon or spa
- **Clients:** services and prices, booking with a stylist, cancelling their own booking.
- **★ The front desk:** today's bookings.
- **Lists:** Price list, Slots (practitioner = the stylist), Appointments.
- **Later:** reminders, and a review link after a visit (6F).

### 7. Gym or yoga studio
- **Members:** class timetable, booking a class, "when does my membership end?", trial-class leads.
- **★ Trainers:** who's booked into my class.
- **Lists:** Classes, Bookings, Memberships, Leads.
- **Later:** a renewal reminder 5 days before the end (6F).

### 8. Coaching institute
- **Parents and students:** courses, batches, fees, demo classes; admissions enquiries record the parent.
- **★ Counsellors:** move enquiries along.
- **Lists:** Classes (demo batches), Bookings, Admissions enquiries, Price list.
- **Safety:** the young-people pack.

### 9. Real estate
- **Buyers:** listings by area, BHK and budget; booking a site visit; lead capture.
- **★ Agents:** my visits today; mark one done.
- **Lists:** Property listings, Site visits, Leads.
- **Later:** a reminder the evening before a visit (6F).

### 10. Online store (D2C)
- **Customers:** products, prices and stock; "where's my order?"; returns as Support tickets.
- **★ Staff:** update an order's status.
- **Lists:** Products, Orders, Support tickets, Service areas.
- **Later:** shipping updates (10a), payments (v3), broadcasts (v3).

### 11. Pharmacy
- **Customers:** over-the-counter availability and prices, delivery areas, store hours; any dosing question goes to "ask your pharmacist".
- **Lists:** Products, Service areas, Callback requests.
- **Safety:** the pharmacy pack.

### 12. Hotel or homestay
- **Guests:** room types and rates, stay requests, check-in times, local information.
- **★ The front desk:** confirm stays; today's check-ins.
- **Lists:** Rooms, Stays, Callback requests.
- **Later:** a pre-arrival message (6F), approval of stay requests (14a).

### 13. Car or appliance service centre
- **Customers:** service prices, booking a service slot, "is my car ready?" (their own Service jobs).
- **★ Mechanics:** move a job along; "waiting for approval" tells the customer the estimate.
- **Lists:** Price list, Slots, Appointments, Service jobs.
- **Later:** the "ready for pickup" message (10a).

### 14. Internal HR helpdesk (staff only)
- **★ Employees:** policies from the documents; "apply for leave on the 20th"; "how many leaves do I have?" (once a balance list exists).
- **★ The HR manager:** approves leave.
- **Lists:** Leave requests, Support tickets (as HR tickets).
- **Safety:** standard; personal data stays with the employee.

## What ships when

| Stage | What works |
|---|---|
| **After 5b and 6 (this sprint)** | The customer-facing side of templates 2–6, 7, 9 and 11, through ready-made lists installed one at a time. Templates 1, 8, 10, 12 and 13 work for customers only |
| **7a Roles, light (next sprint)** | Waiters, receptionists, agents, trainers and HR: the ★ parts |
| **6F and 10a (next sprint)** | Reminders, review requests, order and job updates |
| **14a (next sprint)** | Approvals: late cancellations, stay requests, leave |
| **18a Templates, light (P1)** | One-click install of a whole template (roles, pages, lists, abilities, follow-ups, checkups and safety pack), and "Save as template" from any assistant |
