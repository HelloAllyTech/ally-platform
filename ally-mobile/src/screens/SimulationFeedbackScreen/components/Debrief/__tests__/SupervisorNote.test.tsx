import React from 'react';

import {render} from '@testing-library/react-native';

import {SupervisorNote} from '../SupervisorNote';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) =>
      ({
        'postSim.debrief.from': 'from Ally',
        'postSim.debrief.aiLabel': 'AI-generated',
        'postSim.debrief.aiTooltip': 'Ally is an AI supervisor.',
        'postSim.debrief.momentLabel': 'See this moment',
        'postSim.debrief.section.what_worked': 'What worked',
        'postSim.debrief.section.what_it_cost': 'What it cost',
        'postSim.debrief.section.try_next': 'Try this next',
      })[key] ?? key,
  }),
}));

jest.mock('@/components', () => ({
  InfoTooltip: ({children}: {children: React.ReactNode}) => children,
}));

const STRUCTURED = [
  'Sandeep — tough one.',
  '',
  '## [what_worked]',
  'You left the silence alone.',
  '',
  '## [what_it_cost]',
  'Reassurance closed a door.',
  '',
  '## [try_next]',
  'Ask one more question.',
  '',
  '## [closing]',
  "Reply and we'll talk it through.",
].join('\n');

describe('SupervisorNote', () => {
  it('gives each keyed section its heading', () => {
    const {getByText} = render(<SupervisorNote note={STRUCTURED} />);

    expect(getByText('What worked')).toBeTruthy();
    expect(getByText('What it cost')).toBeTruthy();
    expect(getByText('Try this next')).toBeTruthy();
  });

  it('never leaks a raw section key to the learner', () => {
    const {queryByText} = render(<SupervisorNote note={STRUCTURED} />);

    expect(queryByText(/what_worked/)).toBeNull();
    expect(queryByText(/\[closing\]/)).toBeNull();
  });

  it('drops the closing invitation when there is nothing to reply in', () => {
    // The debrief opened from Logs has no composer, so the invitation would be
    // pointing at something that is not on screen.
    const {getByText, queryByText} = render(
      <SupervisorNote note={STRUCTURED} hideClosing />,
    );

    expect(getByText('Ask one more question.')).toBeTruthy();
    expect(queryByText("Reply and we'll talk it through.")).toBeNull();
  });

  it('renders a note written before sections existed unchanged', () => {
    const {getByText, queryByText} = render(
      <SupervisorNote note={'First para.\n\nReply any time.'} hideClosing />,
    );

    expect(getByText('First para.')).toBeTruthy();
    // No marker to find, so nothing is guessed at and the note stays whole.
    expect(getByText('Reply any time.')).toBeTruthy();
    expect(queryByText('What worked')).toBeNull();
  });
});
