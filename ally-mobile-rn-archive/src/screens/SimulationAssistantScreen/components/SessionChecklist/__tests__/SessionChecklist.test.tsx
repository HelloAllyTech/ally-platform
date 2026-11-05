import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {SessionChecklist} from '../SessionChecklist';
import {ChecklistType} from '@/types';

// Mocks
jest.mock('@/assets/icons', () => {
  const {View} = require('react-native');
  return {
    ChecklistIcon: () => <View testID="checklist-icon" />,
    ChevronDown: () => <View testID="chevron-down" />,
    TickIcon: () => <View testID="tick-icon" />,
  };
});

jest.mock('@/theme', () => ({
  fontFamily: {
    IBM_PLEX_SERIF: {REGULAR: {fontFamily: 'IBMPlexSerif-Regular'}},
  },
}));

jest.mock('@sayem314/react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Return hardcoded strings to match component content for testing or just the key
      if (key === 'SimulationChecklist.sessionChecklist') return 'simulationPage.sessionChecklist';
      if (key === 'SimulationChecklist.progress') return 'Progress';
      if (key === 'SimulationChecklist.completed') return 'completed';
      return key;
    },
  }),
}));

// Mock Reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return {
    ...Reanimated,
    FadeIn: {duration: jest.fn(() => ({}))},
    FadeOut: {duration: jest.fn(() => ({}))},
    Layout: {springify: jest.fn(() => ({}))},
  };
});

describe('SessionChecklist', () => {
  const mockItems = [
    {id: '1', name: 'Step 1', message: 'Details 1', rank: 1},
    {id: '2', name: 'Step 2', message: 'Details 2', rank: 2},
  ];

  it('renders correctly in GUIDED mode', () => {
    const {getByText} = render(
      <SessionChecklist
        mode={ChecklistType.GUIDED}
        items={mockItems}
        triggeredEvents={[]}
      />,
    );

    expect(getByText('simulationPage.sessionChecklist')).toBeTruthy();
    expect(getByText('Step 1')).toBeTruthy();
    expect(getByText('Step 2')).toBeTruthy();
  });

  it('renders correctly in UNGUIDED mode (hidden untriggered items)', () => {
    const {queryByText, getByText} = render(
      <SessionChecklist
        mode={ChecklistType.UNGUIDED}
        items={mockItems}
        triggeredEvents={['1']}
      />,
    );

    // Item 1 triggered -> name visible
    expect(getByText('Step 1')).toBeTruthy();

    // Item 2 untriggered -> name hidden
    expect(queryByText('Step 2')).toBeNull();
    // Rank visible
    expect(getByText('2')).toBeTruthy();
  });

  it('renders progress correctly', () => {
    const {getByText} = render(
      <SessionChecklist
        mode={ChecklistType.GUIDED}
        items={mockItems}
        triggeredEvents={['1', '2']}
      />,
    );

    // completedCount = 2
    expect(getByText('2')).toBeTruthy();
    // totalCount = 2, followed by 'completed'
    // The component renders: <Text>{totalCount} {t('completed')}</Text>
    // So "2 completed"
    expect(getByText('2 simulationPage.completed')).toBeTruthy();
  });

  it('toggles expansion on press (guided mode)', () => {
    const {getByText, queryByText} = render(
      <SessionChecklist
        mode={ChecklistType.GUIDED}
        items={mockItems}
        triggeredEvents={[]}
      />,
    );

    // Initial state: details hidden
    expect(queryByText('Details 1')).toBeNull();

    // Press item 1 to expand
    fireEvent.press(getByText('Step 1'));

    // Details visible
    expect(getByText('Details 1')).toBeTruthy();

    // Press again to collapse
    fireEvent.press(getByText('Step 1'));

    // Details hidden again
    expect(queryByText('Details 1')).toBeNull();
  });

  it('does not toggle expansion when disabled (UNGUIDED or no message)', () => {
    const {getByText, queryByText} = render(
      <SessionChecklist
        mode={ChecklistType.UNGUIDED}
        items={[{id: '1', name: 'Step 1', message: 'Details 1', rank: 1}]}
        triggeredEvents={['1']}
      />, // UNGUIDED mode
    );

    // Press item 1
    fireEvent.press(getByText('Step 1'));

    // Details should NOT be visible
    expect(queryByText('Details 1')).toBeNull();
  });

  it('does not crash when mode is OFF', () => {
    const {toJSON} = render(
      <SessionChecklist
        mode={ChecklistType.OFF}
        items={mockItems}
        triggeredEvents={[]}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders correctly in LIST mode (names visible regardless of trigger state)', () => {
    const {getByText} = render(
      <SessionChecklist
        mode={ChecklistType.LIST}
        items={mockItems}
        triggeredEvents={[]}
      />,
    );

    expect(getByText('simulationPage.sessionChecklist')).toBeTruthy();
    expect(getByText('Step 1')).toBeTruthy();
    expect(getByText('Step 2')).toBeTruthy();
  });

  it('hides progress subtitle and status circles in LIST mode', () => {
    const {queryByText, queryAllByTestId} = render(
      <SessionChecklist
        mode={ChecklistType.LIST}
        items={mockItems}
        triggeredEvents={['1', '2']}
      />,
    );

    // Progress line should not render in LIST mode
    expect(queryByText('Progress')).toBeNull();
    expect(queryByText('2 simulationPage.completed')).toBeNull();

    // Status circle (tick icon) should not render in LIST mode
    expect(queryAllByTestId('tick-icon').length).toBe(0);
  });

  it('toggles expansion on press in LIST mode', () => {
    const {getByText, queryByText} = render(
      <SessionChecklist
        mode={ChecklistType.LIST}
        items={mockItems}
        triggeredEvents={[]}
      />,
    );

    expect(queryByText('Details 1')).toBeNull();

    fireEvent.press(getByText('Step 1'));
    expect(getByText('Details 1')).toBeTruthy();

    fireEvent.press(getByText('Step 1'));
    expect(queryByText('Details 1')).toBeNull();
  });

  it('hides the title/progress header when hideHeader is set, for a parent-driven tab bar', () => {
    const {queryByText, getByText} = render(
      <SessionChecklist
        mode={ChecklistType.GUIDED}
        items={mockItems}
        triggeredEvents={['1']}
        hideHeader
      />,
    );

    expect(queryByText('simulationPage.sessionChecklist')).toBeNull();
    expect(queryByText('Progress')).toBeNull();
    // The list itself still renders.
    expect(getByText('Step 1')).toBeTruthy();
    expect(getByText('Step 2')).toBeTruthy();
  });
});
