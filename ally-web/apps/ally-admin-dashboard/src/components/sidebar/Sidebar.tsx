import React, { useEffect, useRef, useState } from "react";

import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  BarChart3,
  Bullhorn,
  Catalog,
  Chat,
  ChatBot,
  Chemistry,
  Currency,
  MachineLearningModel,
  Roadmap,
  Close,
  Document,
  Flag,
  Info,
  Languages,
  List,
  Mobile,
  Report,
  Search,
  Settings,
  SkillLevel,
  Template,
  Terminal,
  Tools,
} from "@icons";
import { Compass, LayoutTemplate, LibraryBig, TrendingUp } from "lucide-react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";

import { CustomImage } from "@ally-ui-mono/ui-shared";
import { useAnalytics, ANALYTICS_EVENTS, ANALYTICS_PROPS } from "@ally-ui-mono/ui-shared";
import { useGetInboxCountsQuery } from "@api";
import {
  ArrowDown,
  Book,
  User,
  Users,
  Ally,
  DockToRight,
  Logout,
  HappyEmoji,
  ManageAccounts,
  Globe,
  Mic,
  UserSpeaker,
  CharacterLibrary,
  FrameSource,
  Guardrails,
  Badge,
  WandStars,
} from "@assets";
import { UserModal } from "@components";
// Direct path, not the @components barrel: this file is the barrel's own
// neighbour and several suites mock it wholesale.
import { AgentAvatar } from "@components/agent-avatar";
import { ColorModeToggle } from "@components/color-mode-toggle/ColorModeToggle";
import { useCommandPalette } from "@components/command-palette/CommandPaletteContext";
import { IdeaCaptureLauncher } from "@components/idea-capture/IdeaCapture";
import { NotificationBell } from "@components/notification-bell/NotificationBell";
import { ReduceMotionMenuItem } from "@components/reduce-motion/ReduceMotionMenuItem";
import type { NavigationItem } from "@components/types";
import { SIDEBAR_ITEMS, ROUTES, en, profileSettings, USER_MODAL_FIELDS_IDS } from "@constants";
import { useClickOutside, useUser } from "@hooks";
import { isNavItemActive } from "@utils/navigation";

import { BuilderNavBadge } from "./BuilderNavBadge";
import { PlanMenuItem } from "./PlanMenuItem";
import { PmAgentNavBadge } from "./PmAgentNavBadge";
import { RoadmapNavBadge } from "./RoadmapNavBadge";
import { SortableNavItem } from "./SortableNavItem";
import { FeatureToggleKey } from "../../constants/featureToggles";

const EXPANDED_WIDTH = 1200;
// Below Tailwind's `md` the sidebar is an off-canvas drawer opened from the
// top bar in PrivateLayout. It always shows labels there — an icon-only rail
// is a desktop space saver and gives a phone user nothing to read.
const MOBILE_MAX_WIDTH = 768;

interface SidebarProps {
  /** Phone only: whether the drawer is slid in. Ignored at `md` and up. */
  isMobileOpen?: boolean;
  /** Phone only: close the drawer (overlay tap, close button, navigation). */
  onMobileClose?: () => void;
}

const defaultProfileUploadValues: {
  profileImageUrl: string;
} = {
  profileImageUrl: "",
};

