import React from 'react';
import {render} from '@testing-library/react-native';

import {Message} from '../Message';

describe('Message', () => {
  it('renders timestamp and message', () => {
    const {Text} = require('react-native');
    const {getByText} = render(
      <Message timestamp="00:01" message={<Text>Hello world</Text>} />,
    );
    expect(getByText('00:01')).toBeTruthy();
    expect(getByText('Hello world')).toBeTruthy();
  });

  it('renders with custom containerStyle', () => {
    const {toJSON} = render(
      <Message
        timestamp="00:00"
        message={<React.Fragment>Text</React.Fragment>}
        containerStyle={{padding: 10}}
      />,
    );
    expect(toJSON()).not.toBeNull();
  });

  it('renders with custom timestampStyle', () => {
    const {getByText} = render(
      <Message
        timestamp="01:30"
        message={<React.Fragment>Content</React.Fragment>}
        timestampStyle={{color: '#000'}}
      />,
    );
    expect(getByText('01:30')).toBeTruthy();
  });

  it('renders complex message node', () => {
    const {Text} = require('react-native');
    const {getByText} = render(
      <Message
        timestamp="00:00"
        message={
          <>
            <Text>Part one</Text>
            <Text> Part two</Text>
          </>
        }
      />,
    );
    expect(getByText('Part one')).toBeTruthy();
    expect(getByText(/Part two/)).toBeTruthy();
  });
});
