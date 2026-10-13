import React from 'react';
import {Linking} from 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';

import {ExternalResourceSheet} from '../ExternalResourceSheet';

jest.mock('@/hooks/useTranslate', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
}));

jest.mock('@/components/BottomSheet', () => {
  const RN = require('react-native');
  return {
    BottomSheet: ({visible, children}: any) =>
      visible ? <RN.View testID="bottom-sheet">{children}</RN.View> : null,
  };
});

jest.mock('react-native-webview', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => <RN.View {...props} />,
  };
});

const resource = {
  id: 'r1',
  title: 'Mental Health First Aid Guide',
  url: 'https://example.com/guide',
};

describe('ExternalResourceSheet', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('renders the resource in a WebView', () => {
    const {getByTestId} = render(
      <ExternalResourceSheet resource={resource} onClose={jest.fn()} />,
    );
    expect(getByTestId('external-resource-webview')).toBeTruthy();
  });

  it('always shows the open-externally action, regardless of load state', () => {
    const {getByTestId} = render(
      <ExternalResourceSheet resource={resource} onClose={jest.fn()} />,
    );
    expect(getByTestId('external-resource-open-externally')).toBeTruthy();
  });

  it('opens the resource externally when the action is pressed', () => {
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const {getByTestId} = render(
      <ExternalResourceSheet resource={resource} onClose={jest.fn()} />,
    );

    fireEvent.press(getByTestId('external-resource-open-externally'));

    expect(openUrlSpy).toHaveBeenCalledWith(resource.url);
    openUrlSpy.mockRestore();
  });

  it('falls back to the OS if the WebView never finishes loading', () => {
    jest.useFakeTimers();
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<ExternalResourceSheet resource={resource} onClose={onClose} />);

    act(() => {
      jest.advanceTimersByTime(8000);
    });

    expect(openUrlSpy).toHaveBeenCalledWith(resource.url);
    expect(onClose).toHaveBeenCalledTimes(1);
    openUrlSpy.mockRestore();
  });

  it('does not fall back once the WebView actually finishes loading', () => {
    jest.useFakeTimers();
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const onClose = jest.fn();
    const {getByTestId} = render(
      <ExternalResourceSheet resource={resource} onClose={onClose} />,
    );

    fireEvent(getByTestId('external-resource-webview'), 'loadEnd');
    act(() => {
      jest.advanceTimersByTime(8000);
    });

    expect(openUrlSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    openUrlSpy.mockRestore();
  });

  it('falls back immediately on a genuine load error, without waiting for the timeout', () => {
    jest.useFakeTimers();
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const onClose = jest.fn();
    const {getByTestId} = render(
      <ExternalResourceSheet resource={resource} onClose={onClose} />,
    );

    fireEvent(getByTestId('external-resource-webview'), 'error');

    expect(openUrlSpy).toHaveBeenCalledWith(resource.url);
    expect(onClose).toHaveBeenCalledTimes(1);
    openUrlSpy.mockRestore();
  });

  it('falls back immediately on an HTTP error status, without waiting for the timeout', () => {
    jest.useFakeTimers();
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const onClose = jest.fn();
    const {getByTestId} = render(
      <ExternalResourceSheet resource={resource} onClose={onClose} />,
    );

    fireEvent(getByTestId('external-resource-webview'), 'httpError');

    expect(openUrlSpy).toHaveBeenCalledWith(resource.url);
    expect(onClose).toHaveBeenCalledTimes(1);
    openUrlSpy.mockRestore();
  });
});
