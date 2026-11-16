import { ListConstraintKind, ListFieldType } from '../enum/list.enum';
import type {
  ListFieldInput,
  ListInput,
  ListRuleInput,
} from './list-definitions.service';

/**
 * The ready-made lists (chunk 5b): `docs/agents-v2/READY-MADE-LISTS.md`, word for word, as data.
 * An owner installs one from the assistant's home; `npm run lists:seed` builds its clinic lists
 * from the same definitions. Nothing here is code per business.
 */

/** A field the catalogue marks "never from a conversation" only on a health assistant. */
export interface ReadyMadeField extends ListFieldInput {
  /** On the medical, pharmacy and mental-health packs: never_store, and not required. */
  health_never_store?: boolean;
  /** A "your services" select: these are example values, for the owner to replace. */
  example_options?: boolean;
}

export interface ReadyMadeList extends Omit<ListInput, 'fields'> {
  fields: ReadyMadeField[];
  rules?: ListRuleInput[];
}

export interface ReadyMadeItem {
  /** The catalogue word, as the install route takes it. */
  name: string;
  title: string;
  group: string;
  one_liner: string;
  /** What a customer can ask, from the catalogue. */
  examples: string[];
  /** Installed in this order: a list another one points at comes first. */
  lists: ReadyMadeList[];
}

export const READY_MADE_GROUPS = [
  'Appointments and visits',
  'Classes and events',
  'Sales and enquiries',
  'Shops and orders',
  'Services and support',
] as const;

/** The packs whose free-text fields that could hold symptoms are never from a conversation. */
export const HEALTH_PACKS = new Set(['medical', 'pharmacy', 'mental_health']);

// ---- small builders ------------------------------------------------------------------------------

type Extra = Partial<ReadyMadeField>;
const field = (
  key: string,
  label: string,
  type: ListFieldType,
  extra: Extra = {},
): ReadyMadeField => ({ key, label, type, ...extra });
const text = (key: string, label: string, extra: Extra = {}) =>
  field(key, label, ListFieldType.TEXT, extra);
const select = (
  key: string,
  label: string,
  values: string[],
  extra: Extra = {},
) => field(key, label, ListFieldType.SELECT, { options: { values }, ...extra });
const examples = (
  key: string,
  label: string,
  values: string[],
  extra: Extra = {},
) => select(key, label, values, { example_options: true, ...extra });
const relation = (key: string, label: string, to: string, extra: Extra = {}) =>
  field(key, label, ListFieldType.RELATION, { options: { to }, ...extra });
/** A status select: a new entry starts in the first status. */
const status = (values: string[], extra: Extra = {}) =>
  select('status', 'Status', values, { default: values[0], ...extra });
const yesNo = (key: string, label: string, extra: Extra = {}) =>
  field(key, label, ListFieldType.BOOLEAN, { default: true, ...extra });
const money = (key: string, label: string, extra: Extra = {}) =>
  field(key, label, ListFieldType.MONEY, {
    options: { currency: 'INR' },
    ...extra,
  });

const NEVER_FROM_CHAT = { never_store: true };
const required = { required: true };
/** The assistant may fill this in, once the owner turns Add or Change on. */
const agent = { agent_write: true };

const unique = (fields: string[], notCounting?: string[]): ListRuleInput => ({
  kind: ListConstraintKind.UNIQUE,
  config: {
    fields,
    ...(notCounting ? { where: { field: 'status', not_in: notCounting } } : {}),
  },
});
const perPerson = (
  field: string,
  max: number,
  whileIn: string[],
): ListRuleInput => ({
  kind: ListConstraintKind.LIMIT_PER_PERSON,
  config: { field, max, where: { field: 'status', in: whileIn } },
});
const capacity = (
  field: string,
  maxFrom: string,
  notCounting: string[],
): ListRuleInput => ({
  kind: ListConstraintKind.CAPACITY,
  config: {
    field,
    max_from: maxFrom,
    where: { field: 'status', not_in: notCounting },
  },
});
const moves = (
  allowed: Record<string, string[]>,
  initial: string,
): ListRuleInput => ({
  kind: ListConstraintKind.TRANSITIONS,
  config: { field: 'status', initial: [initial], allowed },
});

