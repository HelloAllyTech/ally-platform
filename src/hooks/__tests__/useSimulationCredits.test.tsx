import {act, renderHook} from '@testing-library/react-native';

import {useSimulationCredits} from '../useSimulationCredits';

const mockDispatch = jest.fn();
const mockGetSimulationCredits = jest.fn();
const mockPermission = 'edit:scenario-session';

jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (sel: any) =>
    sel({
      credits: {credits: {creditLimit: 10, consumedCredits: 9, secondsAllowedPerCredit: 60}},
      user: {permissions: [mockPermission]},
    }),
}));

jest.mock('@/store/slices/creditsSlice', () => ({
  clearCredits: () => ({type: 'clearCredits'}),
  setCredits: (p: any) => ({type: 'setCredits', payload: p}),
}));

jest.mock('@/services', () => ({
  useLazyGetSimulationCreditsQuery: () => [mockGetSimulationCredits, {data: {creditLimit: 10, consumedCredits: 5, secondsAllowedPerCredit: 60}}],
}));

describe('useSimulationCredits', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockGetSimulationCredits.mockClear();
  });

  it('fetches when permission present and exposes computed info', async () => {
    const {result} = renderHook(() => useSimulationCredits());
    await act(async () => {});
    await expect(mockGetSimulationCredits).toHaveBeenCalled();
    // setCredits dispatched due to creditsData
    expect(mockDispatch).toHaveBeenCalledWith({type: 'setCredits', payload: {creditLimit: 10, consumedCredits: 5, secondsAllowedPerCredit: 60}});
    // computed from selector credits: 9/10 => 90%, low (< auto end threshold)
    expect(result.current.getCreditsInfo).toEqual({usagePercentage: 90, isLow: true});
  });

  // Additional permission-absent scenarios are verified in slice tests; keep this suite focused and deterministic.
});

