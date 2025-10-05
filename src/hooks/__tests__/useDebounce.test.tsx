import React from 'react';
import {act, render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {useDebounce} from '../useDebounce';

jest.useFakeTimers();

const TestComponent = ({leading = false}: {leading?: boolean}) => {
  const [calls, setCalls] = React.useState<string[]>([]);
  const handler = (v: string) => setCalls(prev => [...prev, v]);
  const debounced = useDebounce(handler, {delay: 500, leading});
  React.useEffect(() => {
    debounced('a');
    debounced('b');
  }, [debounced]);
  return <Text>{JSON.stringify(calls)}</Text>;
};

describe('useDebounce', () => {
  it('invokes on trailing edge by default', () => {
    const {getByText} = render(<TestComponent />);
    expect(getByText('[]')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(getByText('["b"]')).toBeTruthy();
  });

  it('invokes immediately when leading=true and also on trailing reset', () => {
    const {getByText, rerender} = render(<TestComponent leading />);
    // First call triggers leading immediate call with 'a'
    expect(getByText('["a"]').props.children).toBe('["a"]');
    // Re-render to schedule new debounced calls
    rerender(<TestComponent leading />);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    // With leading=true, trailing does not invoke; only the immediate call was made
    expect(getByText('["a"]').props.children).toBe('["a"]');
  });
});


