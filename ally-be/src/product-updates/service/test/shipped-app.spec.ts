import { shippedApp } from 'src/release/constants/release-targets.constants';

describe('shippedApp', () => {
  const title = (apps: string) =>
    `Production Release - Frontends frontend-v1.0.1 [apps=${apps}]`;

  it('counts a run for the app it shipped and for apps=both', () => {
    expect(shippedApp(title('admin'), 'admin')).toBe(true);
    expect(shippedApp(title('both'), 'helpline')).toBe(true);
  });

  it('does not count a helpline-only run as an admin release', () => {
    expect(shippedApp(title('helpline'), 'admin')).toBe(false);
  });

  it('counts a run with no marker, which predates it and shipped both', () => {
    expect(shippedApp('Production Release - Frontends', 'admin')).toBe(true);
  });

  it('never filters a deployable that has no apps input', () => {
    expect(shippedApp(title('helpline'), undefined)).toBe(true);
  });
});
