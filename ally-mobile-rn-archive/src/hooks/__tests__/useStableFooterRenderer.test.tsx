import {render, renderHook} from '@testing-library/react-native';
import React from 'react';
import {View} from 'react-native';

import {useStableFooterRenderer} from '../useStableFooterRenderer';

jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetFooter: ({children}: {children: React.ReactNode}) => children,
}));

jest.mock('@/components', () => ({
  CommentBottomSheetFooter: (props: Record<string, unknown>) => {
    const {View: RNView} = require('react-native');
    return <RNView testID="comment-footer" {...props} />;
  },
}));

describe('useStableFooterRenderer', () => {
  const baseState = {
    text: '',
    setText: jest.fn(),
    onSubmit: jest.fn(),
    placeholder: 'p',
    insetsBottom: 0,
    isLoading: false,
  };

  it('returns a function', () => {
    const {result} = renderHook(() => useStableFooterRenderer(baseState));

    expect(typeof result.current).toBe('function');
  });

  it('returned function is stable across re-renders (reference equality)', () => {
    const {result, rerender} = renderHook(
      (props: typeof baseState) => useStableFooterRenderer(props),
      {initialProps: baseState},
    );

    const first = result.current;
    rerender({...baseState, text: 'updated'});
    expect(result.current).toBe(first);
  });

  it('rendering the returned function produces a CommentBottomSheetFooter', () => {
    const {result} = renderHook(() => useStableFooterRenderer(baseState));
    const renderFooter = result.current;

    const {getByTestId} = render(
      <View>{renderFooter({animatedFooterPosition: {}} as never)}</View>,
    );

    expect(getByTestId('comment-footer')).toBeTruthy();
  });
});
