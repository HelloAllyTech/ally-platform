import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/theme', () => ({
  fontFamily: {ROBOTO: {REGULAR: {}}},
}));

import {SessionProgress} from '../SessionProgress';

const mockStateInstructions = [
  {name: 'Resistive', stateId: '1'},
  {name: 'Hopeless', stateId: '2'},
  {name: 'Open', stateId: '3'},
  {name: 'Hopeful', stateId: '4'},
];

describe('SessionProgress', () => {
  it('renders with the correct test id', () => {
    const {getByTestId} = render(
      <SessionProgress stateNames={mockStateInstructions} difficultyLevel="EASY" score={0} />,
    );
    expect(getByTestId('session-progress')).toBeTruthy();
  });

  it('renders all state names, each on its own row in a vertical list', () => {
    const {getByText} = render(
      <SessionProgress stateNames={mockStateInstructions} difficultyLevel="EASY" score={0} />,
    );
    expect(getByText('Resistive')).toBeTruthy();
    expect(getByText('Hopeless')).toBeTruthy();
    expect(getByText('Open')).toBeTruthy();
    expect(getByText('Hopeful')).toBeTruthy();
  });

  it('renders a state test id for each state', () => {
    const {getByTestId} = render(
      <SessionProgress stateNames={mockStateInstructions} difficultyLevel="EASY" score={0} />,
    );
    expect(getByTestId('session-progress-state-1')).toBeTruthy();
    expect(getByTestId('session-progress-state-2')).toBeTruthy();
    expect(getByTestId('session-progress-state-3')).toBeTruthy();
    expect(getByTestId('session-progress-state-4')).toBeTruthy();
  });

  it('renders a progress dot for each state', () => {
    const {getByTestId} = render(
      <SessionProgress stateNames={mockStateInstructions} difficultyLevel="EASY" score={0} />,
    );
    expect(getByTestId('session-progress-dot-1')).toBeTruthy();
    expect(getByTestId('session-progress-dot-2')).toBeTruthy();
    expect(getByTestId('session-progress-dot-3')).toBeTruthy();
    expect(getByTestId('session-progress-dot-4')).toBeTruthy();
  });

  it('renders nothing when stateNames is empty', () => {
    const {toJSON} = render(
      <SessionProgress stateNames={[]} difficultyLevel="EASY" score={0} />,
    );
    expect(toJSON()).toBeNull();
  });

  describe('state highlighting', () => {
    it('highlights state 2 for EASY difficulty with score 0', () => {
      const {getByText} = render(
        <SessionProgress stateNames={mockStateInstructions} difficultyLevel="EASY" score={0} />,
      );
      expect(getByText('Hopeless').props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({fontWeight: '600'})]),
      );
    });

    it('highlights state 1 for EASY difficulty with score -100', () => {
      const {getByText} = render(
        <SessionProgress stateNames={mockStateInstructions} difficultyLevel="EASY" score={-100} />,
      );
      expect(getByText('Resistive').props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({fontWeight: '600'})]),
      );
    });

    it('highlights state 4 for EASY difficulty with score 100', () => {
      const {getByText} = render(
        <SessionProgress stateNames={mockStateInstructions} difficultyLevel="EASY" score={100} />,
      );
      expect(getByText('Hopeful').props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({fontWeight: '600'})]),
      );
    });

    it('highlights state 3 for MEDIUM difficulty with score 75', () => {
      const {getByText} = render(
        <SessionProgress stateNames={mockStateInstructions} difficultyLevel="MEDIUM" score={75} />,
      );
      expect(getByText('Open').props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({fontWeight: '600'})]),
      );
    });

    it('highlights state 2 for HARD difficulty with score 50', () => {
      const {getByText} = render(
        <SessionProgress stateNames={mockStateInstructions} difficultyLevel="HARD" score={50} />,
      );
      expect(getByText('Hopeless').props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({fontWeight: '600'})]),
      );
    });
  });

  describe('edge cases', () => {
    it('renders with 2 states', () => {
      const twoStates = [
        {name: 'Bad', stateId: '1'},
        {name: 'Good', stateId: '2'},
      ];
      const {getByText} = render(
        <SessionProgress stateNames={twoStates} difficultyLevel="EASY" score={0} />,
      );
      expect(getByText('Bad')).toBeTruthy();
      expect(getByText('Good')).toBeTruthy();
    });

    it('defaults to state 0 for an unknown difficulty', () => {
      const {getByText} = render(
        <SessionProgress
          stateNames={mockStateInstructions}
          difficultyLevel="UNKNOWN"
          score={50}
        />,
      );
      expect(getByText('Resistive').props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({fontWeight: '600'})]),
      );
    });
  });
});
