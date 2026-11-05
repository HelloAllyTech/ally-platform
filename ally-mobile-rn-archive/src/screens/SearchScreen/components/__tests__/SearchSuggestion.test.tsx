import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {TouchableOpacity} from 'react-native';

import {SearchSuggestion} from '../SearchSuggestions';

describe('SearchSuggestion', () => {
  it('renders text and icon and handles press', () => {
    const onPressSuggestion = jest.fn();
    const {getByText, UNSAFE_getByType} = render(
      <SearchSuggestion
        icon={<></>}
        text="Try this query"
        onPressSuggestion={onPressSuggestion}
        suggestionId={101}
      />,
    );

    expect(getByText('Try this query')).toBeTruthy();
    const touchable = UNSAFE_getByType(TouchableOpacity);
    fireEvent.press(touchable);
    expect(onPressSuggestion).toHaveBeenCalledWith(101);
  });
});


