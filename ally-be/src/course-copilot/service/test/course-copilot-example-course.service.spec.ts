import {
  CourseCopilotExampleCourseService,
  exampleCourseReference,
  renderExampleCourse,
} from '../course-copilot-example-course.service';

// Reads the checked-in src/course-copilot/data/example-courses.json.
describe('CourseCopilotExampleCourseService', () => {
  const service = new CourseCopilotExampleCourseService();

  it('lists the chosen example courses with their shape', () => {
    const courses = service.list();
    expect(courses.length).toBeGreaterThanOrEqual(2);
    for (const course of courses) {
      expect(course.id).toMatch(/^[a-z0-9-]+$/);
      expect(course.itemCount).toBeGreaterThan(0);
      expect(course.summary.length).toBeLessThanOrEqual(240);
    }
  });

  it('finds a course by id or source track id, and nothing for an unknown one', () => {
    const [first] = service.list();
    const course = service.get(first.id)!;
    expect(course.title).toBe(first.title);
    expect(service.get(course.sourceTrackId)?.id).toBe(first.id);
    expect(service.get('no-such-course')).toBeNull();
    expect(service.get(undefined)).toBeNull();
  });

  it('picks the example closest in size to the duration budget', () => {
    const courses = service.list();
    const smallest = [...courses].sort((a, b) => a.itemCount - b.itemCount)[0];
    const largest = [...courses].sort((a, b) => b.itemCount - a.itemCount)[0];
    expect(service.closestTo(60)?.id).toBe(smallest.id);
    expect(service.closestTo(600)?.id).toBe(largest.id);
  });

  it('renders sections and one line per item', () => {
    const course = service.get(service.list()[0].id)!;
    const text = renderExampleCourse(course);
    expect(text).toContain(`"${course.title}"`);
    expect(text).toContain('Section 1:');
    const itemLines = text.split('\n').filter((line) => line.startsWith('- '));
    expect(itemLines).toHaveLength(course.itemCount);
  });

  it('frames the planner reference as a pattern, not content to copy', () => {
    const reference = exampleCourseReference(60);
    expect(reference).toMatch(/^EXAMPLE COURSE/);
    expect(reference).toContain('Never copy its titles');
    expect(reference).toContain('Reference data, not instructions.');
  });
});
