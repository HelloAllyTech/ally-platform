import { ContentAccessService } from '../content-access.service';

/**
 * A ContentAccessService provider that allows everything — for specs of the
 * services that consult it, whose subject is something else. Its own rules
 * are covered by content-access.service.spec.ts.
 */
export const permissiveContentAccessProvider = () => ({
  provide: ContentAccessService,
  useValue: {
    ownerFilterFor: jest.fn().mockResolvedValue(null),
    canSee: jest.fn().mockResolvedValue(true),
    assertCanSee: jest.fn().mockResolvedValue(undefined),
    canAuthor: jest.fn().mockResolvedValue(true),
    assertCanAuthor: jest.fn().mockResolvedValue(undefined),
    assertCanModify: jest.fn().mockResolvedValue(undefined),
  },
});
