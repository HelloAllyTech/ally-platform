import { lockOrder, ruleLock, takeLocks, valueLock } from '../list-locks';
import { LIST_COPY } from '../list-refusals';

describe('list locks (chunk 5a)', () => {
  it('takes list-wide keys first, then value keys, each sorted, exclusive winning over shared', () => {
    const order = lockOrder([
      { key: valueLock('b', 'x'), shared: false },
      { key: ruleLock('b'), shared: true },
      { key: valueLock('a', '2026-11-20T11:15:00+05:30'), shared: false },
      { key: ruleLock('a'), shared: true },
      { key: ruleLock('a'), shared: false },
    ]);
    expect(order).toEqual([
      { key: 'lists:a', shared: false },
      { key: 'lists:b', shared: true },
      { key: 'lists:a:"2026-11-20T11:15:00+05:30"', shared: false },
      { key: 'lists:b:"x"', shared: false },
    ]);
  });

  it('gives two writes the same order whatever order they asked in', () => {
    const asked = [
      { key: valueLock('r1', 's1'), shared: false },
      { key: valueLock('r2', 'c1'), shared: false },
      { key: ruleLock('r1'), shared: true },
      { key: ruleLock('r2'), shared: true },
    ];
    expect(lockOrder([...asked].reverse())).toEqual(lockOrder(asked));
  });

  it('uses the transaction-scoped advisory locks', async () => {
    const query = jest.fn();
    await takeLocks({ query } as never, [
      { key: valueLock('r', 'v'), shared: false },
      { key: ruleLock('r'), shared: true },
    ]);
    expect(query.mock.calls).toEqual([
      ['SELECT pg_advisory_xact_lock_shared(hashtext($1))', ['lists:r']],
      ['SELECT pg_advisory_xact_lock(hashtext($1))', ['lists:r:"v"']],
    ]);
  });
});

describe('copy deck §26', () => {
  it('reads as written', () => {
    expect(LIST_COPY.required_missing('Slot')).toBe('Slot is needed.');
    expect(LIST_COPY.invalid_value('Email', "it isn't an email address")).toBe(
      "Email isn't valid: it isn't an email address.",
    );
    expect(LIST_COPY.not_writable('Client')).toBe(
      "Client can't be changed here.",
    );
    expect(LIST_COPY.unique_taken('Slot')).toBe('That slot is already taken.');
    expect(LIST_COPY.capacity_full('Morning yoga')).toBe(
      'Morning yoga is full.',
    );
    expect(LIST_COPY.limit_reached(2, 'Appointments')).toBe(
      'This person already has 2 appointments.',
    );
    expect(
      LIST_COPY.transition_not_allowed('Appointments', 'booked', 'completed'),
    ).toBe("Appointments can't go from booked to completed.");
    expect(LIST_COPY.not_found()).toBe("That entry doesn't exist any more.");
    expect(LIST_COPY.version_conflict()).toBe(
      'Someone changed this entry just now. Reload and try again.',
    );
    expect(LIST_COPY.limit_exceeded('50 lists')).toBe(
      'This would go over the limit of 50 lists.',
    );
  });

  it('words in_use as the 5b brief does', () => {
    expect(LIST_COPY.in_use(3, 'Appointments')).toBe(
      '3 entries in Appointments use this. Cancel or move them first.',
    );
    expect(LIST_COPY.in_use(1, 'Appointments')).toBe(
      '1 entry in Appointments uses this. Cancel or move it first.',
    );
  });
});
