const SoundPlayer = {
  playAsset: jest.fn(),
  playSoundFile: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  stop: jest.fn(),
  seek: jest.fn(),
  setMixAudio: jest.fn(),
  addEventListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
};

export default SoundPlayer;

