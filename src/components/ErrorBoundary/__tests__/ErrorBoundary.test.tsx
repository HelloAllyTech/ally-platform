import React from 'react';
import {Text} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

const mockRecordError = jest.fn();
const mockLog = jest.fn();
jest.mock('@react-native-firebase/crashlytics', () => ({
  __esModule: true,
  default: () => ({recordError: mockRecordError, log: mockLog}),
}));

import {ErrorBoundary} from '../ErrorBoundary';

const Boom = ({shouldThrow}: {shouldThrow: boolean}) => {
  if (shouldThrow) throw new Error('render blew up');
  return <Text testID="child">fine</Text>;
};

describe('ErrorBoundary', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // React logs caught render errors; that noise isn't the thing under test.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders its children when nothing goes wrong', () => {
    const {getByTestId} = render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(getByTestId('child')).toBeTruthy();
  });

  it('shows a recoverable fallback instead of a blank screen', () => {
    const {getByText, getByTestId} = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(getByText('common.somethingWentWrong')).toBeTruthy();
    expect(getByTestId('error-boundary-retry')).toBeTruthy();
  });

  it('reports the error so this failure mode is visible at all', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(mockRecordError).toHaveBeenCalledWith(
      expect.objectContaining({message: 'render blew up'}),
      'UnhandledRenderError',
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining('componentStack'),
    );
  });

  it('still shows the fallback when reporting itself fails', () => {
    mockRecordError.mockImplementation(() => {
      throw new Error('crashlytics unavailable');
    });

    const {getByText} = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(getByText('common.somethingWentWrong')).toBeTruthy();
  });

  it('re-mounts the tree when the counsellor retries', () => {
    const {getByTestId, getByText, update} = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(getByText('common.somethingWentWrong')).toBeTruthy();

    // Whatever made the render fail has passed (a refetch, a fresh navigation).
    update(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    fireEvent.press(getByTestId('error-boundary-retry'));

    expect(getByTestId('child')).toBeTruthy();
  });
});