const SERVICES = ['Consultation', 'Follow-up', 'Check-up'];
/** Appointments' examples: the seed's, which 5a and 6's specs book with. */
const APPOINTMENT_SERVICES = [
  'Individual therapy',
  'Couples therapy',
  'Family therapy',
];

// ---- the catalogue -------------------------------------------------------------------------------

export const READY_MADE: ReadyMadeItem[] = [
  // Appointments and visits
  {
    name: 'appointments',
    title: 'Appointments',
    group: 'Appointments and visits',
    one_liner: 'For clinics, therapists, salons and consultants.',
    examples: [
      'What’s free on Thursday?',
      'Book 11:00',
      'Cancel my appointment.',
    ],
    lists: [
      {
        key: 'slots',
        name: 'Slots',
        agent_read: true,
        settings: { title_field: 'starts_at', default_sort: 'starts_at' },
        // The seed's order, which 6's tool descriptions and passages read in.
        fields: [
          text('practitioner', 'Practitioner'),
          field('starts_at', 'Time', ListFieldType.DATETIME, required),
          field('duration', 'Duration', ListFieldType.DURATION, {
            default: 50,
          }),
          yesNo('open', 'Open'),
        ],
      },
      {
        key: 'appointments',
        name: 'Appointments',
        agent_read: true,
        settings: { title_field: 'slot', person_field: 'client' },
        fields: [
          relation('slot', 'Slot', 'slots', { ...required, ...agent }),
          relation('client', 'Client', 'contact', required),
          examples('service', 'Service', APPOINTMENT_SERVICES, agent),
          status(
            ['booked', 'confirmed', 'completed', 'cancelled', 'no_show'],
            agent,
          ),
          field('notes', 'Notes', ListFieldType.LONG_TEXT, {
            privacy: NEVER_FROM_CHAT,
          }),
        ],
        rules: [
          unique(['slot'], ['cancelled']),
          perPerson('client', 2, ['booked', 'confirmed']),
          moves(
            {
              booked: ['confirmed', 'cancelled'],
              confirmed: ['completed', 'cancelled', 'no_show'],
            },
            'booked',
          ),
        ],
      },
    ],
  },
  {
    name: 'site_visits',
    title: 'Site visits',
    group: 'Appointments and visits',
    one_liner: 'For real estate agents and builders.',
    examples: [
      '2BHK in Baner under 85 lakh',
      'Can I see it on Saturday at 11?',
    ],
    lists: [
      {
        key: 'property_listings',
        name: 'Property listings',
        agent_read: true,
        settings: { title_field: 'title', default_sort: 'price' },
        fields: [
          text('title', 'Title', required),
          text('area', 'Area', required),
          select('bhk', 'BHK', [
            '1 RK',
            '1 BHK',
            '2 BHK',
            '3 BHK',
            '4+ BHK',
            'Plot',
            'Shop',
            'Office',
          ]),
          money('price', 'Price'),
          field('size_sqft', 'Size (sq ft)', ListFieldType.NUMBER),
          select('for', 'For', ['sale', 'rent']),
          status(['available', 'on hold', 'sold', 'rented']),
        ],
        rules: [
          moves(
            {
              available: ['on hold', 'sold', 'rented'],
              'on hold': ['available', 'sold', 'rented'],
            },
            'available',
          ),
        ],
      },
      {
        key: 'site_visits',
        name: 'Site visits',
        agent_read: true,
        settings: {
          title_field: 'at',
          default_sort: 'at',
          person_field: 'visitor',
        },
        fields: [
          relation('listing', 'Listing', 'property_listings', {
            ...required,
            ...agent,
          }),
          relation('visitor', 'Visitor', 'contact', required),
          field('at', 'At', ListFieldType.DATETIME, { ...required, ...agent }),
          status(['requested', 'confirmed', 'done', 'cancelled'], agent),
        ],
        rules: [
          unique(['listing', 'at'], ['cancelled']),
          perPerson('visitor', 3, ['requested', 'confirmed']),
          moves(
            {
              requested: ['confirmed', 'cancelled'],
              confirmed: ['done', 'cancelled'],
            },
            'requested',
          ),
        ],
      },
    ],
  },
  {
    name: 'table_reservations',
    title: 'Table reservations',
    group: 'Appointments and visits',
    one_liner: 'For restaurants and cafés.',
    examples: ['A table for 4 tomorrow at 8?'],
    lists: [
      {
        key: 'tables',
        name: 'Tables',
        agent_read: true,
        settings: { title_field: 'starts_at', default_sort: 'starts_at' },
        fields: [
          field('starts_at', 'Time', ListFieldType.DATETIME, required),
          text('table', 'Table', required),
          field('seats', 'Seats', ListFieldType.NUMBER),
          yesNo('open', 'Open'),
        ],
      },
      {
        key: 'reservations',
        name: 'Reservations',
        agent_read: true,
        settings: { title_field: 'table_slot', person_field: 'guest' },
        fields: [
          relation('table_slot', 'Table slot', 'tables', {
            ...required,
            ...agent,
          }),
          relation('guest', 'Guest', 'contact', required),
          field('party_size', 'Party size', ListFieldType.NUMBER, agent),
          text('occasion', 'Occasion', agent),
          status(
            ['booked', 'seated', 'completed', 'cancelled', 'no_show'],
            agent,
          ),
        ],
        rules: [
          unique(['table_slot'], ['cancelled']),
          perPerson('guest', 2, ['booked']),
          moves(
            {
              booked: ['seated', 'cancelled', 'no_show'],
              seated: ['completed'],
            },
            'booked',
          ),
        ],
      },
    ],
  },

  // Classes and events
  {
    name: 'classes',
    title: 'Class bookings',
    group: 'Classes and events',
    one_liner: 'For gyms, yoga, dance and coaching batches.',
    examples: ['Is there a beginners’ yoga class on Saturday?', 'Book me in.'],
    lists: [
      {
        key: 'classes',
        name: 'Classes',
        agent_read: true,
        settings: { title_field: 'name', default_sort: 'starts_at' },
        fields: [
          text('name', 'Name', required),
          field('starts_at', 'Time', ListFieldType.DATETIME, required),
          text('teacher', 'Teacher'),
          field('seats', 'Seats', ListFieldType.NUMBER, { default: 20 }),
          select('level', 'Level', [
            'beginner',
            'intermediate',
            'advanced',
            'all',
          ]),
        ],
      },
      {
        key: 'bookings',
        name: 'Bookings',
        agent_read: true,
        settings: { title_field: 'class', person_field: 'member' },
        fields: [
          relation('class', 'Class', 'classes', { ...required, ...agent }),
          relation('member', 'Member', 'contact', required),
          status(['booked', 'attended', 'cancelled'], agent),
        ],
        rules: [
          capacity('class', 'seats', ['cancelled']),
          unique(['class', 'member'], ['cancelled']),
          moves({ booked: ['attended', 'cancelled'] }, 'booked'),
        ],
      },
    ],
  },
  {
    name: 'event_registrations',
    title: 'Event registrations',
    group: 'Classes and events',
    one_liner: 'For workshops, webinars, camps and open days.',
    examples: ['When’s the next workshop?', 'Register me for it.'],
    lists: [
      {
        key: 'events',
        name: 'Events',
        agent_read: true,
        settings: { title_field: 'name', default_sort: 'starts_at' },
        fields: [
          text('name', 'Name', required),
          field('starts_at', 'Time', ListFieldType.DATETIME, required),
          text('venue', 'Venue'),
          field('seats', 'Seats', ListFieldType.NUMBER),
          money('fee', 'Fee'),
          yesNo('registration_open', 'Registration open'),
        ],
      },
      {
        key: 'registrations',
        name: 'Registrations',
        agent_read: true,
        settings: { title_field: 'event', person_field: 'attendee' },
        fields: [
          relation('event', 'Event', 'events', { ...required, ...agent }),
          relation('attendee', 'Attendee', 'contact', required),
          field('guests', 'Guests', ListFieldType.NUMBER, {
            default: 0,
            ...agent,
          }),
          status(['registered', 'attended', 'cancelled'], agent),
        ],
        rules: [
          capacity('event', 'seats', ['cancelled']),
          unique(['event', 'attendee'], ['cancelled']),
          moves({ registered: ['attended', 'cancelled'] }, 'registered'),
        ],
      },
    ],
  },

  // Sales and enquiries
  {
    name: 'leads',
    title: 'Leads',
    group: 'Sales and enquiries',
    one_liner: 'For any business that follows up on enquiries.',
    examples: ['Can someone call me about the 3-month plan?'],
    lists: [
      {
        key: 'leads',
        name: 'Leads',
        // Leads aren't for visitors: look up is off.
        agent_read: false,
        settings: { title_field: 'name' },
        fields: [
          text('name', 'Name', { ...required, ...agent }),
          field('phone', 'Phone', ListFieldType.PHONE, {
            ...required,
            ...agent,
          }),
          field('email', 'Email', ListFieldType.EMAIL, agent),
          examples('interest', 'Interest', SERVICES, agent),
          money('budget', 'Budget', agent),
          select(
            'source',
            'Source',
            ['WhatsApp', 'website', 'walk-in', 'referral', 'other'],
            agent,
          ),
          status(['new', 'contacted', 'qualified', 'won', 'lost']),
          field('notes', 'Notes', ListFieldType.LONG_TEXT),
        ],
        rules: [
          unique(['phone'], ['won', 'lost']),
          moves(
            {
              new: ['contacted', 'lost'],
              contacted: ['qualified', 'lost'],
              qualified: ['won', 'lost'],
            },
            'new',
          ),
        ],
      },
    ],
  },
  {
    name: 'callback_requests',
    title: 'Callback requests',
    group: 'Sales and enquiries',
    one_liner: 'When someone wants the team to call them back.',
    examples: ['Call me back about my bill'],
    lists: [
      {
        key: 'callback_requests',
        name: 'Callback requests',
        agent_read: true,
        settings: { title_field: 'reason', person_field: 'requester' },
        fields: [
          field('phone', 'Phone', ListFieldType.PHONE, {
            ...required,
            ...agent,
          }),
          relation('requester', 'Requester', 'contact', required),
          text('reason', 'Reason', {
            ...required,
            ...agent,
            health_never_store: true,
          }),
          select(
            'preferred_time',
            'Preferred time',
            ['morning', 'afternoon', 'evening', 'any time'],
            agent,
          ),
          status(['requested', 'called', 'closed']),
        ],
        rules: [
          perPerson('requester', 1, ['requested']),
          moves(
            { requested: ['called', 'closed'], called: ['closed'] },
            'requested',
          ),
        ],
      },
    ],
  },
  {
    name: 'admissions_enquiries',
    title: 'Admissions enquiries',
    group: 'Sales and enquiries',
    one_liner: 'For coaching institutes, schools and colleges.',
    examples: ['Do you have a weekend batch for Class 10?'],
    lists: [
      {
        key: 'admissions_enquiries',
        name: 'Admissions enquiries',
        agent_read: true,
        settings: { title_field: 'student_name', person_field: 'parent' },
        fields: [
          text('student_name', 'Student name', { ...required, ...agent }),
          relation('parent', 'Parent', 'contact', required),
          field('phone', 'Phone', ListFieldType.PHONE, {
            ...required,
            ...agent,
          }),
          select(
            'grade',
            'Grade',
            ['Class 6–8', 'Class 9–10', 'Class 11–12', 'Graduate', 'Other'],
            agent,
          ),
          examples(
            'course',
            'Course',
            ['Foundation course', 'Board exam batch', 'Crash course'],
            agent,
          ),
          select(
            'preferred_batch',
            'Preferred batch',
            ['morning', 'afternoon', 'evening', 'weekend'],
            agent,
          ),
          status(['new', 'counselled', 'enrolled', 'not joining']),
        ],
        rules: [
          perPerson('parent', 3, ['new', 'counselled']),
          moves(
            {
              new: ['counselled', 'not joining'],
              counselled: ['enrolled', 'not joining'],
            },
            'new',
          ),
        ],
      },
    ],
  },

  // Shops and orders
  {
    name: 'products',
    title: 'Products',
    group: 'Shops and orders',
    one_liner:
      'For shops, pharmacies (non-prescription items only) and bakeries.',
    examples: ['Do you have whole-wheat bread? How much?'],
    lists: [
      {
        key: 'products',
        name: 'Products',
        agent_read: true,
        settings: { title_field: 'name', default_sort: 'name' },
        fields: [
          text('name', 'Name', required),
          examples('category', 'Category', ['Bakery', 'Snacks', 'Drinks']),
          money('price', 'Price'),
          yesNo('in_stock', 'In stock'),
          field('stock', 'Stock', ListFieldType.NUMBER),
          field('description', 'Description', ListFieldType.LONG_TEXT),
          text('sku', 'SKU'),
        ],
        rules: [unique(['sku'])],
      },
    ],
  },
  {
    name: 'orders',
    title: 'Orders',
    group: 'Shops and orders',
    one_liner: 'For shops that take orders on WhatsApp.',
    examples: ['Where’s my order?'],
    lists: [
      {
        key: 'orders',
        name: 'Orders',
        agent_read: true,
        settings: { title_field: 'number', person_field: 'customer' },
        fields: [
          text('number', 'Number', required),
          relation('customer', 'Customer', 'contact', required),
          field('items', 'Items', ListFieldType.LONG_TEXT, {
            ...required,
            ...agent,
          }),
          money('total', 'Total'),
          field(
            'delivery_address',
            'Delivery address',
            ListFieldType.LONG_TEXT,
            agent,
          ),
          status(['placed', 'packed', 'sent', 'delivered', 'cancelled']),
        ],
        rules: [
          unique(['number']),
          moves(
            {
              placed: ['packed', 'cancelled'],
              packed: ['sent', 'cancelled'],
              sent: ['delivered'],
            },
            'placed',
          ),
        ],
      },
    ],
  },
  {
    name: 'service_areas',
    title: 'Service areas',
    group: 'Shops and orders',
    one_liner: 'For delivery and home services.',
    examples: ['Do you deliver to 411045?'],
    lists: [
      {
        key: 'service_areas',
        name: 'Service areas',
        agent_read: true,
        settings: { title_field: 'area', default_sort: 'pincode' },
        fields: [
          text('pincode', 'Pincode', required),
          text('area', 'Area', required),
          yesNo('delivers', 'Delivers'),
          money('delivery_fee', 'Delivery fee'),
          money('min_order', 'Minimum order'),
          text('eta', 'Delivery time'),
        ],
        rules: [unique(['pincode'])],
      },
    ],
  },

  // Services and support
  {
    name: 'price_list',
    title: 'Price list',
    group: 'Services and support',
    one_liner: 'Your services and prices, answered the same way every time.',
    examples: ['How much is a haircut?'],
    lists: [
      {
        key: 'price_list',
        name: 'Price list',
        agent_read: true,
        settings: { title_field: 'service', default_sort: 'service' },
        fields: [
          text('service', 'Service', required),
          money('price', 'Price'),
          field('duration', 'Duration', ListFieldType.DURATION),
          examples('category', 'Category', ['Popular', 'Packages', 'Add-ons']),
          field('description', 'Description', ListFieldType.LONG_TEXT),
          yesNo('available', 'Available'),
        ],
        rules: [unique(['service'])],
      },
    ],
  },
  {
    name: 'support_tickets',
    title: 'Support tickets',
    group: 'Services and support',
    one_liner: 'For any business with after-sales questions.',
    examples: ['Any update on my complaint?'],
    lists: [
      {
        key: 'support_tickets',
        name: 'Support tickets',
        agent_read: true,
        settings: { title_field: 'subject', person_field: 'customer' },
        fields: [
          text('subject', 'Subject', { ...required, ...agent }),
          relation('customer', 'Customer', 'contact', required),
          field('details', 'Details', ListFieldType.LONG_TEXT, {
            ...agent,
            health_never_store: true,
          }),
          select('priority', 'Priority', ['low', 'normal', 'urgent'], {
            default: 'normal',
            ...agent,
          }),
          text('order_ref', 'Order reference', agent),
          status(['open', 'in progress', 'resolved', 'closed']),
        ],
        rules: [
          perPerson('customer', 3, ['open', 'in progress']),
          moves(
            {
              open: ['in progress', 'closed'],
              'in progress': ['resolved'],
              resolved: ['closed', 'open'],
            },
            'open',
          ),
        ],
      },
    ],
  },
  {
    name: 'memberships',
    title: 'Memberships',
    group: 'Services and support',
    one_liner: 'For gyms, clubs and subscription services.',
    examples: ['When does my membership end?'],
    lists: [
      {
        key: 'memberships',
        name: 'Memberships',
        agent_read: true,
        settings: {
          title_field: 'plan',
          default_sort: 'ends_on',
          person_field: 'member',
        },
        // The team manages memberships: nothing here is for the assistant to fill in.
        fields: [
          relation('member', 'Member', 'contact', required),
          examples(
            'plan',
            'Plan',
            ['Monthly', 'Quarterly', 'Yearly'],
            required,
          ),
          field('starts_on', 'Starts on', ListFieldType.DATE, required),
          field('ends_on', 'Ends on', ListFieldType.DATE),
          status(['active', 'paused', 'expired', 'cancelled']),
          field('sessions_left', 'Sessions left', ListFieldType.NUMBER),
        ],
        rules: [
          unique(['member'], ['expired', 'cancelled']),
          moves(
            {
              active: ['paused', 'expired', 'cancelled'],
              paused: ['active', 'cancelled'],
            },
            'active',
          ),
        ],
      },
    ],
  },
];

