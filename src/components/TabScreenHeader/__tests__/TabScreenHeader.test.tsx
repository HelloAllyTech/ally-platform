jest.mock('react-i18next', () => {
  const en = require('@/localization/locales/en.json');
  const resolve = (key, vars = {}) => {
    const val = String(key)
      .split('.')
      .reduce((o, p) => (o == null ? undefined : o[p]), en);
    let s = typeof val === 'string' ? val : key;
    Object.keys(vars || {}).forEach(k => {
      s = s.split('{{' + k + '}}').join(String(vars[k]));
    });
    return s;
  };
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      t: resolve,
      i18n: {language: 'en', changeLanguage: jest.fn()},
    }),
  };
});

import React from 'react';
import {Text} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {TabScreenHeader} from '../TabScreenHeader';

// The header renders the persistent progress widget. Mocked out here: it is a separate
// unit with its own tests, and it needs navigation and the progress API that this test
// has no reason to wire up.
jest.mock('../../ProgressHeaderWidget', () => ({
  ProgressHeaderWidget: () => null,
}));

const mockOpenDrawer = jest.fn();
let mockShowHamburger = true;

jest.mock('@/hooks', () => ({
  useTabScreenHeader: () => ({
    showHamburger: mockShowHamburger,
    handleOpenDrawer: mockOpenDrawer,
  }),
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    DrawerMenuIcon: () => <View testID="drawer-menu-icon" />,
    InfoIcon: (props: any) => <View testID="info-icon" />,
  };
});

jest.mock('../../InfoTooltip', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    InfoTooltip: ({children, content, isVisible}: any) => (
      <View testID="info-tooltip">
        {children}
        {isVisible && content}
      </View>
    ),
  };
});

describe('TabScreenHeader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowHamburger = true;
  });

  it('renders the title', () => {
    const {getByText} = render(<TabScreenHeader title="Reviews" />);
    expect(getByText('Reviews')).toBeTruthy();
  });

  it('renders title with subtitle', () => {
    const {getByText} = render(
      <TabScreenHeader title="Hello" subtitle="World" />,
    );
    expect(getByText('World')).toBeTruthy();
  });

  it('renders hamburger menu when showHamburger is true', () => {
    const {getByTestId} = render(<TabScreenHeader title="Test" />);
    expect(getByTestId('drawer-menu-icon')).toBeTruthy();
  });

  it('hides hamburger menu when showHamburger is false', () => {
    mockShowHamburger = false;
    const {queryByTestId} = render(<TabScreenHeader title="Test" />);
    expect(queryByTestId('drawer-menu-icon')).toBeNull();
  });

  it('calls handleOpenDrawer on hamburger press', () => {
    const {getByLabelText} = render(<TabScreenHeader title="Test" />);
    fireEvent.press(getByLabelText('Open menu'));
    expect(mockOpenDrawer).toHaveBeenCalled();
  });

  it('renders right content when provided', () => {
    const {getByText} = render(
      <TabScreenHeader
        title="Test"
        rightContent={<Text>Right</Text>}
      />,
    );
    expect(getByText('Right')).toBeTruthy();
  });

  it('does not render right content when not provided', () => {
    const {queryByText} = render(<TabScreenHeader title="Test" />);
    expect(queryByText('Right')).toBeNull();
  });

  it('renders info tooltip when isTooltipRequired is true', () => {
    const {getByTestId} = render(
      <TabScreenHeader
        title="Test"
        isTooltipRequired
        tooltipContent={<Text>Tooltip info</Text>}
      />,
    );
    expect(getByTestId('info-tooltip')).toBeTruthy();
    expect(getByTestId('info-icon')).toBeTruthy();
  });

  it('does not render tooltip when isTooltipRequired is false', () => {
    const {queryByTestId} = render(<TabScreenHeader title="Test" />);
    expect(queryByTestId('info-tooltip')).toBeNull();
  });

  it('toggles tooltip visibility on info icon press', () => {
    const {getByTestId, queryByText} = render(
      <TabScreenHeader
        title="Test"
        isTooltipRequired
        tooltipContent={<Text>Tooltip content</Text>}
      />,
    );

    expect(queryByText('Tooltip content')).toBeNull();

    fireEvent.press(getByTestId('info-icon'));
    expect(queryByText('Tooltip content')).toBeTruthy();

    fireEvent.press(getByTestId('info-icon'));
    expect(queryByText('Tooltip content')).toBeNull();
  });

  it('renders without border when showBorder is false', () => {
    const {toJSON} = render(
      <TabScreenHeader title="Test" showBorder={false} />,
    );
    expect(toJSON()).toBeTruthy();
  });
});
