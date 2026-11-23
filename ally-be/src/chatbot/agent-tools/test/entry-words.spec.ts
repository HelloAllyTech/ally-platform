import { headlineFor } from '../entry-words';

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
