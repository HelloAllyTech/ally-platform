import { ListFieldType } from '../enum/list.enum';
import {
  listBuilders as b,
  READY_MADE,
  type ReadyMadeList,
} from '../lists/ready-made-lists';

/**
 * The lists only a use-case template installs (T1, `docs/agents-v2/T1-TEMPLATE-TEXTS.md`, "New
 * lists"). Same field types and rules as the ready-made catalogue; they don't appear in its picker.
 */
const { field, text, select, examples, relation, status, money } = b;
const { unique, perPerson, capacity, moves, required, agent } = b;
const long = (key: string, label: string, extra = {}) =>
  field(key, label, ListFieldType.LONG_TEXT, extra);
const phone = (key: string, label: string, extra = {}) =>
  field(key, label, ListFieldType.PHONE, extra);

export const TEMPLATE_LISTS: ReadyMadeList[] = [
  {
    key: 'services',
    name: 'Services',
    agent_read: true,
    settings: { title_field: 'name', default_sort: 'name' },
    fields: [
      text('name', 'Name', required),
      text('who_its_for', 'Who it’s for', required),
      long('documents_to_bring', 'Documents to bring'),
      text('where', 'Where'),
      text('hours', 'Hours'),
      text('cost', 'Cost'),
    ],
    rules: [unique(['name'])],
  },
  {
    key: 'service_locations',
    name: 'Service locations',
    agent_read: true,
    settings: { title_field: 'name', default_sort: 'name' },
    fields: [
      text('name', 'Name', required),
      text('address', 'Address', required),
      text('area', 'Area'),
      text('hours', 'Hours'),
      phone('phone', 'Phone'),
    ],
    rules: [unique(['name'])],
  },
  {
    key: 'applications',
    name: 'Applications',
    agent_read: true,
    settings: { title_field: 'name', person_field: 'applicant' },
    fields: [
      text('name', 'Name', { ...required, ...agent }),
      phone('phone', 'Phone', { ...required, ...agent }),
      relation('applicant', 'Applicant', 'contact', required),
      examples('service', 'Service', ['Service 1', 'Service 2'], agent),
      text('preferred_centre', 'Preferred centre', agent),
      status(['received', 'in review', 'completed', 'closed']),
    ],
    rules: [
      perPerson('applicant', 3, ['received', 'in review']),
      moves(
        {
          received: ['in review', 'closed'],
          'in review': ['completed', 'closed'],
        },
        'received',
      ),
    ],
  },
  {
    key: 'volunteer_signups',
    name: 'Volunteer sign-ups',
    agent_read: true,
    settings: { title_field: 'name', person_field: 'volunteer' },
    fields: [
      text('name', 'Name', { ...required, ...agent }),
      phone('phone', 'Phone', { ...required, ...agent }),
      relation('volunteer', 'Volunteer', 'contact', required),
      field('email', 'Email', ListFieldType.EMAIL, agent),
      examples(
        'interests',
        'Interests',
        ['Events', 'Teaching', 'Office help'],
        agent,
      ),
      select(
        'availability',
        'Availability',
        ['weekdays', 'weekends', 'evenings', 'any time'],
        agent,
      ),
      status(['new', 'contacted', 'active', 'not now']),
    ],
    rules: [
      perPerson('volunteer', 1, ['new', 'contacted']),
      moves(
        { new: ['contacted', 'not now'], contacted: ['active', 'not now'] },
        'new',
      ),
    ],
  },
  {
    key: 'volunteer_shifts',
    name: 'Volunteer shifts',
    agent_read: true,
    settings: { title_field: 'name', default_sort: 'starts_at' },
    fields: [
      text('name', 'Name', required),
      field('starts_at', 'Time', ListFieldType.DATETIME, required),
      text('place', 'Place'),
      field('places', 'Places', ListFieldType.NUMBER, { default: 10 }),
    ],
  },
  {
    key: 'shift_bookings',
    name: 'Shift bookings',
    agent_read: true,
    settings: { title_field: 'shift', person_field: 'volunteer' },
    fields: [
      relation('shift', 'Shift', 'volunteer_shifts', {
        ...required,
        ...agent,
      }),
      relation('volunteer', 'Volunteer', 'contact', required),
      status(['booked', 'attended', 'cancelled'], agent),
    ],
    rules: [
      capacity('shift', 'places', ['cancelled']),
      unique(['shift', 'volunteer'], ['cancelled']),
      moves({ booked: ['attended', 'cancelled'] }, 'booked'),
    ],
  },
  {
    key: 'donor_enquiries',
    name: 'Donor enquiries',
    agent_read: true,
    settings: { title_field: 'question', person_field: 'donor' },
    fields: [
      text('name', 'Name', { ...required, ...agent }),
      text('contact', 'Phone or email', { ...required, ...agent }),
      relation('donor', 'Donor', 'contact', required),
      long('question', 'Question', { ...required, ...agent }),
      select(
        'about',
        'About',
        ['a receipt', 'how to give', 'a regular gift', 'something else'],
        agent,
      ),
      status(['new', 'answered', 'closed']),
    ],
    rules: [
      perPerson('donor', 3, ['new']),
      moves({ new: ['answered', 'closed'], answered: ['closed'] }, 'new'),
    ],
  },
  {
    key: 'ways_to_give',
    name: 'Ways to give',
    agent_read: true,
    settings: { title_field: 'method', default_sort: 'method' },
    fields: [
      text('method', 'Method', required),
      long('how', 'How'),
      long('tax_exemption', 'Tax exemption'),
      money('minimum', 'Minimum'),
    ],
    rules: [unique(['method'])],
  },
  {
    key: 'team_questions',
    name: 'Questions for the team',
    agent_read: true,
    settings: { title_field: 'question', person_field: 'asker' },
    fields: [
      long('question', 'Question', { ...required, ...agent }),
      relation('asker', 'Asked by', 'contact', required),
      text('topic', 'Topic', agent),
      status(['new', 'answered']),
    ],
    rules: [
      perPerson('asker', 5, ['new']),
      moves({ new: ['answered'] }, 'new'),
    ],
  },
  {
    key: 'updates',
    name: 'Updates',
    agent_read: true,
    settings: { title_field: 'title', default_sort: '-date' },
    fields: [
      text('title', 'Title', required),
      field('date', 'Date', ListFieldType.DATE, required),
      long('what_changed', 'What changed', required),
      text('who_it_affects', 'Who it affects'),
      field('until', 'Until', ListFieldType.DATE),
    ],
  },
];

/** A list's definition by key: a ready-made one or a template-only one. */
export function listDefinition(key: string): ReadyMadeList | undefined {
  return (
    READY_MADE.flatMap((item) => item.lists).find((l) => l.key === key) ??
    TEMPLATE_LISTS.find((l) => l.key === key)
  );
}
