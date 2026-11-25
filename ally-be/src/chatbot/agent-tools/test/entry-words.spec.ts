import { headlineFor } from '../entry-words';
import { cardOf } from '../list-tools.service';

describe('the card headline follows the list (Q4 G5)', () => {
  it.each([
    [
      { key: 'callback_requests', name: 'Callback requests' },
      false,
      'callback',
    ],
    [{ key: 'registrations', name: 'Registrations' }, true, 'registered'],
    [
      { key: 'volunteer_signups', name: 'Volunteer sign-ups' },
      false,
      'registered',
    ],
    [{ key: 'applications', name: 'Applications' }, false, 'application'],
    [{ key: 'appointments', name: 'Appointments' }, true, 'booked'],
    [{ key: 'donor_enquiries', name: 'Donor enquiries' }, false, 'sent'],
  ])('%j', (list, booking, headline) => {
    expect(headlineFor(list, 'create', booking)).toBe(headline);
  });

  it('a cancel and a change say so', () => {
    const list = { key: 'appointments', name: 'Appointments' };
    expect(headlineFor(list, 'cancel', true)).toBe('cancelled');
    expect(headlineFor(list, 'update', true)).toBe('changed');
  });
});

describe('an unconfirmed card shows no status (TF1 round 2, Sahyog P2)', () => {
  const list = {
    key: 'applications',
    name: 'Applications',
    settings: { title_field: 'name', person_field: 'applicant' },
    fields: [
      { key: 'name', label: 'Applicant', type: 'text', agent_read: true },
      { key: 'service', label: 'Service', type: 'select', agent_read: true },
      { key: 'status', label: 'Status', type: 'select', agent_read: true },
    ],
  } as never;
  const record = {
    id: 'app-1',
    title: 'Ravi Test',
    data: { name: 'Ravi Test', service: 'Aids', status: 'received' },
    display: { name: 'Ravi Test', service: 'Aids', status: 'received' },
  } as never;

  it('leaves the status off the card waiting for a yes, and keeps it on the done card', () => {
    const offer = cardOf(list, record, {}, 'create', { unconfirmed: true });
    expect(offer.details.map((d) => d.label)).toEqual(['Service']);
    const done = cardOf(list, record, {}, 'create');
    expect(done.details.map((d) => d.label)).toEqual(['Service', 'Status']);
  });
});