export const readyMade = (name: string): ReadyMadeItem | undefined =>
  READY_MADE.find((item) => item.name === name);

/**
 * A ready-made list's definition for the engine: the catalogue's own markers resolved for this
 * bot. On a health pack, a field that could hold symptoms is never from a conversation (and so
 * not required, since the assistant couldn't fill it in).
 */
export function listInputFor(
  list: ReadyMadeList,
  {
    health = false,
    options,
  }: {
    health?: boolean;
    options?: Record<string, string[]>;
  } = {},
): ListInput & { rules: ListRuleInput[] } {
  const fields: ListFieldInput[] = list.fields.map(
    ({ health_never_store, example_options, ...f }) => {
      const out: ListFieldInput = { ...f };
      if (example_options && options?.[f.key]?.length) {
        out.options = { values: options[f.key] };
      }
      if (health && health_never_store) {
        out.privacy = { ...(f.privacy ?? {}), never_store: true };
        out.required = false;
        out.agent_write = false;
      }
      return out;
    },
  );
  const { rules = [], ...rest } = list;
  return { ...rest, fields, rules };
}

/** The selects that install with example values, for the "Make it yours" step. */
export function exampleOptions(
  item: ReadyMadeItem,
): { list: string; field: string; label: string; examples: string[] }[] {
  return item.lists.flatMap((list) =>
    list.fields
      .filter((f) => f.example_options)
      .map((f) => ({
        list: list.key,
        field: f.key,
        label: f.label,
        examples: (f.options?.values as string[]) ?? [],
      })),
  );
}
