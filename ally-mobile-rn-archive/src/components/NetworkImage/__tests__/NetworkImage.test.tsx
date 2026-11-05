import React from 'react';
import {render, waitFor, act} from '@testing-library/react-native';

import {NetworkImage} from '../NetworkImage';

// Mock fetch
global.fetch = jest.fn();

describe('NetworkImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render Image component for PNG URLs', () => {
    const {UNSAFE_getByType} = render(
      <NetworkImage imageUrl="https://example.com/badge.png" />,
    );
    const Image = require('react-native').Image;
    expect(UNSAFE_getByType(Image)).toBeTruthy();
  });

  it('should render Image component for JPG URLs', () => {
    const {UNSAFE_getByType} = render(
      <NetworkImage imageUrl="https://example.com/badge.jpg" />,
    );
    const Image = require('react-native').Image;
    expect(UNSAFE_getByType(Image)).toBeTruthy();
  });

  it('should render SvgUri component for SVG URLs', async () => {
    const {UNSAFE_getByType} = render(
      <NetworkImage imageUrl="https://example.com/badge.svg" />,
    );

    // Should render SvgUri by default
    await waitFor(() => {
      const {SvgUri} = require('react-native-svg');
      expect(UNSAFE_getByType(SvgUri)).toBeTruthy();
    });
  });

  it('should handle uppercase SVG extension', async () => {
    const {UNSAFE_getByType} = render(
      <NetworkImage imageUrl="https://example.com/badge.SVG" />,
    );

    await waitFor(() => {
      const {SvgUri} = require('react-native-svg');
      expect(UNSAFE_getByType(SvgUri)).toBeTruthy();
    });
  });

  it('should render with custom width and height for SVG', async () => {
    const {UNSAFE_getByType} = render(
      <NetworkImage
        imageUrl="https://example.com/badge.svg"
        width={100}
        height={100}
      />,
    );

    await waitFor(() => {
      const {SvgUri} = require('react-native-svg');
      const svgComponent = UNSAFE_getByType(SvgUri);
      expect(svgComponent.props.width).toBe(100);
      expect(svgComponent.props.height).toBe(100);
    });
  });

  it('should fallback to SvgXml when SvgUri fails', async () => {
    const mockSvgContent = '<svg><circle cx="50" cy="50" r="40" /></svg>';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockSvgContent),
    });

    const {UNSAFE_getByType} = render(
      <NetworkImage imageUrl="https://example.com/badge.svg" />,
    );

    // Initially renders SvgUri
    await waitFor(() => {
      const {SvgUri} = require('react-native-svg');
      expect(UNSAFE_getByType(SvgUri)).toBeTruthy();
    });

    // Simulate SvgUri error
    const {SvgUri} = require('react-native-svg');
    const svgUriComponent = UNSAFE_getByType(SvgUri);
    act(() => {
      if (svgUriComponent.props.onError) {
        svgUriComponent.props.onError(new Error('Failed to load'));
      }
    });

    // Should fallback to SvgXml after error
    await waitFor(() => {
      const {SvgXml} = require('react-native-svg');
      expect(UNSAFE_getByType(SvgXml)).toBeTruthy();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/badge.svg',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'image/svg+xml,image/*,*/*',
        }),
      }),
    );
  });

  it('should handle SVG fetch errors gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('Network error'),
    );

    const {UNSAFE_getByType} = render(
      <NetworkImage imageUrl="https://example.com/badge.svg" />,
    );

    // Initially renders SvgUri
    await waitFor(() => {
      const {SvgUri} = require('react-native-svg');
      expect(UNSAFE_getByType(SvgUri)).toBeTruthy();
    });

    // Simulate SvgUri error to trigger fallback
    const {SvgUri} = require('react-native-svg');
    const svgUriComponent = UNSAFE_getByType(SvgUri);
    act(() => {
      if (svgUriComponent.props.onError) {
        svgUriComponent.props.onError(new Error('Failed to load'));
      }
    });

    // Wait for fallback to fail and show error view
    await waitFor(() => {
      const View = require('react-native').View;
      const views = UNSAFE_getByType(View);
      expect(views).toBeTruthy();
    });
  });
});
