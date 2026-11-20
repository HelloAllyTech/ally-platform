import { FC, useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  LandingCardKey,
  LandingLanguage,
  LandingPageConfig,
  LandingPageView,
  LandingTemplate,
} from "@ally-ui-mono/ui-shared";

import { EditorToolbar, EditorView } from "./EditorToolbar";
import { errorMessage, publishProblems } from "./landingPageErrors";
import { LandingPageFormDialog } from "./LandingPageFormDialog";
import { useLandingImageUpload } from "./useLandingImageUpload";
import {
  useGetLandingPagePreviewQuery,
  useGetLandingPageQuery,
  usePublishLandingPageMutation,
  useUnpublishLandingPageMutation,
  useUpdateLandingPageMutation,
} from "../../api/landingPages";
import { buildPublicLink } from "../../components/organization-access-details/text-helpline/helpers";

import "./landing-editor.css";

const sameConfig = (a: LandingPageConfig | null, b: LandingPageConfig | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Edits a landing page by editing the page. One toolbar on top; everything
 * below it is the page as visitors will see it, with every text click-to-edit
 * and every image replaceable. "Latest version" is the draft you are editing;
 * "Live" is the published copy, read-only.
 */
export const LandingPageEditor: FC = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const { data: page, isLoading, isError } = useGetLandingPageQuery(id, { skip: !id });
  const { data: preview } = useGetLandingPagePreviewQuery(id, { skip: !id });
  const [updatePage, { isLoading: saving }] = useUpdateLandingPageMutation();
  const [publishPage, { isLoading: publishing }] = usePublishLandingPageMutation();
  const [unpublishPage] = useUnpublishLandingPageMutation();
  const upload = useLandingImageUpload(page?.tenantId);

  const [draft, setDraft] = useState<LandingPageConfig | null>(null);
  const [baseline, setBaseline] = useState<LandingPageConfig | null>(null);
  const [view, setView] = useState<EditorView>("latest");
  const [language, setLanguage] = useState<LandingLanguage>("en");
  const [section, setSection] = useState<LandingCardKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  // Take the page's draft once it arrives.
  useEffect(() => {
    if (page && draft === null) {
      setDraft(page.config);
      setBaseline(page.config);
      setLanguage(page.config.languages.default);
    }
  }, [page, draft]);

  // Keep the language being written one the page still offers.
  useEffect(() => {
    if (draft && !draft.languages.enabled.includes(language)) {
      setLanguage(draft.languages.default);
    }
  }, [draft, language]);

  const dirty = !sameConfig(draft, baseline);

  // A reload or a closed tab would lose what has not been saved.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    try {
      const saved = await updatePage({ id, data: { config: draft } }).unwrap();
      setDraft(saved.config);
      setBaseline(saved.config);
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't save the page"));
      return false;
    }
  }, [draft, id, updatePage]);

  const onSave = async () => {
    if (await save()) toast.success("Saved");
  };

  const onPublish = async () => {
    setProblems([]);
    if (dirty && !(await save())) return;
    try {
      await publishPage(id).unwrap();
      toast.success("Published");
    } catch (error) {
      const list = publishProblems(error);
      if (list.length > 0) setProblems(list);
      else toast.error(errorMessage(error, "Couldn't publish the page"));
    }
  };

  const onUnpublish = async () => {
    if (
      !window.confirm("Take this page down? Visitors will no longer see it. Your draft is kept.")
    ) {
      return;
    }
    try {
      await unpublishPage(id).unwrap();
      setView("latest");
      toast.success("Taken down. The draft is kept.");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't take the page down"));
    }
  };

  const onBack = () => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    navigate("/landing-pages");
  };

  const branding = useMemo(
    () => preview?.branding ?? { displayName: page?.tenantName ?? "", logoUrl: null },
    [preview, page?.tenantName],
  );

  if (isLoading || (page && !draft)) {
    return (
      <div className="lp-editor-empty" role="status" aria-busy="true">
        Loading…
      </div>
    );
  }
  if (isError || !page || !draft) {
    return (
      <div className="lp-editor-empty">
        <p>This landing page couldn&apos;t be found. It may have been deleted.</p>
        <button type="button" className="underline" onClick={() => navigate("/landing-pages")}>
          Back to landing pages
        </button>
      </div>
    );
  }

  const editing = view === "latest";
  const shown = editing ? draft : page.publishedConfig;

  return (
    <div className="lp-editor">
      <EditorToolbar
        name={page.name}
        path={page.path}
        published={page.status === "PUBLISHED"}
        hasUnpublishedChanges={page.hasUnpublishedChanges}
        dirty={dirty}
        saving={saving}
        publishing={publishing}
        view={view}
        template={draft.template}
        language={language}
        languages={draft.languages.enabled}
        onBack={onBack}
        onViewChange={next => {
          setView(next);
          setSection(null);
        }}
        onTemplateChange={(template: LandingTemplate) => setDraft({ ...draft, template })}
        onSettings={() => {
          setSettingsError(null);
          setSettingsOpen(true);
        }}
        onSave={onSave}
        onPublish={onPublish}
        onUnpublish={onUnpublish}
        onOpenLive={() => window.open(buildPublicLink(page.path), "_blank", "noopener,noreferrer")}
      />

      {problems.length > 0 && (
        <div className="lp-editor-banner" role="alert">
          <strong>This page isn&apos;t ready to publish yet.</strong>
          <ul>
            {problems.map(problem => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="lp-editor-page">
        {shown ? (
          <LandingPageView
            config={shown}
            branding={branding}
            language={
              shown.languages.enabled.includes(language) ? language : shown.languages.default
            }
            onLanguageChange={setLanguage}
            section={section}
            onSectionChange={setSection}
            editable={editing}
            onConfigChange={setDraft}
            onUploadImage={upload}
          />
        ) : (
          <div className="lp-editor-empty">
            <p>This page isn&apos;t published yet, so there is no live version to show.</p>
            <button type="button" className="underline" onClick={() => setView("latest")}>
              Back to the latest version
            </button>
          </div>
        )}
      </div>

      <LandingPageFormDialog
        open={settingsOpen}
        mode="settings"
        tenantLabel={page.tenantName}
        tenantCode={page.tenantCode}
        serverError={settingsError}
        submitting={saving}
        initial={{
          tenantId: page.tenantId,
          name: page.name,
          slug: page.slug,
          languages: draft.languages.enabled,
          defaultLanguage: draft.languages.default,
          signUpEnabled: draft.signUp.enabled,
        }}
        onClose={() => setSettingsOpen(false)}
        onSubmit={async values => {
          const nextConfig: LandingPageConfig = {
            ...draft,
            languages: { enabled: values.languages, default: values.defaultLanguage },
            signUp: { enabled: values.signUpEnabled },
          };
          try {
            const saved = await updatePage({
              id,
              data: { name: values.name, slug: values.slug, config: nextConfig },
            }).unwrap();
            setDraft(saved.config);
            setBaseline(saved.config);
            setSettingsOpen(false);
            toast.success("Settings saved");
          } catch (error) {
            setSettingsError(errorMessage(error, "Couldn't save the settings"));
          }
        }}
      />
    </div>
  );
};
