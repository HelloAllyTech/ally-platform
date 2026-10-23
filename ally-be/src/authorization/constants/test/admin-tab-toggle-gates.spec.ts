import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../admin-feature-toggle.constants';
import { BlogController } from 'src/blog/controller/blog.controller';
import { ProductUpdatesController } from 'src/product-updates/controller/product-updates.controller';
import { DynamicI18nController } from 'src/dynamic-i18n/controller/dynamic-i18n.controller';
import { SessionEventController } from 'src/session-event/controller/session-event.controller';
import { LearnController } from 'src/learn/controller/learn.controller';
import { PromptsController } from 'src/prompt/controller/prompts.controller';
import { SkillExperimentController } from 'src/skill-experiment/controller/skill-experiment.controller';
import { BuilderEvalController } from 'src/builder/eval/controller/builder-eval.controller';
import { RoadmapOpportunityController } from 'src/product-roadmap/controller/roadmap-opportunity.controller';
import { RoadmapAdminController } from 'src/product-roadmap/controller/roadmap-admin.controller';
import { RoadmapCollaborationController } from 'src/product-roadmap/controller/roadmap-collaboration.controller';
import { BugHunterController } from 'src/bug-hunter/controller/bug-hunter.controller';
import { UserController } from 'src/user/controller/user.controller';
import { AuthorizationController } from 'src/authorization/controller/authorization.controller';
import { SimulationCreditsController } from 'src/learn/controller/simulation-credits.controller';
import { AuthController } from 'src/auth/controller/auth.controller';
import { TenantController } from 'src/tenant/controller/tenant.controller';
import { HelplineAdminController } from 'src/helpline/controller/helpline-admin.controller';
import { SettingsController } from 'src/settings/controller/settings.controller';
import { CustomFieldsController } from 'src/custom-fields/controller/custom-fields.controller';

/**
 * Which backend routes each sidebar-tab toggle gates — and, as deliberately,
 * which it does not.
 *
 * FeatureToggleGuard fails closed for anyone without admin toggle rows (tenant
 * ADMINs, learners, public visitors, X-API-Key services), so a route carries a
 * tab's toggle only when nothing but that tab (or another platform-admin-only
 * admin-console screen it belongs to) calls it. Every route in `open` is called
 * by something else — the reason sits next to it. Moving a route between the
 * two lists is a product decision; make it here, with the reason.
 *
 * Reads the decorator metadata off each handler, so it fails on the decorator
 * itself the moment a gate drifts.
 */
type Controller = new (...args: never[]) => object;

const featureKeyOf = (controller: Controller, handler: string) => {
  const fn = (controller.prototype as Record<string, unknown>)[handler];
  if (typeof fn !== 'function') {
    throw new Error(`${controller.name}.${handler} does not exist`);
  }
  return Reflect.getMetadata(FEATURE_TOGGLE_KEY, fn)?.featureKey;
};

