jest.mock('react-i18next', () => {
  const en = require('@/localization/locales/en.json');
  const resolve = (key: string) => {
    const val = String(key)
      .split('.')
      .reduce((o: any, p: string) => (o == null ? undefined : o[p]), en);
    return typeof val === 'string' ? val : key;
  };
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      t: resolve,
      i18n: {language: 'en', changeLanguage: jest.fn()},
    }),
  };
});

jest.mock('@/assets/icons', () => {
  const {View} = require('react-native');
  return {
    BulbIcon: () => <View testID="bulb-icon" />,
    NotesIcon: () => <View testID="notes-icon" />,
  };
});

// jest.setup.ts globally mocks '@/components' without RichText. Stub it with
// a plain tag-stripped Text (same approach SimulationDetailsScreen's tests
// use) rather than the real component, which would pull in a circular
// RichText -> @/utils -> fieldRenderer -> @/components import chain.
jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    __esModule: true,
    RichText: ({html}: {html?: string | null}) =>
      html ? React.createElement(Text, null, html.replace(/<[^>]+>/g, '')) : null,
  };
});

import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SessionInfoTabs} from '../SessionInfoTabs';
import {SessionInfoTab} from '../types';

const description = '<p>You are speaking with <strong>Asha</strong>, a caller in distress.</p>';
const reminders = ['Speak slowly and calmly.', 'Validate feelings before problem-solving.'];

describe('SessionInfoTabs', () => {
  it('renders nothing when there is no description and no reminders', () => {
    const {toJSON} = render(<SessionInfoTabs />);
    expect(toJSON()).toBeNull();
  });

  it('renders both tabs when a description is provided', () => {
    const {getByTestId, getByText} = render(
      <SessionInfoTabs description={description} />,
    );
    expect(getByTestId('session-info-tabs')).toBeTruthy();
    expect(getByText('Reminders')).toBeTruthy();
    expect(getByText('Description')).toBeTruthy();
  });

  it('defaults to the Description tab when there are no reminders', () => {
    const {getByTestId, getByText} = render(
      <SessionInfoTabs description={description} />,
    );
    expect(getByTestId('session-info-description')).toBeTruthy();
    expect(getByText(/Asha/)).toBeTruthy();
  });

  it('defaults to the Reminders tab when reminders exist', () => {
    const {getByTestId, getByText} = render(
      <SessionInfoTabs description={description} reminders={reminders} />,
    );
    expect(getByTestId('session-info-reminders')).toBeTruthy();
    expect(getByText('Speak slowly and calmly.')).toBeTruthy();
    expect(getByText('Validate feelings before problem-solving.')).toBeTruthy();
  });

  it('switches between tabs on press', () => {
    const {getByTestId, queryByTestId} = render(
      <SessionInfoTabs description={description} reminders={reminders} />,
    );
    fireEvent.press(getByTestId('session-info-tab-description'));
    expect(getByTestId('session-info-description')).toBeTruthy();
    expect(queryByTestId('session-info-reminders')).toBeNull();

    fireEvent.press(getByTestId('session-info-tab-reminders'));
    expect(getByTestId('session-info-reminders')).toBeTruthy();
    expect(queryByTestId('session-info-description')).toBeNull();
  });

  it('shows an empty state on the Reminders tab when there are none', () => {
    const {getByTestId, getByText} = render(
      <SessionInfoTabs description={description} />,
    );
    fireEvent.press(getByTestId('session-info-tab-reminders'));
    expect(getByText('No reminders for this scenario yet.')).toBeTruthy();
  });

  it('hides its own tab header when hideHeader is set, for a parent-driven tab bar', () => {
    const {queryByTestId, getByTestId} = render(
      <SessionInfoTabs
        description={description}
        reminders={reminders}
        hideHeader
        activeTab={SessionInfoTab.REMINDERS}
      />,
    );
    expect(queryByTestId('session-info-tab-reminders')).toBeNull();
    expect(queryByTestId('session-info-tab-description')).toBeNull();
    expect(getByTestId('session-info-reminders')).toBeTruthy();
  });

  it('renders content for the externally-controlled activeTab', () => {
    const {getByTestId, rerender} = render(
      <SessionInfoTabs
        description={description}
        reminders={reminders}
        hideHeader
        activeTab={SessionInfoTab.DESCRIPTION}
      />,
    );
    expect(getByTestId('session-info-description')).toBeTruthy();

    rerender(
      <SessionInfoTabs
        description={description}
        reminders={reminders}
        hideHeader
        activeTab={SessionInfoTab.REMINDERS}
      />,
    );
    expect(getByTestId('session-info-reminders')).toBeTruthy();
  });
});
