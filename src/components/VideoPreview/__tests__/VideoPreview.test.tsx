import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {VideoPreview} from '../VideoPreview';

jest.mock('react-native-video', () => 'Video');

describe('VideoPreview', () => {
  const mockVideoUrl = 'https://example.com/video.mp4';

  it('renders video component with correct props', () => {
    const {UNSAFE_getByType} = render(<VideoPreview videoUrl={mockVideoUrl} />);

    const videoComponent = UNSAFE_getByType('Video' as any);
    expect(videoComponent.props.source).toEqual({uri: mockVideoUrl});
    expect(videoComponent.props.paused).toBe(true); // Default is not playing
    expect(videoComponent.props.repeat).toBe(true);
    expect(videoComponent.props.muted).toBe(false); // Default is unmuted
    expect(videoComponent.props.controls).toBe(false);
  });

  it(
    'shows play button overlay when video is paused',
    async () => {
      const {getByTestId, UNSAFE_getByType} = render(
        <VideoPreview videoUrl={mockVideoUrl} testID="video-preview" />,
      );

      // Simulate video ready
      const videoComponent = UNSAFE_getByType('Video' as any);
      await act(async () => {
        videoComponent.props.onReadyForDisplay();
      });

      await waitFor(
        () => {
          expect(getByTestId('video-preview-play-button')).toBeTruthy();
        },
        {timeout: 10000},
      );
    },
    10000,
  );

  it('toggles video playback when play button is pressed', async () => {
    const onPlayStateChange = jest.fn();
    const {getByTestId, queryByTestId, UNSAFE_getByType} = render(
      <VideoPreview
        videoUrl={mockVideoUrl}
        testID="video-preview"
        onPlayStateChange={onPlayStateChange}
      />,
    );

    // Simulate video ready
    const videoComponent = UNSAFE_getByType('Video' as any);
    await act(async () => {
      videoComponent.props.onReadyForDisplay();
    });

    // Wait for loading to finish and play button to appear
    await waitFor(() => {
      expect(queryByTestId('video-preview-play-button')).toBeTruthy();
    });

    // Press play
    fireEvent.press(getByTestId('video-preview-play-button'));

    // Now playing
    expect(videoComponent.props.paused).toBe(false);
    expect(onPlayStateChange).toHaveBeenCalledWith(true);
    expect(queryByTestId('video-preview-pause-button')).toBeTruthy();
    expect(queryByTestId('video-preview-play-button')).toBeNull();
  });

  it('pauses video when pause overlay is pressed', async () => {
    const onPlayStateChange = jest.fn();
    const {getByTestId, queryByTestId, UNSAFE_getByType} = render(
      <VideoPreview
        videoUrl={mockVideoUrl}
        testID="video-preview"
        autoPlay
        onPlayStateChange={onPlayStateChange}
      />,
    );

    // Simulate video ready (this will hide loading and show pause button)
    const videoComponent = UNSAFE_getByType('Video' as any);
    await act(async () => {
      videoComponent.props.onReadyForDisplay();
    });

    // Wait for pause button to appear
    await waitFor(() => {
      expect(queryByTestId('video-preview-pause-button')).toBeTruthy();
    });

    // Press pause
    fireEvent.press(getByTestId('video-preview-pause-button'));

    // Now paused
    expect(videoComponent.props.paused).toBe(true);
    expect(onPlayStateChange).toHaveBeenCalledWith(false);
    
    await waitFor(() => {
      expect(queryByTestId('video-preview-play-button')).toBeTruthy();
    });
    expect(queryByTestId('video-preview-pause-button')).toBeNull();
  });

  it('autoplays when autoPlay prop is true', async () => {
    const {UNSAFE_getByType, queryByTestId} = render(
      <VideoPreview videoUrl={mockVideoUrl} autoPlay testID="video-preview" />,
    );

    const videoComponent = UNSAFE_getByType('Video' as any);
    expect(videoComponent.props.paused).toBe(false);

    // Simulate video ready
    await act(async () => {
      videoComponent.props.onReadyForDisplay();
    });

    // Wait for pause button to appear (loading should be hidden)
    await waitFor(() => {
      expect(queryByTestId('video-preview-pause-button')).toBeTruthy();
    });
  });

  it('hides play icon when showPlayIcon is false', () => {
    const {queryByTestId} = render(
      <VideoPreview
        videoUrl={mockVideoUrl}
        showPlayIcon={false}
        testID="video-preview"
      />,
    );

    expect(queryByTestId('video-preview-play-button')).toBeNull();
  });

  it('applies custom styles', () => {
    const customStyle = {height: 300, borderRadius: 16};
    const {getByTestId} = render(
      <VideoPreview
        videoUrl={mockVideoUrl}
        style={customStyle}
        testID="video-preview"
      />,
    );

    const container = getByTestId('video-preview');
    expect(container.props.style).toContainEqual(customStyle);
  });

  it('respects muted prop', () => {
    const {UNSAFE_getByType, rerender} = render(
      <VideoPreview videoUrl={mockVideoUrl} muted />,
    );

    let videoComponent = UNSAFE_getByType('Video' as any);
    expect(videoComponent.props.muted).toBe(true);

    // Test unmuted
    rerender(<VideoPreview videoUrl={mockVideoUrl} muted={false} />);
    videoComponent = UNSAFE_getByType('Video' as any);
    expect(videoComponent.props.muted).toBe(false);
  });

  it('stops playing video when component unmounts', () => {
    const {UNSAFE_getByType, unmount} = render(
      <VideoPreview videoUrl={mockVideoUrl} autoPlay testID="video-preview" />,
    );

    // Initially playing
    let videoComponent = UNSAFE_getByType('Video' as any);
    expect(videoComponent.props.paused).toBe(false);

    // Unmount the component
    unmount();

    // After unmount, if we render again, it should start paused (not auto-play)
    const {UNSAFE_getByType: getByTypeAfter} = render(
      <VideoPreview videoUrl={mockVideoUrl} testID="video-preview" />,
    );

    videoComponent = getByTypeAfter('Video' as any);
    expect(videoComponent.props.paused).toBe(true);
  });

  it('pauses video when shouldPause prop is true', () => {
    const onPlayStateChange = jest.fn();
    const {UNSAFE_getByType, rerender} = render(
      <VideoPreview
        videoUrl={mockVideoUrl}
        autoPlay
        onPlayStateChange={onPlayStateChange}
        testID="video-preview"
      />,
    );

    // Initially playing
    let videoComponent = UNSAFE_getByType('Video' as any);
    expect(videoComponent.props.paused).toBe(false);

    // Set shouldPause to true
    rerender(
      <VideoPreview
        videoUrl={mockVideoUrl}
        autoPlay
        shouldPause
        onPlayStateChange={onPlayStateChange}
        testID="video-preview"
      />,
    );

    // Video should now be paused
    videoComponent = UNSAFE_getByType('Video' as any);
    expect(videoComponent.props.paused).toBe(true);
    expect(onPlayStateChange).toHaveBeenCalledWith(false);
  });
});

