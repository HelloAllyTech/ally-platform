import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

// Mock hooks index to avoid importing modules that pull in native network logger
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useKeyboardState: () => ({height: 0, isVisible: false}),
  useDebounce: (fn: any) => fn,
}));

import {SearchableLocationDropdown} from '../SearchableLocationDropdown';


const page1Data = {
  data: [
    {id: '1', city: 'CityOne', state: 'StateOne'},
    {id: '2', city: 'CityTwo', state: 'StateTwo'},
  ],
  total: 2,
};

jest.mock('@/services/placesApi', () => ({
  useGetPlacesQuery: (args: any) => ({
    data: args?.page === 1 ? page1Data : {data: [], total: 0},
    isLoading: false,
  }),
  useLazySearchPlacesQuery: () => [jest.fn(), {data: undefined, isLoading: false}],
}));

describe('SearchableLocationDropdown', () => {
  it('shows list when initial places are available', () => {
    const onSelect = jest.fn();
    const setIsOpen = jest.fn();
    const {getByText} = render(
      <SearchableLocationDropdown
        value=""
        onSelect={onSelect}
        placeholder="Placeholder"
        disabled={false}
        isOpen={true}
        setIsOpen={setIsOpen}
      />,
    );
    expect(getByText('CityOne, StateOne')).toBeTruthy();
  });

  it('renders places list and calls onSelect when an item is pressed', () => {
    const onSelect = jest.fn();
    const setIsOpen = jest.fn();
    const {getByText} = render(
      <SearchableLocationDropdown
        value=""
        onSelect={onSelect}
        isOpen={true}
        setIsOpen={setIsOpen}
      />,
    );

    const item = getByText('CityOne, StateOne');
    fireEvent.press(item);
    expect(onSelect).toHaveBeenCalledWith('CityOne, StateOne');
  });
});


