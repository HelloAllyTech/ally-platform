import * as fs from 'fs';
import * as path from 'path';
import {
  CourseCopilotLearnerProfileService,
  LearnerProfile,
  learnerProfileReference,
} from '../course-copilot-learner-profile.service';

describe('learner-profiles.json — the manual’s library, as parsed', () => {
  // Read the checked-in file directly, not through the service.
  const list = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', '..', 'data', 'learner-profiles.json'),
      'utf-8',
    ),
  ) as LearnerProfile[];

  it('holds all 19 profiles, numbered 1–19 in order, with unique slugs', () => {
    expect(list).toHaveLength(19);
    expect(list.map((profile) => profile.number)).toEqual(
      Array.from({ length: 19 }, (_, index) => index + 1),
    );
    expect(new Set(list.map((profile) => profile.id)).size).toBe(19);
    for (const profile of list) {
      expect(profile.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('gives every profile a group, name, matching, trainer view and full profile', () => {
    for (const profile of list) {
      expect(profile.group).toMatch(/^[A-F]\. \S/);
      expect(profile.name.trim()).not.toBe('');
      expect(profile.matching).toContain('Matches when the trainer says:');
      expect(profile.trainerView).toMatch(/^Draft profile/);
      expect(profile.fullProfile).toMatch(/^1\. Role and work/);
      expect(profile.fullProfile).toContain('Habitual responses');
    }
  });

  it('keeps the six clusters of the index', () => {
    expect([...new Set(list.map((profile) => profile.group))]).toEqual([
      'A. People without a formal role',
      'B. Volunteers, peers and helplines',
      'C. Frontline workers with mental health added to their role',
      'D. Non-specialist providers of care',
      'E. Mental health professionals',
      'F. Supervisors and trainers',
    ]);
  });
});

describe('CourseCopilotLearnerProfileService', () => {
  const service = new CourseCopilotLearnerProfileService();

  it('lists every profile compactly, with the first sentence of its trainer view', () => {
    const list = service.list();
    expect(list).toHaveLength(19);
    expect(list[0]).toEqual({
      id: 'laypeople',
      number: 1,
      name: 'Laypeople',
      group: 'A. People without a formal role',
      oneLine:
        'Adults with no mental health training or caring role, from any setting, who want to notice distress in people around them and respond well.',
    });
    for (const entry of list) {
      expect(entry.oneLine).not.toBe('');
      expect(entry).not.toHaveProperty('fullProfile');
    }
  });

  it('gets a profile in full by slug or by the manual’s number', () => {
    const byId = service.get('helpline-responders');
    expect(byId?.number).toBe(5);
    expect(byId?.fullProfile).toContain('Habitual responses');
    expect(service.get('5')).toEqual(byId);
    expect(service.get(5)).toEqual(byId);
    expect(service.get(' Helpline-Responders ')).toEqual(byId);
  });

  it('returns null for an unknown or empty id', () => {
    expect(service.get('astronauts')).toBeNull();
    expect(service.get('')).toBeNull();
    expect(service.get(undefined)).toBeNull();
    expect(service.get(42)).toBeNull();
  });

  it.each([
    ['ASHA workers in rural Karnataka', 'community-health-workers'],
    ['school teachers who want to support students', 'teachers'],
    [
      'volunteers answering a suicide prevention helpline',
      'helpline-responders',
    ],
    ['parents and family caregivers', 'family'],
    ['psychiatrists in a district hospital', 'psychiatrists'],
  ])('matches "%s" to %s first', (text, id) => {
    expect(service.match(text)[0]?.id).toBe(id);
  });

  it('returns no match for text with nothing in common', () => {
    expect(service.match('')).toEqual([]);
    expect(service.match('the and of')).toEqual([]);
  });

  it('caps the matches at the limit, best first', () => {
    const hits = service.match('counsellors psychologists therapists', 2);
    expect(hits).toHaveLength(2);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });
});

describe('learnerProfileReference', () => {
  it('carries the matched profile’s trainer view for the planner', () => {
    const text = learnerProfileReference('teachers');
    expect(text).toContain('LEARNER PROFILE');
    expect(text).toContain('"Teachers"');
    expect(text).toContain(
      new CourseCopilotLearnerProfileService().get('teachers')!.trainerView,
    );
  });

  it('is empty without a known profile', () => {
    expect(learnerProfileReference(undefined)).toBe('');
    expect(learnerProfileReference('nope')).toBe('');
  });
});
