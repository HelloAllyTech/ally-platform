import React, { useEffect, useMemo, useState } from "react";

import QRCode from "qrcode";
import { toast } from "sonner";

import {
  CarbonToggle,
  NumberInput,
  RadioButton,
  RadioButtonGroup,
  Select,
  SelectItem,
  SkeletonText,
  TextArea,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import {
  useAddBotPageAccessMutation,
  useCreateBotPageLogoUrlMutation,
  useGetBotPageAccessQuery,
  useGetBotPageQuery,
  useLazyCheckBotPageSlugQuery,
  useRemoveBotPageAccessMutation,
  useUpdateBotPageMutation,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import {
  BotPageAccess,
  BotPageAccessKind,
  BotPageSettings,
  BotPageStatus,
  BotPageView,
  Chatbot,
  PrechatField,
} from "@types";
import { brandContrastVerdict, isHexColour, normaliseHex } from "@utils/brandColour";

import { Card, copyToClipboard, errorMessage, fill, LoadError } from "./shared";
import { useReportUnsaved } from "./unsavedChanges";
import { BotPagePreview } from "../../botPage/BotPagePreview";

import type { PrechatFieldType, PublicBotPage } from "../../botPage/types";

const t = en.whatsappBot.bots.botPage;

const MAX_PRECHAT = 8;
const MAX_SUGGESTED = 4;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const PRECHAT_TYPES: PrechatFieldType[] = ["text", "email", "phone", "choice", "date", "consent"];

interface Draft {
  status: BotPageStatus;
  slug: string;
  access: BotPageAccess;
  settings: BotPageSettings;
}

const draftOf = (view: BotPageView): Draft => ({
  status: view.status,
  slug: view.slug,
  access: view.access,
  settings: view.settings,
});

/**
 * The Bot page tab (Agents v2, chunk 12b): a shareable chat link for this bot. On/off and the link
 * with a QR code; branding with a live phone preview drawn from the page's own screens; who may
 * open it (its own list, never the bot's WhatsApp list); the questions asked before the chat;
 * suggested questions; and limits. Viewers see it; editors change it.
 */
export const BotPageTab: React.FC<{ bot: Chatbot; canEdit: boolean }> = ({ bot, canEdit }) => {
  const { data, isLoading, isError, refetch } = useGetBotPageQuery(bot.id);
  if (isLoading) return <SkeletonText paragraph lineCount={8} />;
  if (isError || !data) return <LoadError title={t.loadFailed} onRetry={() => void refetch()} />;
  // Keyed by what was saved, so the form starts again from the server's copy after every save.
  return (
    <BotPageEditor key={JSON.stringify(draftOf(data))} bot={bot} view={data} canEdit={canEdit} />
  );
};

const BotPageEditor: React.FC<{ bot: Chatbot; view: BotPageView; canEdit: boolean }> = ({
  bot,
  view,
  canEdit,
}) => {
  const initial = useMemo(() => draftOf(view), [view]);
  const [draft, setDraft] = useState<Draft>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useReportUnsaved("botPage", dirty);
  const [save, { isLoading: isSaving }] = useUpdateBotPageMutation();
  const [checkSlug, slugCheck] = useLazyCheckBotPageSlugQuery();
  const [previewScreen, setPreviewScreen] = useState<"cover" | "chat">("cover");

  const settings = draft.settings;
  const setSettings = (patch: Partial<BotPageSettings>) =>
    setDraft(d => ({ ...d, settings: { ...d.settings, ...patch } }));
  const setBranding = (patch: Partial<BotPageSettings["branding"]>) =>
    setSettings({ branding: { ...settings.branding, ...patch } });

  const link = view.link.replace(/\/b\/[^/]*$/, `/b/${draft.slug}`);
  const colour = settings.branding.accentColour;
  const contrast = isHexColour(colour) ? brandContrastVerdict(normaliseHex(colour)) : null;

  const previewPage: PublicBotPage = {
    slug: draft.slug,
    access: draft.access,
    branding: { ...settings.branding, accentColour: isHexColour(colour) ? colour : "#264D8E" },
    suggestedQuestions: settings.suggestedQuestions.filter(q => q.trim()),
    prechat: settings.prechat,
    maxMessageChars: settings.limits.maxMessageChars,
    language: settings.language,
    turnstileSiteKey: null,
  };

  const handleSave = async () => {
    try {
      await save({
        id: bot.id,
        ...draft,
        settings: {
          ...settings,
          suggestedQuestions: settings.suggestedQuestions.map(q => q.trim()).filter(Boolean),
          branding: {
            ...settings.branding,
            logoUrl: settings.branding.logoUrl?.trim() || null,
            avatarUrl: settings.branding.avatarUrl?.trim() || null,
            footerLink:
              settings.branding.footerLink?.url.trim() && settings.branding.footerLink.label.trim()
                ? settings.branding.footerLink
                : null,
          },
        },
      }).unwrap();
      toast.success(t.saved);
    } catch (err) {
      toast.error(errorMessage(err, t.saveFailed));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-typography-600 max-w-3xl">{t.intro}</p>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          {/* ── link ─────────────────────────────────────────────────── */}
          <Card title={t.linkTitle}>
            <div className="flex flex-col gap-1">
              <CarbonToggle
                id="bot-page-on"
                labelText={t.onLabel}
                size="sm"
                toggled={draft.status === "on"}
                disabled={!canEdit}
                onToggle={(on: boolean) => setDraft(d => ({ ...d, status: on ? "on" : "off" }))}
              />
              <span className="text-xs text-typography-500">{t.onHelp}</span>
            </div>
            <p
              className={`text-sm ${view.live.ok ? "text-success-700" : "text-warning-700"}`}
              role="status"
            >
              {view.live.ok ? t.liveNow : t.notLive[view.live.reason ?? "page_off"]}
            </p>
            {view.dailyCapReached && <p className="text-sm text-warning-700">{t.capReached}</p>}
            <TextInput
              id="bot-page-slug"
              labelText={t.slugLabel}
              helperText={
                slugCheck.isFetching
                  ? t.slugChecking
                  : slugCheck.data && slugCheck.data.slug === draft.slug.toLowerCase()
                    ? slugCheck.data.available
                      ? t.slugFree
                      : (slugCheck.data.reason ?? t.slugTaken)
                    : t.slugHelp
              }
              invalid={Boolean(
                slugCheck.data &&
                !slugCheck.data.available &&
                slugCheck.data.slug === draft.slug.toLowerCase(),
              )}
              value={draft.slug}
              disabled={!canEdit}
              onChange={e => setDraft(d => ({ ...d, slug: e.target.value.toLowerCase() }))}
              onBlur={() => draft.slug && void checkSlug({ id: bot.id, slug: draft.slug })}
            />
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <QrCode link={link} />
              <div className="flex flex-col gap-2 min-w-0">
                <code className="text-sm text-typography-800 break-all">{link}</code>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={ButtonVariant.SECONDARY}
                    onClick={() =>
                      void copyToClipboard(link).then(() => toast.success(t.linkCopied))
                    }
                  >
                    {t.copyLink}
                  </Button>
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline self-center text-typography-800"
                  >
                    {t.openPage}
                  </a>
                </div>
              </div>
            </div>
          </Card>

          {/* ── branding ─────────────────────────────────────────────── */}
          <Card title={t.brandingTitle}>
            <LogoField
              botId={bot.id}
              value={settings.branding.logoUrl}
              canEdit={canEdit}
              onChange={logoUrl => setBranding({ logoUrl })}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="bot-page-colour" className="text-sm text-typography-700">
                {t.colourLabel}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="bot-page-colour"
                  type="color"
                  value={isHexColour(colour) ? colour : "#264D8E"}
                  disabled={!canEdit}
                  onChange={e => setBranding({ accentColour: normaliseHex(e.target.value) })}
                  className="h-10 w-14 cursor-pointer rounded border border-border-light"
                />
                <TextInput
                  id="bot-page-colour-hex"
                  labelText=""
                  hideLabel
                  value={colour}
                  disabled={!canEdit}
                  onChange={e => setBranding({ accentColour: e.target.value })}
                />
              </div>
              {contrast && contrast.verdict !== "pass" && (
                <span className="text-xs text-warning-700">
                  {fill(t.colourContrast, { ratio: contrast.ratio })}
                </span>
              )}
            </div>
            <TextInput
              id="bot-page-title"
              labelText={t.titleLabel}
              value={settings.branding.title}
              maxLength={80}
              disabled={!canEdit}
              onChange={e => setBranding({ title: e.target.value })}
            />
            <TextInput
              id="bot-page-subtitle"
              labelText={t.subtitleLabel}
              value={settings.branding.subtitle}
              maxLength={200}
              disabled={!canEdit}
              onChange={e => setBranding({ subtitle: e.target.value })}
            />
            <TextInput
              id="bot-page-assistant"
              labelText={t.assistantNameLabel}
              value={settings.branding.assistantName}
              maxLength={60}
              disabled={!canEdit}
              onChange={e => setBranding({ assistantName: e.target.value })}
            />
            <TextInput
              id="bot-page-avatar"
              labelText={t.avatarLabel}
              value={settings.branding.avatarUrl ?? ""}
              disabled={!canEdit}
              onChange={e => setBranding({ avatarUrl: e.target.value })}
            />
            <TextInput
              id="bot-page-disclaimer"
              labelText={t.disclaimerLabel}
              helperText={t.disclaimerHelp}
              value={settings.branding.disclaimer}
              maxLength={300}
              disabled={!canEdit}
              onChange={e => setBranding({ disclaimer: e.target.value })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <TextInput
                id="bot-page-footer-label"
                labelText={t.footerLabelLabel}
                value={settings.branding.footerLink?.label ?? ""}
                maxLength={60}
                disabled={!canEdit}
                onChange={e =>
                  setBranding({
                    footerLink: {
                      label: e.target.value,
                      url: settings.branding.footerLink?.url ?? "",
                    },
                  })
                }
              />
              <TextInput
                id="bot-page-footer-url"
                labelText={t.footerUrlLabel}
                value={settings.branding.footerLink?.url ?? ""}
                disabled={!canEdit}
                onChange={e =>
                  setBranding({
                    footerLink: {
                      label: settings.branding.footerLink?.label ?? "",
                      url: e.target.value,
                    },
                  })
                }
              />
            </div>
            <Select
              id="bot-page-language"
              labelText={t.languageLabel}
              value={settings.language}
              disabled={!canEdit}
              onChange={e =>
                setSettings({ language: e.target.value as BotPageSettings["language"] })
              }
            >
              <SelectItem value="auto" text={t.languageAuto} />
              <SelectItem value="en" text={t.languageEn} />
              <SelectItem value="hi" text={t.languageHi} />
            </Select>
          </Card>

          {/* ── access ───────────────────────────────────────────────── */}
          <Card title={t.accessTitle} subtitle={t.accessNote}>
            <RadioButtonGroup
              name="bot-page-access"
              orientation="vertical"
              valueSelected={draft.access}
              disabled={!canEdit}
              onChange={value => setDraft(d => ({ ...d, access: value as BotPageAccess }))}
            >
              <RadioButton
                id="bot-page-access-public"
                value="public"
                labelText={view.publicAllowed ? t.accessPublic : t.accessPublicBlocked}
                disabled={!view.publicAllowed}
              />
              <RadioButton
                id="bot-page-access-organisation"
                value="organisation"
                labelText={t.accessOrganisation}
              />
              <RadioButton id="bot-page-access-invite" value="invite" labelText={t.accessInvite} />
            </RadioButtonGroup>
            {draft.access !== "public" &&
              (view.saved ? (
                <AccessList botId={bot.id} canEdit={canEdit} mode={draft.access} />
              ) : (
                <p className="text-sm text-typography-600">{t.accessSaveFirst}</p>
              ))}
          </Card>

          {/* ── pre-chat questions ───────────────────────────────────── */}
          <Card title={t.prechatTitle} subtitle={t.prechatIntro}>
            <PrechatEditor
              fields={settings.prechat}
              canEdit={canEdit}
              onChange={prechat => setSettings({ prechat })}
            />
          </Card>

          {/* ── suggested questions ──────────────────────────────────── */}
          <Card title={t.suggestedTitle} subtitle={t.suggestedIntro}>
            {settings.suggestedQuestions.map((q, i) => (
              <div key={i} className="flex gap-2 items-end">
                <div className="flex-1">
                  <TextInput
                    id={`bot-page-suggested-${i}`}
                    labelText={`${i + 1}`}
                    value={q}
                    maxLength={120}
                    disabled={!canEdit}
                    onChange={e =>
                      setSettings({
                        suggestedQuestions: settings.suggestedQuestions.map((s, j) =>
                          j === i ? e.target.value : s,
                        ),
                      })
                    }
                  />
                </div>
                {canEdit && (
                  <Button
                    variant={ButtonVariant.SECONDARY}
                    onClick={() =>
                      setSettings({
                        suggestedQuestions: settings.suggestedQuestions.filter((_, j) => j !== i),
                      })
                    }
                  >
                    {t.remove}
                  </Button>
                )}
              </div>
            ))}
            {canEdit && settings.suggestedQuestions.length < MAX_SUGGESTED && (
              <div>
                <Button
                  variant={ButtonVariant.SECONDARY}
                  onClick={() =>
                    setSettings({ suggestedQuestions: [...settings.suggestedQuestions, ""] })
                  }
                >
                  {t.addSuggestion}
                </Button>
              </div>
            )}
          </Card>

          {/* ── limits ───────────────────────────────────────────────── */}
          <Card title={t.limitsTitle}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <LimitField
                id="per-visitor"
                label={t.perVisitorLabel}
                value={settings.limits.messagesPerVisitorPerHour}
                min={1}
                max={200}
                canEdit={canEdit}
                onChange={v =>
                  setSettings({ limits: { ...settings.limits, messagesPerVisitorPerHour: v } })
                }
              />
              <LimitField
                id="max-chars"
                label={t.maxCharsLabel}
                value={settings.limits.maxMessageChars}
                min={50}
                max={2000}
                canEdit={canEdit}
                onChange={v => setSettings({ limits: { ...settings.limits, maxMessageChars: v } })}
              />
              <LimitField
                id="daily-cap"
                label={t.dailyCapLabel}
                value={settings.limits.dailyCapPerBot}
                min={1}
                max={20000}
                canEdit={canEdit}
                onChange={v => setSettings({ limits: { ...settings.limits, dailyCapPerBot: v } })}
              />
            </div>
          </Card>

          {canEdit && (
            <div className="sticky bottom-0 bg-white py-3 border-t border-border-light">
              <Button
                variant={ButtonVariant.PRIMARY}
                disabled={!dirty || isSaving || contrast?.verdict === "fail"}
                onClick={() => void handleSave()}
              >
                {isSaving ? t.saving : t.save}
              </Button>
            </div>
          )}
        </div>

        {/* ── live preview ───────────────────────────────────────────── */}
        <div className="xl:sticky xl:top-4 flex flex-col gap-2 items-center">
          <div className="flex gap-3 text-sm" role="tablist" aria-label={t.previewTitle}>
            {(["cover", "chat"] as const).map(screen => (
              <button
                key={screen}
                type="button"
                role="tab"
                aria-selected={previewScreen === screen}
                onClick={() => setPreviewScreen(screen)}
                className={`underline-offset-4 ${previewScreen === screen ? "underline font-semibold text-typography-900" : "text-typography-600"}`}
              >
                {screen === "cover" ? t.previewCover : t.previewChat}
              </button>
            ))}
          </div>
          <div
            data-testid="bot-page-preview"
            className="w-[300px] h-[600px] rounded-[2rem] border-[10px] border-typography-900 overflow-hidden bg-white shadow-lg"
          >
            <BotPagePreview
              page={previewPage}
              screen={previewScreen}
              sampleReply={t.previewSample}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/** The link as a QR code, with a PNG download. */
const QrCode: React.FC<{ link: string }> = ({ link }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    QRCode.toDataURL(link, { margin: 1, width: 256 })
      .then(url => current && setSrc(url))
      .catch(() => current && setSrc(null));
    return () => {
      current = false;
    };
  }, [link]);
  if (!src) return <div className="h-32 w-32 rounded bg-gray-100" />;
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <img src={src} alt={fill(t.qrAlt, { link })} className="h-32 w-32" />
      <a href={src} download="bot-page-qr.png" className="text-xs underline text-typography-700">
        {t.downloadQr}
      </a>
    </div>
  );
};

const LogoField: React.FC<{
  botId: string;
  value: string | null;
  canEdit: boolean;
  onChange: (url: string | null) => void;
}> = ({ botId, value, canEdit, onChange }) => {
  const [createUrl] = useCreateBotPageLogoUrlMutation();
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) {
      toast.error(t.logoTooBig);
      return;
    }
    setUploading(true);
    try {
      const { presignedUrl, imageUrl } = await createUrl({
        id: botId,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      }).unwrap();
      const put = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(String(put.status));
      onChange(imageUrl);
    } catch (err) {
      toast.error(errorMessage(err, t.logoFailed));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-typography-700">{t.logoLabel}</span>
      <div className="flex items-center gap-3">
        {value && (
          <img
            src={value}
            alt=""
            className="h-12 w-auto max-w-[160px] object-contain border border-border-light rounded"
          />
        )}
        {canEdit && (
          <label className="text-sm underline cursor-pointer text-typography-800">
            {uploading ? t.logoUploading : t.logoUpload}
            <input
              type="file"
              accept={LOGO_TYPES.join(",")}
              className="sr-only"
              disabled={uploading}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {canEdit && value && (
          <button
            type="button"
            className="text-sm underline text-typography-700"
            onClick={() => onChange(null)}
          >
            {t.logoRemove}
          </button>
        )}
      </div>
      <TextInput
        id="bot-page-logo-url"
        labelText={t.logoUrlLabel}
        value={value ?? ""}
        disabled={!canEdit}
        onChange={e => onChange(e.target.value || null)}
      />
    </div>
  );
};

const LimitField: React.FC<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  canEdit: boolean;
  onChange: (value: number) => void;
}> = ({ id, label, value, min, max, canEdit, onChange }) => (
  <NumberInput
    id={`bot-page-${id}`}
    label={label}
    value={value}
    min={min}
    max={max}
    hideSteppers
    disabled={!canEdit}
    onChange={(_event: unknown, state: { value: number | string } | undefined) => {
      const next = Number(state?.value);
      if (!Number.isNaN(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
    }}
  />
);

const newFieldId = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const PrechatEditor: React.FC<{
  fields: PrechatField[];
  canEdit: boolean;
  onChange: (fields: PrechatField[]) => void;
}> = ({ fields, canEdit, onChange }) => {
  const update = (index: number, patch: Partial<PrechatField>) =>
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const move = (index: number, by: number) => {
    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {fields.map((field, index) => (
          <li
            key={field.id}
            className="flex flex-col gap-2 border border-border-light rounded p-3"
            aria-label={`${t.questionLabel} ${index + 1}`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_12rem] gap-2">
              <TextInput
                id={`prechat-${field.id}-label`}
                labelText={`${t.questionLabel} ${index + 1}`}
                value={field.label}
                maxLength={200}
                disabled={!canEdit}
                onChange={e => update(index, { label: e.target.value })}
              />
              <Select
                id={`prechat-${field.id}-type`}
                labelText={t.questionType}
                value={field.type}
                disabled={!canEdit}
                onChange={e => {
                  const type = e.target.value as PrechatFieldType;
                  update(index, {
                    type,
                    options: type === "choice" ? (field.options ?? []) : undefined,
                    consentText: type === "consent" ? (field.consentText ?? "") : undefined,
                    required: type === "consent" ? true : field.required,
                  });
                }}
              >
                {PRECHAT_TYPES.map(type => (
                  <SelectItem key={type} value={type} text={t.types[type]} />
                ))}
              </Select>
            </div>
            {field.type === "choice" && (
              <TextArea
                id={`prechat-${field.id}-options`}
                labelText={t.optionsLabel}
                rows={3}
                value={(field.options ?? []).join("\n")}
                disabled={!canEdit}
                onChange={e => update(index, { options: e.target.value.split("\n") })}
              />
            )}
            {field.type === "consent" && (
              <TextArea
                id={`prechat-${field.id}-consent`}
                labelText={t.consentTextLabel}
                rows={3}
                value={field.consentText ?? ""}
                disabled={!canEdit}
                onChange={e => update(index, { consentText: e.target.value })}
              />
            )}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-typography-800">
                <input
                  type="checkbox"
                  checked={field.required || field.type === "consent"}
                  disabled={!canEdit || field.type === "consent"}
                  onChange={e => update(index, { required: e.target.checked })}
                />
                {t.requiredLabel}
              </label>
              {canEdit && (
                <>
                  <button
                    type="button"
                    className="text-sm underline disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    {t.moveUp}
                  </button>
                  <button
                    type="button"
                    className="text-sm underline disabled:opacity-40"
                    disabled={index === fields.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    {t.moveDown}
                  </button>
                  <button
                    type="button"
                    className="text-sm underline text-error-700"
                    onClick={() => onChange(fields.filter((_, i) => i !== index))}
                  >
                    {t.deleteQuestion}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {canEdit && fields.length < MAX_PRECHAT && (
        <div>
          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={() =>
              onChange([...fields, { id: newFieldId(), label: "", type: "text", required: true }])
            }
          >
            {t.addQuestion}
          </Button>
        </div>
      )}
    </div>
  );
};

/** The page's own list: invited emails, or organisations whose active users may sign in. */
const AccessList: React.FC<{ botId: string; canEdit: boolean; mode: BotPageAccess }> = ({
  botId,
  canEdit,
  mode,
}) => {
  const { data, isLoading, isError, refetch } = useGetBotPageAccessQuery(botId);
  const [add, { isLoading: isAdding }] = useAddBotPageAccessMutation();
  const [remove] = useRemoveBotPageAccessMutation();
  const kind: BotPageAccessKind = mode === "organisation" ? "organisation" : "email";
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [bulk, setBulk] = useState("");

  const entries = (data?.entries ?? []).filter(e => e.kind === kind);

  const addEntries = async (list: { kind: BotPageAccessKind; value: string; label?: string }[]) => {
    if (!list.length) return;
    try {
      const result = await add({ id: botId, entries: list }).unwrap();
      toast.success(fill(t.added, { added: result.added, skipped: result.skipped }));
      setValue("");
      setLabel("");
      setBulk("");
    } catch (err) {
      toast.error(errorMessage(err, t.addFailed));
    }
  };

  if (isLoading) return <SkeletonText paragraph lineCount={3} />;
  if (isError) return <LoadError title={t.loadFailed} onRetry={() => void refetch()} />;
  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <p className="text-sm text-warning-700">{t.accessEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-light">
          {entries.map(entry => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <span className="flex-1 min-w-0 text-sm text-typography-900 truncate">
                {[entry.label ?? entry.organisationName, entry.value].filter(Boolean).join(" · ")}
              </span>
              {canEdit && (
                <Button
                  variant={ButtonVariant.SECONDARY}
                  onClick={() =>
                    void remove({ id: botId, entryId: entry.id })
                      .unwrap()
                      .then(() => toast.success(t.removed))
                      .catch(err => toast.error(errorMessage(err, t.addFailed)))
                  }
                >
                  {t.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <TextInput
              id="bot-page-access-value"
              labelText={kind === "email" ? t.kindEmail : t.kindOrganisation}
              placeholder={t.valuePlaceholder}
              value={value}
              onChange={e => setValue(e.target.value)}
            />
            <TextInput
              id="bot-page-access-label"
              labelText=""
              hideLabel
              placeholder={t.labelPlaceholder}
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
            <Button
              variant={ButtonVariant.SECONDARY}
              disabled={!value.trim() || isAdding}
              onClick={() =>
                void addEntries([{ kind, value: value.trim(), label: label.trim() || undefined }])
              }
            >
              {t.addEntry}
            </Button>
          </div>
          {kind === "email" && (
            <div className="flex flex-col gap-2">
              <TextArea
                id="bot-page-access-bulk"
                labelText={t.bulkLabel}
                rows={3}
                value={bulk}
                onChange={e => setBulk(e.target.value)}
              />
              <div>
                <Button
                  variant={ButtonVariant.SECONDARY}
                  disabled={!bulk.trim() || isAdding}
                  onClick={() =>
                    void addEntries(
                      bulk
                        .split(/[\r\n,;]+/)
                        .map(line => line.trim())
                        .filter(Boolean)
                        .map(email => ({ kind: "email" as const, value: email })),
                    )
                  }
                >
                  {t.bulkAdd}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
