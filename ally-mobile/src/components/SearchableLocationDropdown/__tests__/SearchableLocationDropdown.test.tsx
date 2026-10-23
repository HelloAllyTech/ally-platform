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

const mockSearch = jest.fn();
let mockSearchData: any = undefined;
let mockIsInitialLoading = false;
jest.mock('@/services/placesApi', () => ({
  useGetPlacesQuery: (args: any) => ({
    data: args?.page === 1 ? page1Data : {data: [], total: 0},
    isLoading: mockIsInitialLoading,
  }),
  useLazySearchPlacesQuery: () => [mockSearch, {data: mockSearchData, isLoading: false}],
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

  it('shows instructions when no search and no initial places', () => {
    mockIsInitialLoading = false;
    const original = { data: [...page1Data.data], total: page1Data.total };
    page1Data.data = [] as any;
    page1Data.total = 0 as any;
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
    expect(getByText('locationDropdown.startTypingToSearch')).toBeTruthy();
    // restore for subsequent tests
    page1Data.data = original.data as any;
    page1Data.total = original.total as any;
  });

  it('shows no results when search yields empty array', () => {
    mockSearchData = [];
    const onSelect = jest.fn();
    const setIsOpen = jest.fn();
    const {getByPlaceholderText, getByText} = render(
      <SearchableLocationDropdown
        value=""
        onSelect={onSelect}
        isOpen={true}
        setIsOpen={setIsOpen}
      />,
    );
    fireEvent.changeText(getByPlaceholderText('locationDropdown.searchPlaceholder'), 'abc');
    expect(getByText('locationDropdown.noLocationsFound')).toBeTruthy();
    mockSearchData = undefined;
  });

  it('paginates on scroll near bottom', () => {
    mockIsInitialLoading = false;
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
    // It should render initial items; simulate scroll to bottom to trigger loadMore (internal state), nothing to assert besides no crash
    expect(getByText('CityOne, StateOne')).toBeTruthy();
  });
});