const SURFACES: {
  key: FeatureToggleKey;
  controller: Controller;
  gated: string[];
  open: Record<string, string>;
}[] = [
  {
    key: FeatureToggleKey.BLOG,
    controller: BlogController,
    gated: [
      'createImageUploadUrl',
      'create',
      'getBlogs',
      'getById',
      'update',
      'publish',
      'unpublish',
      'delete',
    ],
    open: {
      getPublishedBlogs: 'public blog (helpline app)',
      getPublishedTags: 'public blog (helpline app)',
      getPublishedBySlug: 'public blog (helpline app)',
    },
  },
  {
    key: FeatureToggleKey.PRODUCT_UPDATES,
    controller: ProductUpdatesController,
    gated: ['status', 'run', 'list', 'get', 'update'],
    open: { listPublic: 'public changelog (helpline app /blog/changelog)' },
  },
  {
    key: FeatureToggleKey.TRANSLATIONS,
    controller: DynamicI18nController,
    gated: [
      'getStatus',
      'updateTranslations',
      'autoTranslate',
      'getDiff',
      'publish',
      'rollback',
      'getAuditLogs',
    ],
    open: {
      listTranslations: 'Roleplay Session Logs transcript disclaimer',
      ciSync: 'CI release workflow, over an API key',
    },
  },
  {
    key: FeatureToggleKey.EVENTS,
    controller: SessionEventController,
    gated: ['updateSessionEvents', 'deleteSessionEvents'],
    open: {
      getAllSessionEvents: 'roleplay builder event map + auto-termination',
      createSessionEvents: 'roleplay builder creates events inline',
      getUniqueTags: 'roleplay builder event generation panel',
      generateEventBuilderField: 'roleplay builder event generation panel',
    },
  },
  {
    key: FeatureToggleKey.SCENARIO_VOICES,
    controller: LearnController,
    gated: [
      'createScenarioVoices',
      'updateScenarioVoice',
      'syncElevenLabsVoice',
      'lookupElevenLabsVoice',
      'getTtsCatalog',
      'bulkSyncElevenLabsVoices',
    ],
    open: {
      getScenarioVoices: 'Character Library voice pickers',
      getScenarioVoiceLanguagesForAdmin: 'roleplay builder voice picker',
    },
  },
  {
    key: FeatureToggleKey.PROMPTS,
    controller: PromptsController,
    gated: [
      'backfillTranslations',
      'retranslatePrompt',
      'retranslatePromptLanguage',
      'setTranslationRuntimeModel',
      'duplicatePrompt',
      'createPrompts',
      'updatePrompt',
      'revertPrompt',
      'deleteObsoletePrompt',
      'getPromptUsage',
    ],
    open: {
      getPrompts: 'roleplay builder role-instruction lookup',
      getPromptsByType: 'roleplay builder prompt pickers',
      listPromptTranslations: 'roleplay builder main-prompt variant picker',
      getPromptsByCodes: 'ally-ai drift judge, over an API key',
      syncPrompts: 'ally-ai / ally-ai-learn prompt sync, over an API key',
    },
  },
  {
    key: FeatureToggleKey.PROMPTS,
    controller: SkillExperimentController,
    gated: [
      'list',
      'get',
      'configure',
      'start',
      'stop',
      'resume',
      'apply',
      'observations',
    ],
    open: {},
  },
  {
    key: FeatureToggleKey.PROMPTS,
    controller: BuilderEvalController,
    gated: ['gatedPrompts'],
    open: {},
  },
  // Product Roadmap: the tab's reads and voter writes. Routes already behind
  // PRODUCT_ROADMAP_MANAGE / QUICK_ADD / BUILDER keep that key — the guard
  // takes one, and those are explicit grants on top of the tab.
  {
    key: FeatureToggleKey.PRODUCT_ROADMAP,
    controller: RoadmapOpportunityController,
    gated: [
      'list',
      'board',
      'facets',
      'budget',
      'findOne',
      'findBrief',
      'findVoters',
      'create',
      'createReferenceImageUploadUrl',
      'setAllocation',
    ],
    open: { createBugReport: 'Report a bug — helpline and mobile apps' },
  },
  {
    key: FeatureToggleKey.PRODUCT_ROADMAP,
    controller: RoadmapAdminController,
    gated: [
      'listEligibleOwners',
      'listOwners',
      'getStrategyContext',
      'listStrategyGoals',
      'getRankWeights',
      'listGoalImpact',
      'listInterviews',
      'createInterview',
      'updateInterview',
      'removeInterview',
      'readinessCriteria',
      'classify',
      'summarise',
      'opportunityInterview',
      'opportunityInterviewStream',
    ],
    open: {
      listGoals: 'Analytics → Suggestions',
      duplicates: 'Analytics → Suggestions accept modal',
    },
  },
  {
    key: FeatureToggleKey.PRODUCT_ROADMAP,
    controller: RoadmapCollaborationController,
    gated: [
      'listComments',
      'createComment',
      'updateComment',
      'removeComment',
      'listViews',
      'getTabOrder',
      'setTabOrder',
      'createView',
      'updateView',
      'removeView',
    ],
    open: {},
  },
  {
    key: FeatureToggleKey.PRODUCT_ROADMAP,
    controller: BugHunterController,
    gated: [],
    // One read group, pinned open to every roadmap viewer by
    // bug-hunter.controller.gating.spec.ts; two of them are the Bug Hunter
    // tab's own reads, so gating only the deep link would protect nothing.
    open: {
      listFindings: 'Bug Hunter tab',
      getFinding: 'Bug Hunter tab finding drawer',
      getFindingByReportedBug: 'same finding data as getFinding',
    },
  },
  // Users: organizations and their users. Routes behind
  // @TenantScopedPermissions / @PlatformWidePermissions (content assignment,
  // cohorts, org badges, dashboards) are left alone: they already decide
  // permissions themselves, and stacking a second gate would fight over the
  // same metadata.
  {
    key: FeatureToggleKey.USERS,
    controller: UserController,
    gated: [
      'getAllUsers',
      'addUser',
      'bulkAddUsers',
      'updateUser',
      'updateUserStatus',
    ],
    open: {},
  },
  {
    key: FeatureToggleKey.USERS,
    controller: AuthorizationController,
    gated: ['changeUserRoles'],
    open: { getAllRoles: 'User Badges side panel' },
  },
  {
    key: FeatureToggleKey.USERS,
    controller: SimulationCreditsController,
    gated: ['updateSimulationCredits'],
    open: {},
  },
  {
    key: FeatureToggleKey.USERS,
    controller: AuthController,
    gated: ['impersonate'],
    open: {},
  },
  {
    key: FeatureToggleKey.USERS,
    controller: TenantController,
    gated: [
      'create',
      'findById',
      'updateTenant',
      'getPresignedUrlForOrganizationLogo',
      'deleteOrganizationLogo',
    ],
    open: {
      getAllTenants: 'Analytics, WhatsApp Bot and corpus organization pickers',
    },
  },
  {
    key: FeatureToggleKey.USERS,
    controller: HelplineAdminController,
    gated: ['getSettings', 'updateSettings'],
    open: {},
  },
  {
    key: FeatureToggleKey.USERS,
    controller: SettingsController,
    gated: [
      'updateSummaryFields',
      'updateSummarySections',
      'updateCharacterLibraryEnabled',
      'updateProgressDashboardEnabled',
      'updateTextChatRoleplayEnabled',
      'updateCustomFieldsEnabled',
      'updateScribeNoteCreationEnabled',
      'updateScribeVoiceNoteEnabled',
      'updateEnabledCustomFieldTypes',
    ],
    open: {
      getSummarySections: 'helpline call logs',
      getEnabledCustomFieldTypes: 'helpline and mobile custom fields',
      getCharacterLibraryEnabled: 'helpline + tenant-admin Character Library',
    },
  },
  {
    key: FeatureToggleKey.USERS,
    controller: CustomFieldsController,
    gated: [],
    open: {
      getDefinitions: 'helpline call logs and mobile',
      createDefinition: 'helpline call logs (tenant ADMIN)',
      updateDefinition: 'helpline call logs (tenant ADMIN)',
      deleteDefinition: 'helpline call logs (tenant ADMIN)',
    },
  },
];

describe('sidebar-tab toggles on backend routes', () => {
  for (const { key, controller, gated, open } of SURFACES) {
    describe(`${controller.name} (${key})`, () => {
      if (gated.length > 0) {
        it.each(gated)(`%s requires the ${key} toggle`, (handler) => {
          expect(featureKeyOf(controller, handler)).toBe(key);
        });
      }

      const openEntries = Object.entries(open);
      if (openEntries.length === 0) return;
      it.each(openEntries)(
        '%s stays free of the tab toggle — %s',
        (handler) => {
          expect(featureKeyOf(controller, handler)).not.toBe(key);
        },
      );
    });
  }
});
