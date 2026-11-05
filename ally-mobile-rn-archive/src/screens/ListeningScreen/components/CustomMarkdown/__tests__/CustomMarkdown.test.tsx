import React from 'react';
import {render} from '@testing-library/react-native';

import {CustomMarkdown} from '../CustomMarkdown';

describe('CustomMarkdown', () => {
  it('renders title, list, and paragraph with bold text', () => {
    const content = [
      '# Heading Title',
      '',
      'This is a **bold** statement in a paragraph.',
      '- List **item** one',
      '- List item two',
    ].join('\n');

    const {getByText} = render(<CustomMarkdown content={content} />);

    expect(getByText('Heading Title')).toBeTruthy();
    expect(getByText('bold')).toBeTruthy();
    expect(getByText('item')).toBeTruthy();
    expect(getByText('List item two')).toBeTruthy();
  });
});


