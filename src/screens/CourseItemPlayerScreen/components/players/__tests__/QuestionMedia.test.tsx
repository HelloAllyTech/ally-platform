import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {QuestionMedia as QuestionMediaValue} from '@/types';

import {QuestionMedia} from '../QuestionMedia';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

jest.mock('react-native-video', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: ({testID, source, paused, controls, poster}: any) => (
      <RN.View
        testID={testID}
        accessibilityValue={{
          text: `${source?.uri}|paused=${paused}|controls=${controls}|poster=${poster}`,
        }}
      />
    ),
  };
});

jest.mock('react-native-webview', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: ({testID, source}: any) => (
      <RN.View testID={testID} accessibilityValue={{text: source?.uri}} />
    ),
  };
});

const image: QuestionMediaValue = {
  kind: 'image',
  source: 's3',
  url: 'https://bucket.s3.ap-south-1.amazonaws.com/track-media/question_image/1-ankle.png',
  alt: 'A swollen left ankle',
};

describe('QuestionMedia', () => {
  it('renders nothing when a question carries no media', () => {
    const {toJSON} = render(<QuestionMedia media={undefined} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing for media with an empty URL', () => {
    const {toJSON} = render(<QuestionMedia media={{...image, url: ''}} />);
    expect(toJSON()).toBeNull();
  });

  it("labels the image with the trainer's description for screen readers", () => {
    const {getByTestId} = render(<QuestionMedia media={image} />);
    expect(
      getByTestId('question-media-image').props.accessibilityLabel,
    ).toBe('A swollen left ankle');
  });

  it('opens a full-size view when the image is tapped', () => {
    const {getByTestId, queryByLabelText, getByLabelText} = render(
      <QuestionMedia media={image} />,
    );
    expect(queryByLabelText('courses.question.media.close')).toBeNull();
    fireEvent.press(getByTestId('question-media-image'));
    expect(getByLabelText('courses.question.media.close')).toBeTruthy();
  });

  // A grey rectangle on a bad connection reads as "this question is broken".
  it('explains a failed image instead of leaving a blank frame', () => {
    const {getByTestId, getByText} = render(<QuestionMedia media={image} />);
    fireEvent(getByTestId('question-media-image').children[0] as never, 'error');
    expect(getByTestId('question-media-failed')).toBeTruthy();
    expect(getByText('A swollen left ankle')).toBeTruthy();
  });

  it('resets failure state when the media URL changes', () => {
    const {getByTestId, queryByTestId, rerender} = render(
      <QuestionMedia media={image} />,
    );

    // First image fails
    fireEvent(getByTestId('question-media-image').children[0] as never, 'error');
    expect(getByTestId('question-media-failed')).toBeTruthy();

    // Rerender with a new URL
    const newImage = {...image, url: 'https://example.com/new-image.png'};
    rerender(<QuestionMedia media={newImage} />);

    // The failure message should be gone
    expect(queryByTestId('question-media-failed')).toBeNull();
  });

  it('plays an uploaded video inline, paused until the learner starts it', () => {
    const {getByTestId} = render(
      <QuestionMedia
        media={{
          kind: 'video',
          source: 's3',
          url: 'https://cdn.example.com/clip.mp4',
        }}
      />,
    );
    expect(
      getByTestId('question-media-video').props.accessibilityValue.text,
    ).toBe(
      'https://cdn.example.com/clip.mp4|paused=true|controls=true|poster=undefined',
    );
  });

  // Without a poster, ExoPlayer is not guaranteed to paint anything before
  // playback starts — a black box in place of the thing being observed.
  it('shows the captured poster frame before the learner presses play', () => {
    const {getByTestId} = render(
      <QuestionMedia
        media={{
          kind: 'video',
          source: 's3',
          url: 'https://cdn.example.com/clip.mp4',
          posterUrl: 'https://cdn.example.com/clip-poster.jpg',
        }}
      />,
    );
    expect(
      getByTestId('question-media-video').props.accessibilityValue.text,
    ).toContain('poster=https://cdn.example.com/clip-poster.jpg');
  });

  it.each([
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ],
    ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://www.loom.com/share/abc123', 'https://www.loom.com/embed/abc123'],
  ])('embeds %s inline rather than sending the learner out', (url, expected) => {
    const {getByTestId} = render(
      <QuestionMedia media={{kind: 'video', source: 'youtube', url}} />,
    );
    expect(
      getByTestId('question-media-embed').props.accessibilityValue.text,
    ).toBe(expected);
  });

  it('renders nothing for a video URL it cannot embed', () => {
    const {toJSON} = render(
      <QuestionMedia
        media={{
          kind: 'video',
          source: 'youtube',
          url: 'https://videos.example.com/clip',
        }}
      />,
    );
    expect(toJSON()).toBeNull();
  });
});