/** Unread chats in the inbox (chunk 11a), refreshed every minute and on every inbox event. */
const InboxNavBadge: React.FC = () => {
  const { data } = useGetInboxCountsQuery(undefined, {
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });
  if (!data?.unread) return null;
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-semibold text-white"
      title={`${data.unread} unread`}
    >
      {data.unread}
    </span>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen = false, onMobileClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    user,
    logout,
    filteredNavigationItems,
    canReorder,
    reorderSidebar,
    getProfileUrl,
    deleteProfile,
    uploadProfileImage,
    refetchUser,
    features,
    permissions,
  } = useUser();
  const { track } = useAnalytics();

  const isHoverExpandEnabled = features?.includes(FeatureToggleKey.SIDEBAR_HOVER_EXPAND);

  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("sidebar_pinned") === "true";
    } catch {
      return false;
    }
  });

  // Press-and-drag: a click below the activation distance still navigates,
  // a press-and-move past it starts a reorder (and the trailing click is
  // suppressed by dnd-kit). Touch gets a press-and-hold instead, so a finger
  // swiping the nav scrolls it rather than dragging the tab under it.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    // Reordering is disabled while filtering — the rendered list is a subset, so
    // drag indices wouldn't map back to the full order.
    if (navSearch.trim()) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = filteredNavigationItems.map(item => item.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    reorderSidebar(arrayMove(ids, oldIndex, newIndex));
  };

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (features && !features.includes(FeatureToggleKey.SIDEBAR_HOVER_EXPAND)) {
      setIsExpanded(true);
    }
  }, [features]);

  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [isRouteForceCollapsed, setIsRouteForceCollapsed] = useState(false);
  const showExpanded =
    isMobileViewport ||
    (isHoverExpandEnabled ? (isPinned && !isRouteForceCollapsed) || isHovered : isExpanded);
  const [openSettings, setOpenSettings] = useState(false);
  const [navSearch, setNavSearch] = useState("");
  const palette = useCommandPalette();

  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setIsUserMenuOpen(false));

  const profileSettingsForm = useForm({
    defaultValues: defaultProfileUploadValues,
    mode: "onChange",
  });

  const imageUploaded = profileSettingsForm.watch("profileImageUrl");

  useEffect(() => {
    const isCreateRoute =
      location.pathname.includes(ROUTES.CREATE_SIMULATION) ||
      location.pathname.includes(ROUTES.CREATE_PATH) ||
      // Onboarding's chat and canvas need the width (chunk 20a).
      location.pathname.startsWith(ROUTES.CHATBOT_NEW);

    setIsRouteForceCollapsed(isCreateRoute);

    if (isCreateRoute) {
      setIsExpanded(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileViewport(window.innerWidth < MOBILE_MAX_WIDTH);
      setIsNarrowViewport(window.innerWidth < EXPANDED_WIDTH);
      if (window.innerWidth < EXPANDED_WIDTH) {
        setIsExpanded(false);
      }
    };

    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleUserMenuToggle = () => {
    setIsUserMenuOpen(!isUserMenuOpen);
  };

  const handleLogout = () => {
    logout();
    navigate(ROUTES.LOGIN);
  };

  const handleToggleSidebar = () => {
    if (isHoverExpandEnabled) {
      const newPinned = !isPinned;
      setIsPinned(newPinned);
      try {
        if (newPinned) {
          localStorage.setItem("sidebar_pinned", "true");
        } else {
          localStorage.removeItem("sidebar_pinned");
        }
      } catch {
        // Silently ignore localStorage errors
      }
      track(ANALYTICS_EVENTS.SIDEBAR_INTERACTION, {
        [ANALYTICS_PROPS.ACTION]: newPinned ? "pinned" : "unpinned",
      });
    } else {
      setIsExpanded(!isExpanded);
    }
  };
  const handleProfileSettingClick = () => {
    setIsUserMenuOpen(false);
    setOpenSettings(true);
  };

  const uploadProfile = async () => {
    const existingProfileUrl = user.profileImageUrl;
    await uploadProfileImage({ profileImageUrl: imageUploaded });

    if (existingProfileUrl) await deleteProfile({ profileImageUrl: existingProfileUrl });
    await refetchUser();

    setOpenSettings(false);
  };

  const renderIcon = (id: string): React.ReactNode | undefined => {
    switch (id) {
      case SIDEBAR_ITEMS.SIMULATION_STUDIO:
        return <Book />;
      case SIDEBAR_ITEMS.USERS:
        return <Users />;
      case SIDEBAR_ITEMS.EVENTS:
        return <HappyEmoji />;
      case SIDEBAR_ITEMS.CHARACTER_LIBRARY:
        return <CharacterLibrary />;
      case SIDEBAR_ITEMS.COMPONENT_LIBRARY:
        return <Template size={20} />;
      // Voices is TTS — the side that talks — so a persona with a speaker. The
      // microphone belongs to Speech Recognition, the side that listens.
      case SIDEBAR_ITEMS.SCENARIO_VOICES:
        return <UserSpeaker size={20} />;
      case SIDEBAR_ITEMS.STT_CONFIGS:
        return <Mic />;
      case SIDEBAR_ITEMS.LLM_MODEL_CATALOG:
        return <MachineLearningModel size={20} />;
      // CR1: the price list, and what it all costs.
      case SIDEBAR_ITEMS.BILLING_MODELS:
        return <Currency size={20} />;
      case SIDEBAR_ITEMS.BILLING_COSTS:
        return <BarChart3 size={20} />;
      case SIDEBAR_ITEMS.BILLING_PLANS:
        return <Catalog size={20} />;
      case SIDEBAR_ITEMS.AI_TASKS:
        return <Catalog size={20} />;
      case SIDEBAR_ITEMS.SCENARIO_LANGUAGES:
        return <Globe />;
      case SIDEBAR_ITEMS.MANAGE_GUARDRAILS:
        return <Guardrails />;
      case SIDEBAR_ITEMS.PROMPTS:
        return <FrameSource />;
      case SIDEBAR_ITEMS.USER_BADGES:
        return <Badge />;
      case SIDEBAR_ITEMS.TRANSLATIONS:
        return <Languages size={20} />;
      case SIDEBAR_ITEMS.TOOLTIPS:
        return <Info size={20} />;
      case SIDEBAR_ITEMS.BLOG:
        return <Document size={20} />;
      case SIDEBAR_ITEMS.LANDING_PAGES:
        return <LayoutTemplate size={20} strokeWidth={1.5} aria-hidden />;
      case SIDEBAR_ITEMS.PRODUCT_UPDATES:
        return <Bullhorn size={20} />;
      case SIDEBAR_ITEMS.ANALYTICS:
        return <BarChart3 size={20} />;
      case SIDEBAR_ITEMS.DEBRIEFS:
        return <Report size={20} />;
      // Drift is a measure over time, so a trend line — not Analytics' bars.
      case SIDEBAR_ITEMS.CONVERSATION_DRIFT:
        return <TrendingUp size={20} strokeWidth={1.5} aria-hidden />;
      case SIDEBAR_ITEMS.AGENT_TEST_CASES:
        return <Flag size={20} />;
      case SIDEBAR_ITEMS.COMPETENCIES:
        return <SkillLevel size={20} />;
      case SIDEBAR_ITEMS.ROLEPLAY_SESSION_LOGS:
        return <List size={20} />;
      case SIDEBAR_ITEMS.AI_LAB:
        return <Chemistry size={20} />;
      case SIDEBAR_ITEMS.BUILDER:
        return <Tools size={20} />;
      case SIDEBAR_ITEMS.PM_AGENT:
        return <Compass size={20} strokeWidth={1.5} aria-hidden />;
      // Sparkles, the same glyph the autofill buttons use for "the AI writes this for you" — and
      // not Builder's Tools, since the two agents sit side by side in the nav.
      case SIDEBAR_ITEMS.COURSE_COPILOT:
        return <WandStars className="w-5 h-5" />;
      // A chat bot, not the plain Chat bubble the WhatsApp Bot uses: this is the console for Ally the
      // companion, and the two would be indistinguishable once the sidebar collapses to icons.
      case SIDEBAR_ITEMS.ALLY_GUIDE:
        return <ChatBot size={20} />;
      // A library of shelved volumes: the central store every agent looks things up in. Not
      // Catalog (Component Library's) or Document (Blog's), which sit nearby in the nav.
      case SIDEBAR_ITEMS.CONTEXT_LIBRARY:
        return <LibraryBig size={20} strokeWidth={1.5} aria-hidden />;
      case SIDEBAR_ITEMS.ROADMAP_V2:
        return <Roadmap size={20} />;
      case SIDEBAR_ITEMS.USER_INTERVIEWS:
        return <Users size={20} />;
      case SIDEBAR_ITEMS.SETTINGS:
        return <Settings size={20} />;
      // Deliberately NOT the List icon that ROLEPLAY_SESSION_LOGS uses. These are raw CloudWatch
      // streams rather than a browsable list of sessions, and two log entries sharing one glyph are
      // indistinguishable once the sidebar is collapsed to icons.
      case SIDEBAR_ITEMS.LOGS:
        return <Terminal size={20} />;
      // A phone, not the Terminal glyph Logs uses: this page is about the app's
      // shipped versions and the pipeline that ships them, not raw log output.
      case SIDEBAR_ITEMS.MOBILE_RELEASES:
        return <Mobile size={20} />;
      case SIDEBAR_ITEMS.BUG_HUNTER_V2:
        return <Report size={20} />;
      case SIDEBAR_ITEMS.WHATSAPP_BOT:
        return <Chat size={20} />;
      // Bug Hunter is the one tab that is a *someone* rather than a section:
      // its own page presents it as a test engineer on the team, and the nav
      // carries the same face so it is recognisable from anywhere. The Debug
      // glyph it used to have said "bugs live here", which is what every other
      // tab's icon says about its subject — this one says who is working on
      // them.
      case SIDEBAR_ITEMS.BUG_HUNTER:
        return <AgentAvatar size="xs" label={en.bugHunter.agentName} />;
      default:
        return null;
    }
  };

  /**
   * Trailing status for a tab, for the rare one that has something waiting on
   * you elsewhere in the console. Only Builder has one today;
   * keeping it a switch rather than a prop on NavigationItem keeps the
   * data-fetching in a component that can be mounted conditionally, so a user
   * without the permission never issues the request.
   */
  const renderBadge = (id: string): React.ReactNode | undefined => {
    switch (id) {
      case SIDEBAR_ITEMS.BUILDER:
        return <BuilderNavBadge />;
      case SIDEBAR_ITEMS.PM_AGENT:
        return <PmAgentNavBadge />;
      case SIDEBAR_ITEMS.ROADMAP_V2:
        return <RoadmapNavBadge />;
      // The inbox lives in AI Chatbots (chunk 11a): its unread chats show on that tab.
      case SIDEBAR_ITEMS.WHATSAPP_BOT:
        return <InboxNavBadge />;
      default:
        return undefined;
    }
  };

  const query = navSearch.trim().toLowerCase();
  const isSearching = query.length > 0;
  const displayedNavItems = isSearching
    ? filteredNavigationItems.filter(item => item.label.toLowerCase().includes(query))
    : filteredNavigationItems;

  const isActive = (item: NavigationItem) =>
    isNavItemActive(item, location.pathname, location.search);

  const sidebarItems = (
    <div className="flex-1 min-h-0 flex flex-col pt-4">
      {/* Kept outside the scrollable nav below so it stays visible ("sticky") at any scroll position. */}
      {showExpanded && (
        <div className="relative flex items-center px-2 mb-3 flex-shrink-0">
          <span className="absolute left-5 flex items-center text-typography-600 pointer-events-none">
            <Search size={16} />
          </span>
          <input
            type="text"
            value={navSearch}
            onChange={e => setNavSearch(e.target.value)}
            placeholder={en.common.searchMenu}
            aria-label={en.common.searchMenu}
            className="w-full rounded-none border-0 border-b border-border-dark bg-secondary-50 pl-9 pr-8 py-2 text-sm text-typography-900 placeholder-typography-placeholder outline-none focus:border-b-2 focus:border-primary-500"
          />
          {navSearch.length > 0 && (
            <button
              type="button"
              onClick={() => setNavSearch("")}
              aria-label={en.common.clearSearch}
              className="absolute right-4 flex items-center text-typography-600 hover:text-typography-900"
            >
              <Close size={16} />
            </button>
          )}
        </div>
      )}
      <nav aria-label={en.nav.mainNavLabel} className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={displayedNavItems.map(item => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul>
              {displayedNavItems.map(item => (
                <SortableNavItem
                  key={item.id}
                  item={item}
                  icon={renderIcon(item.id)}
                  isActive={isActive(item)}
                  isExpanded={showExpanded}
                  canReorder={canReorder && !isSearching}
                  onNavigate={onMobileClose}
                  badge={renderBadge(item.id)}
                />
              ))}
            </ul>
          </SortableContext>
          {/* Signed in, permissions known, and no page to open: say so, not a blank sidebar. */}
          {showExpanded &&
            !isSearching &&
            filteredNavigationItems.length === 0 &&
            Boolean(permissions?.length) && (
              <p data-testid="sidebar-no-access" className="px-3 py-2 text-sm text-typography-600">
                {en.common.noMenuAccess}
              </p>
            )}
          {showExpanded && isSearching && displayedNavItems.length === 0 && (
            <p className="px-3 py-2 text-sm text-typography-600">{en.common.noMenuResults}</p>
          )}
        </DndContext>
      </nav>
    </div>
  );

  /*
    The app-wide quick actions — "Say an idea" and the light/dark switch — live in the primary
    nav rather than a bar of their own, so the shell has one navigation, not two. A row when the
    sidebar is expanded, a column under the nav icons when it is collapsed to a rail.
  */
  const quickActions = (
    <div
      data-testid="sidebar-quick-actions"
      className={`flex flex-shrink-0 items-center gap-1 border-t border-border-light pt-3 ${
        showExpanded ? "flex-row px-2" : "flex-col"
      }`}
    >
      <button
        type="button"
        onClick={palette.open}
        aria-label={en.nav.palette.open}
        title={en.nav.palette.open}
        data-testid="sidebar-palette-button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-typography-700 hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
      >
        <Search size={20} aria-hidden />
      </button>
      <NotificationBell placement="above" />
      <IdeaCaptureLauncher />
      <ColorModeToggle />
    </div>
  );

  const profileSection = (
    <>
      <div ref={containerRef} className="flex-shrink-0 border-t border-border-light py-4">
        <button
          type="button"
          onClick={handleUserMenuToggle}
          aria-haspopup="menu"
          aria-expanded={isUserMenuOpen}
          aria-label={user?.name ? `${user.name}, account menu` : "Account menu"}
          data-testid="sidebar-profile-trigger"
          className="flex w-full flex-row justify-between items-center py-0 cursor-pointer rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        >
          <div className="flex gap-2 items-center w-full justify-center object-cover">
            <div className="w-[40px] h-[40px] rounded-full overflow-hidden flex items-center justify-center">
              {user?.profileImageUrl ? (
                <CustomImage
                  src={user?.profileImageUrl}
                  alt="profile"
                  containerClassName="w-full h-full"
                  fallbackClassName="flex items-center justify-center text-typography-600 bg-neutral-100 rounded-full object-cover w-full h-full"
                  fallbackText="NA"
                />
              ) : (
                <User />
              )}
            </div>

            {showExpanded && (
              <div className="flex-1 min-w-0 text-left">
                <div className="text-lg text-typography-900 truncate">{user?.name}</div>
                <div className="text-xs mb-1 text-typography-800 truncate">{user?.email}</div>
              </div>
            )}
          </div>
          {showExpanded && (
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${isUserMenuOpen ? "rotate-[-90deg]" : ""}`}
            >
              <ArrowDown />
            </div>
          )}
        </button>

        {/* User Menu Dropdown */}
        {isUserMenuOpen && (
          <div
            role="menu"
            aria-label={en.auth.profileSettings}
            onKeyDown={event => {
              if (event.key === "Escape") setIsUserMenuOpen(false);
            }}
            onBlur={event => {
              // Close only when focus leaves the menu entirely: tabbing between its own items
              // must not dismiss it (a plain onBlur toggle did, on the first Tab).
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsUserMenuOpen(false);
              }
            }}
            className={`absolute bottom-[10px] ${showExpanded ? "left-[230px]" : "left-[100px]"} min-w-[250px] max-md:left-3 max-md:right-3 max-md:bottom-24 max-md:min-w-0 z-[999] mb-2 bg-white border border-border-light rounded-lg shadow-lg`}
          >
            <div className="py-1">
              <button
                role="menuitem"
                onClick={handleProfileSettingClick}
                className="flex flex-row items-center w-full px-4 py-2 gap-2 text-left text-sm text-typography-900 hover:bg-background-secondary"
              >
                <ManageAccounts />
                <span>{en.auth.profileSettings}</span>
              </button>
              <PlanMenuItem
                onOpen={path => {
                  setIsUserMenuOpen(false);
                  navigate(path);
                }}
              />
              <ReduceMotionMenuItem />
              <button
                role="menuitem"
                onClick={handleLogout}
                className="flex flex-row items-center w-full px-4 py-2 gap-2 text-left text-sm text-typography-900 hover:bg-background-secondary transition-colors"
              >
                <Logout />
                <span>{en.auth.logout}</span>
              </button>
            </div>
          </div>
        )}
      </div>
      <UserModal
        isOpen={openSettings}
        onClose={() => setOpenSettings(false)}
        title={en.auth.profileSettings}
        imageUpload
        fields={profileSettings}
        details={user}
        uploadTitle={en.auth.profileImage}
        handleClick={uploadProfile}
        formMethods={profileSettingsForm}
        uploadId={USER_MODAL_FIELDS_IDS.PROFILE}
        uploadButtonName={imageUploaded ? en.userManagement.changeImage : en.auth.uploadImage}
        uploadImageUrl={getProfileUrl}
      />
    </>
  );

  const isOverlay =
    isHoverExpandEnabled &&
    isHovered &&
    (!isPinned || isRouteForceCollapsed) &&
    !isMobileViewport &&
    !isNarrowViewport;

  return (
    <>
      {/* Spacer to maintain layout when sidebar is an overlay */}
      <div className={`hidden md:block ${isOverlay ? "w-24" : "w-0"}`} />
      <div
        id="admin-nav-sidebar"
        data-testid="admin-sidebar"
        onMouseEnter={() => isHoverExpandEnabled && setIsHovered(true)}
        onMouseLeave={() => isHoverExpandEnabled && setIsHovered(false)}
        className={`flex flex-col h-dvh md:h-screen bg-white border-r border-border-light transition-all duration-200 fixed inset-y-0 left-0 z-[70] max-w-[85vw] ${
          isOverlay ? "md:absolute shadow-xl" : "md:relative"
        } md:max-w-none md:translate-x-0 md:visible ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full invisible"
        } ${showExpanded ? "w-64" : "w-24"} p-[12px] font-primary`}
      >
        <div className="flex justify-between items-center border-b border-border-light relative">
          <div className={`px-2 pr-5 py-4  flex items-center justify-between`}>
            <Ally />
          </div>
          <button
            onClick={handleToggleSidebar}
            className={`hidden md:block ${
              showExpanded
                ? "px-5 mx-2"
                : "absolute z-10 top-0 bg-white mx-2 px-[20px] py-[15px] opacity-0 hover:opacity-100"
            } hover:bg-background-secondary hover:rounded-md my-2 ${
              isHoverExpandEnabled && isPinned ? "text-primary-600" : ""
            }`}
            title={
              isHoverExpandEnabled
                ? isPinned
                  ? "Unpin sidebar"
                  : "Pin sidebar"
                : showExpanded
                  ? "Collapse sidebar"
                  : "Expand sidebar"
            }
          >
            <DockToRight />
          </button>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label={en.common.closeMenu}
            data-testid="admin-sidebar-close"
            className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          >
            <Close size={20} aria-hidden="true" />
          </button>
        </div>

        {sidebarItems}
        {quickActions}
        {profileSection}
      </div>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
          data-testid="admin-sidebar-overlay"
        />
      )}
    </>
  );
};
