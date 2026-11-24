import React, { Suspense, useMemo } from "react";

import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ContentSwitcher, Switch, SkeletonText, Tabs } from "@ally-ui-mono/ui-shared";
import { useGetFeatureTogglesQuery, useGetPermissionsQuery } from "@api";
import { ROUTES } from "@constants";

import { ASSISTANTS_ADMIN_COPY as COPY } from "./copy";
import {
  accessFrom,
  assistantsAdminPath,
  buildSections,
  type AdminSection,
  type SectionId,
} from "./sections";

import "./assistantsAdmin.css";

const BASE = ROUTES.ASSISTANTS_ADMIN;

/**
 * Ally staff's one home for running the Assistants product. Seven sections, each a job:
 * Overview (what needs you), Builders & credits, Pricing & costs, Safety, Defaults & library,
 * Support, and Launch & data. A section may have views (a second, smaller switcher); the section
 * is in the path and the view in `?view=`, so every place has a link that survives a reload.
 *
 * A section shows only when the staff member holds its grant (costs toggle, safety-pack curator
 * grant, or system access); ally-be checks the same grants on every call.
 */
export const AssistantsAdmin: React.FC = () => {
  const { section: sectionParam } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: permissions, isLoading: loadingPermissions } = useGetPermissionsQuery();
  const { data: features, isLoading: loadingFeatures } = useGetFeatureTogglesQuery();

  const sections = useMemo(() => {
    const access = accessFrom(
      permissions as string[] | undefined,
      features as string[] | undefined,
    );
    return buildSections().filter(s => s.allowed(access));
  }, [permissions, features]);

  if (loadingPermissions || loadingFeatures) {
    return (
      <div className="aa" data-testid="assistants-admin-loading">
        <SkeletonText paragraph lineCount={4} />
      </div>
    );
  }

  // Overview is open to everyone who can reach the tab; with no other section it is just a notice.
  const reachable = sections.filter(s => s.id !== "overview");
  if (!reachable.length) {
    return (
      <div className="aa" data-testid="assistants-admin-no-access">
        <h1 className="aa__title">{COPY.noAccessTitle}</h1>
        <p className="aa__lede">{COPY.noAccessBody}</p>
      </div>
    );
  }

  const section = sections.find(s => s.id === sectionParam);
  if (!section) return <Navigate to={`${BASE}/overview`} replace />;

  const view = section.views.find(v => v.id === params.get("view")) ?? section.views[0];
  const Panel = view.Panel;
  const goToSection = (id: string) => navigate(`${BASE}/${id}`);
  const goToView = (id: string) =>
    setParams(id === section.views[0].id ? {} : { view: id }, { replace: true });

  return (
    <div className="aa" data-testid="assistants-admin">
      <header className="aa__head">
        <h1 className="aa__title">{COPY.title}</h1>
        <p className="aa__lede">{COPY.subtitle}</p>
      </header>

      <Tabs
        items={sections.map(s => ({ id: s.id, label: s.label }))}
        activeId={section.id}
        onChange={goToSection}
        showCount={false}
      />

      <div className="aa__body">
        {section.id !== "overview" && <SectionHeader section={section} sections={sections} />}

        {section.views.length > 1 && (
          <div className="aa__views">
            <ContentSwitcher
              size="md"
              aria-label={COPY.viewsLabel}
              selectedIndex={section.views.indexOf(view)}
              onChange={(e: { name?: string | number }) => goToView(String(e.name))}
            >
              {section.views.map(v => (
                <Switch key={v.id} name={v.id} text={v.label} data-testid={`aa-view-${v.id}`} />
              ))}
            </ContentSwitcher>
            {view.hint && <p className="aa__hint">{view.hint}</p>}
          </div>
        )}

        <Suspense fallback={<SkeletonText paragraph lineCount={6} />}>
          <div className="aa__panel" data-testid={`aa-panel-${section.id}-${view.id}`}>
            <Panel />
          </div>
        </Suspense>
      </div>
    </div>
  );
};

const SectionHeader: React.FC<{ section: AdminSection; sections: AdminSection[] }> = ({
  section,
  sections,
}) => {
  const target = section.note && sections.find(s => s.id === section.note?.to.section);
  return (
    <div className="aa__section-head">
      <h2 className="aa__section-title">{section.label}</h2>
      <p className="aa__purpose">{section.purpose}</p>
      {section.tasks && section.tasks.length > 0 && (
        <ul className="aa__tasks" aria-label="Jobs in this section">
          {section.tasks.map(t => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {section.note && target && (
        <p className="aa__note">
          {section.note.text}{" "}
          <Link
            to={assistantsAdminPath(
              BASE,
              section.note.to.section as SectionId,
              section.note.to.view,
            )}
          >
            {section.note.linkLabel}
          </Link>
          .
        </p>
      )}
    </div>
  );
};

export default AssistantsAdmin;
