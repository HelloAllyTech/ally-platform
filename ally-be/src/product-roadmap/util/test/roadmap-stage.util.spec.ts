import { RoadmapOpportunityStage } from '../../enum/roadmap-opportunity.enum';
import { normaliseStage } from '../roadmap-stage.util';

describe('normaliseStage', () => {
  it('folds the retired under_development stage into Prioritised', () => {
    expect(normaliseStage(RoadmapOpportunityStage.UNDER_DEVELOPMENT)).toBe(
      RoadmapOpportunityStage.PRIORITISED,
    );
  });

  it.each([
    RoadmapOpportunityStage.NEW,
    RoadmapOpportunityStage.PRIORITISED,
    RoadmapOpportunityStage.RELEASED,
    RoadmapOpportunityStage.ARCHIVED,
  ])('leaves %s untouched', (stage) => {
    expect(normaliseStage(stage)).toBe(stage);
  });

  it('passes null through so an override can still be cleared', () => {
    expect(normaliseStage(null)).toBeNull();
  });
});
