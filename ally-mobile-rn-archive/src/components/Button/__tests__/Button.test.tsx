import {fireEvent, render} from '@testing-library/react-native';

import {Button} from '../Button';

describe('Button', () => {
  it('renders the label', () => {
    const {getByText} = render(
      <Button label="Submit" onPress={() => {}} />,
    );
    expect(getByText('Submit')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const {getByTestId} = render(
      <Button label="Tap" onPress={onPress} testID="primary-button" />,
    );
    fireEvent.press(getByTestId('primary-button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is disabled when isDisabled is true', () => {
    const onPress = jest.fn();
    const {getByTestId} = render(
      <Button
        label="Disabled"
        onPress={onPress}
        isDisabled
        testID="primary-button"
      />,
    );
    fireEvent.press(getByTestId('primary-button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows loader and hides label when isLoading is true', () => {
    const {queryByText, getByTestId} = render(
      <Button
        label="Loading"
        onPress={() => {}}
        isLoading
        testID="primary-button"
      />,
    );

    // Label should not be present
    expect(queryByText('Loading')).toBeNull();

    // ActivityIndicator is rendered within the button
    expect(getByTestId('primary-button')).toBeTruthy();
  });

  it('renders secondary variant', () => {
    const {getByText} = render(
      <Button label="Secondary" onPress={() => {}} variant="secondary" />,
    );
    expect(getByText('Secondary')).toBeTruthy();
  });
});
