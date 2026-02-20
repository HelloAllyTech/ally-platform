import React from 'react';
import {render} from '@testing-library/react-native';

import {UserProfileImage} from '../UserProfileImage';

describe('UserProfileImage', () => {
  it('renders without crashing', () => {
    const {toJSON} = render(<UserProfileImage />);
    expect(toJSON()).not.toBeNull();
  });

  it('displays initial from name', () => {
    const {getByText} = render(<UserProfileImage name="Alice" />);
    expect(getByText('A')).toBeTruthy();
  });

  it('uppercases the initial', () => {
    const {getByText} = render(<UserProfileImage name="bob" />);
    expect(getByText('B')).toBeTruthy();
  });

  it('renders empty string for no name', () => {
    const {queryByText} = render(<UserProfileImage />);
    expect(queryByText(/[A-Z]/)).toBeNull();
  });

  it('trims whitespace from name before extracting initial', () => {
    const {getByText} = render(<UserProfileImage name="  Charlie" />);
    expect(getByText('C')).toBeTruthy();
  });

  it('renders image when profileImageUri is provided', () => {
    const uri = 'https://example.com/avatar.png';
    const {toJSON} = render(
      <UserProfileImage name="Dave" profileImageUri={uri} />,
    );
    const tree = toJSON();
    expect(tree).not.toBeNull();
    const imageNode = JSON.stringify(tree);
    expect(imageNode).toContain(uri);
  });

  it('renders fallback icon when provided and no image', () => {
    const {Text} = require('react-native');
    const FallbackIcon = <Text testID="fallback-icon">FB</Text>;
    const {getByTestId} = render(
      <UserProfileImage fallbackIcon={FallbackIcon} />,
    );
    expect(getByTestId('fallback-icon')).toBeTruthy();
  });

  it('prefers image over fallback icon', () => {
    const {Text} = require('react-native');
    const FallbackIcon = <Text testID="fallback-icon">FB</Text>;
    const {queryByTestId, toJSON} = render(
      <UserProfileImage
        profileImageUri="https://example.com/avatar.png"
        fallbackIcon={FallbackIcon}
      />,
    );
    expect(queryByTestId('fallback-icon')).toBeNull();
    const imageNode = JSON.stringify(toJSON());
    expect(imageNode).toContain('https://example.com/avatar.png');
  });

  it('prefers fallback icon over initials', () => {
    const {Text} = require('react-native');
    const FallbackIcon = <Text testID="fallback-icon">FB</Text>;
    const {getByTestId, queryByText} = render(
      <UserProfileImage name="Eve" fallbackIcon={FallbackIcon} />,
    );
    expect(getByTestId('fallback-icon')).toBeTruthy();
    expect(queryByText('E')).toBeNull();
  });

  it('applies custom size', () => {
    const {toJSON} = render(<UserProfileImage name="Fay" size={48} />);
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('48');
  });
});
