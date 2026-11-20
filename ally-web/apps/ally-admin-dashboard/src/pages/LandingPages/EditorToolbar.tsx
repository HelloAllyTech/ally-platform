import { FC } from "react";

import { Button, Select, SelectItem, Tag } from "@ally-ui-mono/ui-shared";
import {
  LANDING_LANGUAGE_NAMES_EN,
  LANDING_TEMPLATES,
  LandingLanguage,
  LandingTemplate,
} from "@ally-ui-mono/ui-shared";

export type EditorView = "latest" | "live";

export const TEMPLATE_LABELS: Record<LandingTemplate, string> = {
  standard: "Standard",
  split: "Split",
  focus: "Focus",
};

export const TEMPLATE_HINTS: Record<LandingTemplate, string> = {
  standard: "Centered headings, cards in a row",
  split: "Headings beside a hero image, cards as rows",
  focus: "One narrow column, quotes first",
};

interface EditorToolbarProps {
  name: string;
  /** Where the page lives, for example /agatsu/campaign. */
  path: string;
  published: boolean;
  hasUnpublishedChanges: boolean;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  view: EditorView;
  template: LandingTemplate;
  language: LandingLanguage;
  languages: LandingLanguage[];
  onBack: () => void;
  onViewChange: (view: EditorView) => void;
  onTemplateChange: (template: LandingTemplate) => void;
  onSettings: () => void;
  onSave: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onOpenLive: () => void;
}

/**
 * The only chrome around the page in the editor: where you are, which version
 * you are looking at, the design, the language you are writing in, and save
 * and publish. Everything below it is the page itself.
 */
export const EditorToolbar: FC<EditorToolbarProps> = ({
  name,
  path,
  published,
  hasUnpublishedChanges,
  dirty,
  saving,
  publishing,
  view,
  template,
  language,
  languages,
  onBack,
  onViewChange,
  onTemplateChange,
  onSettings,
  onSave,
  onPublish,
  onUnpublish,
  onOpenLive,
}) => {
  const editing = view === "latest";
  const status = !published
    ? { label: "Draft", type: "gray" as const }
    : hasUnpublishedChanges || dirty
      ? { label: "Live, with unpublished changes", type: "warm-gray" as const }
      : { label: "Live", type: "green" as const };

  return (
    <div className="lp-toolbar" role="toolbar" aria-label="Landing page editor">
      <div className="lp-toolbar-group">
        <Button kind="ghost" size="sm" onClick={onBack}>
          ‹ Landing pages
        </Button>
        <span className="lp-toolbar-title">
          <strong>{name}</strong>
          <span className="lp-toolbar-path">{path}</span>
        </span>
        <Tag size="sm" type={status.type}>
          {status.label}
        </Tag>
      </div>

      <div className="lp-toolbar-group">
        <div className="lp-toolbar-views" role="group" aria-label="Version">
          <button
            type="button"
            aria-pressed={editing}
            className={editing ? "is-on" : ""}
            onClick={() => onViewChange("latest")}
          >
            Latest version
          </button>
          <button
            type="button"
            aria-pressed={!editing}
            className={!editing ? "is-on" : ""}
            onClick={() => onViewChange("live")}
          >
            Live
          </button>
        </div>

        <Select
          id="landing-editor-template"
          labelText="Template"
          hideLabel
          size="sm"
          value={template}
          disabled={!editing}
          onChange={event => onTemplateChange(event.target.value as LandingTemplate)}
        >
          {LANDING_TEMPLATES.map(item => (
            <SelectItem
              key={item}
              value={item}
              text={`${TEMPLATE_LABELS[item]}: ${TEMPLATE_HINTS[item]}`}
            />
          ))}
        </Select>

        {languages.length > 1 && (
          <span className="lp-toolbar-state">Writing in {LANDING_LANGUAGE_NAMES_EN[language]}</span>
        )}
      </div>

      <div className="lp-toolbar-group">
        <Button kind="ghost" size="sm" onClick={onSettings}>
          Settings
        </Button>
        {published && (
          <Button kind="ghost" size="sm" onClick={onOpenLive}>
            Open live page
          </Button>
        )}
        {editing && (
          <>
            <span className="lp-toolbar-state" role="status">
              {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <Button kind="secondary" size="sm" onClick={onSave} disabled={saving || !dirty}>
              Save
            </Button>
          </>
        )}
        {published && (
          <Button kind="tertiary" size="sm" onClick={onUnpublish} disabled={publishing}>
            Unpublish
          </Button>
        )}
        <Button
          kind="primary"
          size="sm"
          onClick={onPublish}
          disabled={publishing || saving || (published && !hasUnpublishedChanges && !dirty)}
        >
          {publishing ? "Publishing…" : published ? "Publish changes" : "Publish"}
        </Button>
      </div>
    </div>
  );
};
