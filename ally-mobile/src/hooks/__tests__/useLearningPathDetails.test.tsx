import {act, renderHook} from '@testing-library/react-native';

import {LearningPathType} from '@/constants';
import {
  useCreateCaseSessionMutation,
  useCreatePathSessionMutation,
  useGetCaseDetailsQuery,
  useGetSimulationPathDetailsQuery,
} from '@/services';

import {useLearningPathDetails} from '../useLearningPathDetails';

jest.mock('@/constants', () => ({
  LearningPathType: {TRACK: 'track', CASE: 'case'},
}));

const refetchTrack = jest.fn().mockResolvedValue({});
const refetchCase = jest.fn().mockResolvedValue({});

jest.mock('@/services', () => ({
  useGetSimulationPathDetailsQuery: jest.fn(() => ({
    data: {id: '1', name: 'Test Track'},
    isLoading: false,
    error: undefined,
    refetch: jest.fn().mockResolvedValue({}),
  })),
  useGetCaseDetailsQuery: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    error: undefined,
    refetch: jest.fn().mockResolvedValue({}),
  })),
  useCreatePathSessionMutation: jest.fn(() => [
    jest.fn().mockReturnValue({unwrap: jest.fn().mockResolvedValue({})}),
    {isLoading: false},
  ]),
  useCreateCaseSessionMutation: jest.fn(() => [
    jest.fn().mockReturnValue({unwrap: jest.fn().mockResolvedValue({})}),
    {isLoading: false},
  ]),
  useLazyGetScenarioSessionByPathItemQuery: jest.fn(() => [
    jest
      .fn()
      .mockReturnValue({unwrap: jest.fn().mockResolvedValue({id: 'session-1'})}),
  ]),
  useLazyGetScenarioSessionByCaseItemQuery: jest.fn(() => [
    jest
      .fn()
      .mockReturnValue({unwrap: jest.fn().mockResolvedValue({id: 'session-2'})}),
  ]),
}));

describe('useLearningPathDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useGetSimulationPathDetailsQuery as jest.Mock).mockReturnValue({
      data: {id: '1', name: 'Test Track'},
      isLoading: false,
      error: undefined,
      refetch: refetchTrack,
    });
    (useGetCaseDetailsQuery as jest.Mock).mockReturnValue({
      data: {id: '2', name: 'Test Case'},
      isLoading: false,
      error: undefined,
      refetch: refetchCase,
    });
    (useCreatePathSessionMutation as jest.Mock).mockReturnValue([
      jest.fn().mockReturnValue({unwrap: jest.fn().mockResolvedValue({})}),
      {isLoading: false},
    ]);
    (useCreateCaseSessionMutation as jest.Mock).mockReturnValue([
      jest.fn().mockReturnValue({unwrap: jest.fn().mockResolvedValue({})}),
      {isLoading: false},
    ]);
  });

  it('returns track data when type is TRACK', () => {
    const {result} = renderHook(() =>
      useLearningPathDetails({id: 'path-1', type: LearningPathType.TRACK}),
    );

    expect(result.current.data).toEqual({id: '1', name: 'Test Track'});
  });

  it('returns case data when type is CASE', () => {
    const {result} = renderHook(() =>
      useLearningPathDetails({id: 'case-1', type: LearningPathType.CASE}),
    );

    expect(result.current.data).toEqual({id: '2', name: 'Test Case'});
  });

  it('isCreatingSession reflects correct mutation state', () => {
    (useCreatePathSessionMutation as jest.Mock).mockReturnValue([
      jest.fn().mockReturnValue({unwrap: jest.fn().mockResolvedValue({})}),
      {isLoading: true},
    ]);

    const {result: trackResult} = renderHook(() =>
      useLearningPathDetails({id: 'p', type: LearningPathType.TRACK}),
    );
    expect(trackResult.current.isCreatingSession).toBe(true);

    (useCreatePathSessionMutation as jest.Mock).mockReturnValue([
      jest.fn().mockReturnValue({unwrap: jest.fn().mockResolvedValue({})}),
      {isLoading: false},
    ]);
    (useCreateCaseSessionMutation as jest.Mock).mockReturnValue([
      jest.fn().mockReturnValue({unwrap: jest.fn().mockResolvedValue({})}),
      {isLoading: true},
    ]);

    const {result: caseResult} = renderHook(() =>
      useLearningPathDetails({id: 'c', type: LearningPathType.CASE}),
    );
    expect(caseResult.current.isCreatingSession).toBe(true);
  });

  it('refetch calls the correct refetch function based on type', async () => {
    const {result: trackHook} = renderHook(() =>
      useLearningPathDetails({id: 'p', type: LearningPathType.TRACK}),
    );

    await act(async () => {
      await trackHook.current.refetch();
    });
    expect(refetchTrack).toHaveBeenCalled();
    expect(refetchCase).not.toHaveBeenCalled();

    jest.clearAllMocks();

    const {result: caseHook} = renderHook(() =>
      useLearningPathDetails({id: 'c', type: LearningPathType.CASE}),
    );

    await act(async () => {
      await caseHook.current.refetch();
    });
    expect(refetchCase).toHaveBeenCalled();
    expect(refetchTrack).not.toHaveBeenCalled();
  });
});
