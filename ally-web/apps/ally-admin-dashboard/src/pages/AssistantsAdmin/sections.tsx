import React, { lazy } from "react";

import { FeatureToggleKey, Permissions } from "@constants";

import { ASSISTANTS_ADMIN_COPY as COPY } from "./copy";

/** What the signed-in staff member holds. Each section needs exactly one of these. */
export interface AdminAccess {
  costs: boolean;
  safety: boolean;
  system: boolean;
}

export type SectionId =
  | "overview"
  | "credits"
  | "pricing"
  | "safety"
  | "content"
  | "support"
  | "launch";

export interface AdminView {
  id: string;
  label: string;
  hint?: string;
  Panel: React.ComponentType;
}

export interface AdminSection {
  id: SectionId;
  label: string;
  purpose: string;
  tasks?: readonly string[];
  /** Whether this staff member may use the section at all. */
  allowed: (access: AdminAccess) => boolean;
  views: AdminView[];
  /** A cross-link shown under the section's intro. */
  note?: { text: string; linkLabel: string; to: { section: SectionId; view?: string } };
}

const lazyNamed = (load: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() => load().then(m => ({ default: m[name] as React.ComponentType })));

const Overview = lazyNamed(() => import("./OverviewPanel"), "OverviewPanel");
const StaffCredits = lazyNamed(() => import("./panels/embedded"), "CreditsPanel");
const Costs = lazyNamed(() => import("./panels/embedded"), "CostsPanel");
const ModelPrices = lazyNamed(() => import("./panels/embedded"), "ModelPricesPanel");
const WhatsAppRates = lazyNamed(() => import("./panels/embedded"), "WhatsAppRatesPanel");
const Plans = lazyNamed(() => import("./panels/embedded"), "PlansPanel");
const Packs = lazyNamed(() => import("./panels/embedded"), "SafetyPacksPanel");
const StartingSettings = lazyNamed(() => import("./panels/embedded"), "StartingSettingsView");
const QuickReplies = lazyNamed(() => import("./panels/embedded"), "QuickRepliesView");
const Library = lazyNamed(() => import("./panels/embedded"), "KnowledgeLibraryView");
const Channels = lazyNamed(() => import("./panels/embedded"), "ChannelsView");
const Support = lazyNamed(() => import("./panels/embedded"), "SupportPanel");
const Switches = lazyNamed(() => import("./LaunchPanels"), "SwitchesPanel");
const Checklist = lazyNamed(() => import("./LaunchPanels"), "ChecklistPanel");
const DataCleanup = lazyNamed(() => import("./LaunchPanels"), "DataPanel");

const S = COPY.sections;

/** Built lazily so nothing reads `@constants` while this module loads (circular imports). */
export const buildSections = (): AdminSection[] => [
  {
    id: "overview",
    label: S.overview.label,
    purpose: S.overview.purpose,
    allowed: () => true,
    views: [{ id: "main", label: S.overview.label, Panel: Overview }],
  },
  {
    id: "credits",
    label: S.credits.label,
    purpose: S.credits.purpose,
    tasks: S.credits.tasks,
    allowed: a => a.costs,
    views: [{ id: "accounts", label: S.credits.label, Panel: StaffCredits }],
  },
  {
    id: "pricing",
    label: S.pricing.label,
    purpose: S.pricing.purpose,
    allowed: a => a.costs,
    views: [
      { id: "costs", ...S.pricing.views.costs, Panel: Costs },
      { id: "models", ...S.pricing.views.models, Panel: ModelPrices },
      { id: "whatsapp", ...S.pricing.views.whatsapp, Panel: WhatsAppRates },
      { id: "plans", ...S.pricing.views.plans, Panel: Plans },
    ],
  },
  {
    id: "safety",
    label: S.safety.label,
    purpose: S.safety.purpose,
    tasks: S.safety.tasks,
    allowed: a => a.safety,
    views: [{ id: "packs", label: S.safety.label, Panel: Packs }],
    note: {
      text: S.safety.note.text,
      linkLabel: S.safety.note.linkLabel,
      to: { section: "content", view: "replies" },
    },
  },
  {
    id: "content",
    label: S.content.label,
    purpose: S.content.purpose,
    allowed: a => a.system,
    views: [
      { id: "settings", ...S.content.views.settings, Panel: StartingSettings },
      { id: "replies", ...S.content.views.replies, Panel: QuickReplies },
      { id: "library", ...S.content.views.library, Panel: Library },
      { id: "channels", ...S.content.views.channels, Panel: Channels },
    ],
  },
  {
    id: "support",
    label: S.support.label,
    purpose: S.support.purpose,
    tasks: S.support.tasks,
    allowed: a => a.system,
    views: [{ id: "search", label: S.support.label, Panel: Support }],
  },
  {
    id: "launch",
    label: S.launch.label,
    purpose: S.launch.purpose,
    allowed: a => a.system,
    views: [
      { id: "switches", ...S.launch.views.switches, Panel: Switches },
      { id: "checklist", ...S.launch.views.checklist, Panel: Checklist },
      { id: "data", ...S.launch.views.data, Panel: DataCleanup },
    ],
  },
];

export const accessFrom = (permissions: string[] = [], features: string[] = []): AdminAccess => ({
  costs: features.includes(FeatureToggleKey.MANAGE_COSTS),
  safety: permissions.includes(Permissions.MANAGE_SAFETY_PACKS),
  system: permissions.includes(Permissions.SYSTEM_ACCESS),
});

export const assistantsAdminPath = (base: string, section: SectionId, view?: string): string =>
  `${base}/${section}${view ? `?view=${view}` : ""}`;
