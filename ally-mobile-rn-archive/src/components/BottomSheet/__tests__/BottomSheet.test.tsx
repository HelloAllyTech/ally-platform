import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';

import {BottomSheet} from '../BottomSheet';

// Stands in for @gorhom/bottom-mockSheet. `snapToIndex` refuses to open until
// `layoutReady` flips, which is exactly what the real component does while its snap
// points are unresolved: it returns without a word.
const mockSheet = {
  layoutReady: false,
  index: -1,
  snapToIndex: jest.fn(),
  close: jest.fn(),
  onChange: undefined as ((index: number) => void) | undefined,
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const {View} = require('react-native');

  const MockBottomSheet = React.forwardRef(({children, onChange}: any, ref: any) => {
    mockSheet.onChange = onChange;
    React.useImperativeHandle(ref, () => ({
      snapToIndex: (index: number) => {
        mockSheet.snapToIndex(index);
        if (!mockSheet.layoutReady) return; // silent no-op, as in the real thing
        mockSheet.index = index;
        onChange?.(index);
      },
      close: () => {
        mockSheet.close();
        mockSheet.index = -1;
        onChange?.(-1);
      },
    }));
    return React.createElement(View, {testID: 'gorhom-sheet'}, children);
  });

  return {
    __esModule: true,
    default: MockBottomSheet,
    BottomSheetBackdrop: () => null,
    BottomSheetView: ({children, ...rest}: any) =>
      React.createElement(View, rest, children),
  };
});

const Sheet = (props: {visible: boolean; onClose?: () => void}) => (
  <BottomSheet visible={props.visible} onClose={props.onClose ?? jest.fn()}>
    <Text>content</Text>
  </BottomSheet>
);

describe('BottomSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSheet.layoutReady = false;
    mockSheet.index = -1;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens on the first attempt when layout is already settled', () => {
    mockSheet.layoutReady = true;

    render(<Sheet visible />);

    expect(mockSheet.snapToIndex).toHaveBeenCalledTimes(1);
    expect(mockSheet.index).toBe(0);
  });

  it('keeps trying when the first snap is silently dropped, and opens once it takes', () => {
    render(<Sheet visible />);

    expect(mockSheet.snapToIndex).toHaveBeenCalledTimes(1);
    expect(mockSheet.index).toBe(-1); // dropped

    // Layout lands a couple of frames later, as on a slow device.
    mockSheet.layoutReady = true;
    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(mockSheet.index).toBe(0);
  });

  it('stops retrying once open, rather than fighting the sheet', () => {
    mockSheet.layoutReady = true;
    render(<Sheet visible />);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(mockSheet.snapToIndex).toHaveBeenCalledTimes(1);
  });

  it('gives up after a bounded number of attempts and says why', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    render(<Sheet visible />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSheet.snapToIndex).toHaveBeenCalledTimes(6);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('stayed closed after'),
    );

    warn.mockRestore();
  });

  it('does not touch the sheet while hidden', () => {
    render(<Sheet visible={false} />);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSheet.snapToIndex).not.toHaveBeenCalled();
    expect(mockSheet.close).not.toHaveBeenCalled();
  });

  it('closes an open sheet when visible goes false', () => {
    mockSheet.layoutReady = true;
    const {update} = render(<Sheet visible />);

    update(<Sheet visible={false} />);

    expect(mockSheet.close).toHaveBeenCalledTimes(1);
  });

  it('abandons its retries when unmounted mid-attempt', () => {
    const {unmount} = render(<Sheet visible />);
    expect(mockSheet.snapToIndex).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSheet.snapToIndex).toHaveBeenCalledTimes(1);
  });
});
