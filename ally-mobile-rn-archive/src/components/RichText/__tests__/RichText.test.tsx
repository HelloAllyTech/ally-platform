import React from 'react';
import {StyleSheet, View} from 'react-native';
import {render} from '@testing-library/react-native';

import {RichText} from '../RichText';

describe('RichText', () => {
  it('renders nothing for empty or nullish html', () => {
    expect(render(<RichText html={undefined} />).toJSON()).toBeNull();
    expect(render(<RichText html={null} />).toJSON()).toBeNull();
    expect(render(<RichText html="" />).toJSON()).toBeNull();
    expect(render(<RichText html="   " />).toJSON()).toBeNull();
  });

  it('wraps plain text (no tags) in a single paragraph', () => {
    const {getByText} = render(<RichText html="Just plain text" />);
    expect(getByText('Just plain text')).toBeTruthy();
  });

  it('renders paragraphs and decodes entities', () => {
    const {getByText} = render(
      <RichText html="<p>Tom &amp; Jerry</p><p>Second</p>" />,
    );
    expect(getByText('Tom & Jerry')).toBeTruthy();
    expect(getByText('Second')).toBeTruthy();
  });

  it('renders inline marks as nested text with their styles', () => {
    const {getByText} = render(
      <RichText html="<p>Hello <strong>bold</strong> <em>italic</em></p>" />,
    );
    const bold = getByText('bold');
    const italic = getByText('italic');
    expect(bold).toBeTruthy();
    expect(italic).toBeTruthy();
    expect(bold.props.style).toEqual(
      expect.objectContaining({fontFamily: 'IBMPlexSerif-Medium'}),
    );
    expect(italic.props.style).toEqual(
      expect.objectContaining({fontStyle: 'italic'}),
    );
  });

  it('renders unordered list items with bullet markers', () => {
    const {getByText, getAllByText} = render(
      <RichText html="<ul><li>One</li><li>Two</li></ul>" />,
    );
    expect(getByText('One')).toBeTruthy();
    expect(getByText('Two')).toBeTruthy();
    expect(getAllByText('•')).toHaveLength(2);
  });

  it('renders ordered list items with numeric markers', () => {
    const {getByText} = render(
      <RichText html="<ol><li>First</li><li>Second</li></ol>" />,
    );
    expect(getByText('1.')).toBeTruthy();
    expect(getByText('2.')).toBeTruthy();
    expect(getByText('First')).toBeTruthy();
    expect(getByText('Second')).toBeTruthy();
  });

  it('flattens headings and line breaks into readable text', () => {
    const {getByText} = render(
      <RichText html="<h2>Title</h2><p>line one<br>line two</p>" />,
    );
    expect(getByText('Title')).toBeTruthy();
    expect(getByText(/line one/)).toBeTruthy();
    expect(getByText(/line two/)).toBeTruthy();
  });

  it('keeps a heading larger and heavier than body text when the caller sets a body textStyle', () => {
    const {getByText} = render(
      <RichText
        html="<h1>Big</h1><p>small</p>"
        textStyle={{
          fontFamily: 'IBMPlexSerif-Regular',
          fontSize: 14,
          color: '#123456',
        }}
      />,
    );
    const heading = StyleSheet.flatten(getByText('Big').props.style);
    const body = StyleSheet.flatten(getByText('small').props.style);
    expect(heading.fontFamily).toBe('IBMPlexSerif-Medium');
    expect(heading.fontSize).toBeGreaterThan(body.fontSize as number);
    // The caller still owns the colour.
    expect(heading.color).toBe('#123456');
  });

  it('drops empty paragraphs at the end but keeps a blank line in the middle', () => {
    const {toJSON} = render(
      <RichText html="<p>a</p><p></p><p>b</p><p></p><p> </p>" />,
    );
    // a, the blank spacer, b — the two trailing empties are gone.
    const view = toJSON() as {children: unknown[]};
    expect(view.children).toHaveLength(3);
  });

  it('drops script and style content', () => {
    const {queryByText, getByText} = render(
      <RichText html="<p>Safe</p><script>alert('x')</script>" />,
    );
    expect(getByText('Safe')).toBeTruthy();
    expect(queryByText(/alert/)).toBeNull();
  });

  it('renders horizontal rule as a view', () => {
    const {UNSAFE_getAllByType} = render(
      <RichText html="<p>Above</p><hr><p>Below</p>" />,
    );
    // Outer wrapper + hr divider are both Views.
    expect(UNSAFE_getAllByType(View).length).toBeGreaterThanOrEqual(2);
  });
});
