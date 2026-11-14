import { ListFieldType } from '../../enum/list.enum';
import type { ListDefinitionView } from '../../lists/list-definitions.service';
import { listInputFor, READY_MADE } from '../../lists/ready-made-lists';
import { datedLists, listToolDefinitions } from '../list-tools';

/** A ready-made list as the owner API would return it, with the agent's write switch on. */
function view(key: string): ListDefinitionView {
  const list = READY_MADE.flatMap((item) => item.lists).find(
    (l) => l.key === key,
  )!;
  const input = listInputFor(list);
  return {
    id: `id-${key}`,
    key,
    name: input.name,
    settings: input.settings ?? {},
    agent_read: true,
    agent_write: true,
    deleted_at: null,
    record_count: 0,
    fields: input.fields!.map((f, position) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options ?? {},
      required: !!f.required,
      default: f.default ?? null,
      privacy: f.privacy ?? {},
      agent_read: f.agent_read ?? true,
      agent_write: !!f.agent_write,
      position,
      archived_at: null,
    })),
    rules: [],
  };
}

const ALL = READY_MADE.flatMap((item) => item.lists).map((l) => view(l.key));
const dated = datedLists(ALL);
const createOf = (key: string) =>
  listToolDefinitions(view(key), new Map(), dated).find(
    (d) => d.kind === 'create',
  )!.input_schema.properties;

/**
 * 5b §9: the confirmed-time check runs on every field ally-be marks, so marks come from the
 * definition: a writable relation to a list with a date and time, and a date and time the
 * assistant fills in itself. A list made from scratch is marked the same way.
 */
describe('which writes check the confirmed day and time (5b §9)', () => {
  it.each([
    ['appointments', 'slot', 'slots'],
    ['reservations', 'table_slot', 'tables'],
    ['bookings', 'class', 'classes'],
    ['registrations', 'event', 'events'],
  ])('%s → %s is a dated relation', (list, field, target) => {
    expect(createOf(list)[field]).toMatchObject({
      relation: target,
      dated: 'datetime',
    });
  });

  it("marks Site visits' own time, and not its listing (a listing has no time)", () => {
    const props = createOf('site_visits');
    expect(props.at).toMatchObject({ dated: 'datetime' });
    expect(props.at.relation).toBeUndefined();
    expect(props.listing).toMatchObject({ relation: 'property_listings' });
    expect(props.listing.dated).toBeUndefined();
  });

  it('marks nothing else in the catalogue', () => {
    const marked = ALL.flatMap((list) =>
      Object.entries(
        listToolDefinitions(list, new Map(), dated).find(
          (d) => d.kind === 'create',
        )?.input_schema.properties ?? {},
      )
        .filter(([, p]) => p.dated)
        .map(([key]) => `${list.key}.${key}`),
    );
    expect(marked.sort()).toEqual(
      [
        'appointments.slot',
        'bookings.class',
        'registrations.event',
        'reservations.table_slot',
        'site_visits.at',
      ].sort(),
    );
  });

  it('marks a list made from scratch the same way, a date and time winning over a date', () => {
    const made: ListDefinitionView = {
      ...view('slots'),
      key: 'sessions',
      name: 'Sessions',
      fields: [
        {
          ...view('slots').fields[0],
          key: 'day',
          type: ListFieldType.DATE,
        },
        ...view('slots').fields,
      ],
    };
    expect(datedLists([made]).get('sessions')).toBe('datetime');
  });
});
