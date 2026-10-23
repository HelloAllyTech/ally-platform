/**
 * Mirrors the web useScribeNoteCreationEnabled tests: the RTK query must be
 * skipped unless the user holds the counsellor permission (the endpoint 403s
 * otherwise), and an explicit caller-provided skip is always honoured.
 */
const mockQuery = jest.fn();
let mockPermissions: string[] = [];

jest.mock('@/services/settingsApi', () => ({
  useGetScribeNoteCreationEnabledQuery: (arg: unknown, opts: unknown) =>
    mockQuery(arg, opts),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({user: {permissions: mockPermissions}}),
}));

import React from 'react';
import {render} from '@testing-library/react-native';

import {useScribeNoteCreationEnabled} from '../useScribeNoteCreationEnabled';

const Probe = ({skip}: {skip?: boolean}) => {
  useScribeNoteCreationEnabled(skip === undefined ? undefined : {skip});
  return null;
};

describe('useScribeNoteCreationEnabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReturnValue({data: undefined});
  });

  it('queries (skip: false) when the user has counsellor access', () => {
    mockPermissions = ['counselor:access'];
    render(<Probe />);
    expect(mockQuery).toHaveBeenCalledWith(undefined, {skip: false});
  });

  it('skips the query when the user is not a counsellor', () => {
    mockPermissions = ['view:call:logs'];
    render(<Probe />);
    expect(mockQuery).toHaveBeenCalledWith(undefined, {skip: true});
  });

  it('honours an explicit skip even for a counsellor', () => {
    mockPermissions = ['counselor:access'];
    render(<Probe skip />);
    expect(mockQuery).toHaveBeenCalledWith(undefined, {skip: true});
  });
});
