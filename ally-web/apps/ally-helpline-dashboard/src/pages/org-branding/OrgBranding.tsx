import { ChangeEvent, FC, useMemo, useRef, useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CustomImage } from "@ally-ui-mono/ui-shared";
import {
  useDeleteOrgLogoMutation,
  useGetLogoUrlQuery,
  useGetOrgFaviconUploadUrlMutation,
  useGetOrgLogoUploadUrlMutation,
  useUpdateOrgBrandingMutation,
} from "@api";
import { Button } from "@components";
import { useCanEditOrgBranding } from "@hooks";
import { UpdateOrgBrandingBody, logoUrlResponse } from "@types";
import {
  ALLY_BRAND_PRIMARY,
  ALLY_PAGE_BACKGROUND,
  brandContrastVerdict,
  buildPreviewRamp,
  isHexColour,
  normaliseHex,
  pickOnPrimary,
} from "@utils";

import { AccessDenied } from "../access-denied/AccessDenied";

/**
 * The org admin's own-organization branding editor (Branding tab).
 *
 * Reachable only while the org's branding switch is on — an Ally platform
 * admin flips that from the admin console, and the backend refuses edits
 * while it is off — so there is no "off" state to explain here: the tab is
 * simply absent. The fields, preview, contrast readout and save model mirror
 * the admin console's Branding tab, written for the organization's own admin.
 *
 * Save model: explicit. Uploads go to S3 as soon as a file is picked, but the
 * resulting URL sits in the form until Save, so Cancel still discards it.
 * After a save the shared tenant query is refetched, and BrandingProvider
 * repaints the app from it, so the admin sees their change land at once.
 */

interface BrandingForm {
  logoUrl: string | null;
  displayName: string;
  primaryColor: string;
  faviconUrl: string | null;
  welcomeLine: string;
}

const DISPLAY_NAME_MAX = 60;
const WELCOME_LINE_MAX = 160;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const FAVICON_MAX_BYTES = 512 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg"];
const FAVICON_TYPES = [
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/jpeg",
];

const formFromTenant = (tenant: logoUrlResponse): BrandingForm => {
  const b = tenant.branding;
  return {
    logoUrl: tenant.logoUrl || null,
    // The response is RESOLVED: displayName falls back to the org name, so a
    // value equal to the name reads as "not set" here.
    displayName: b?.displayName && b.displayName !== tenant.name ? b.displayName : "",
    primaryColor: b?.primaryColor ?? ALLY_BRAND_PRIMARY,
    faviconUrl: b?.faviconUrl ?? null,
    welcomeLine: b?.welcomeLine ?? "",
  };
};

const errorText = (error: unknown, fallback: string): string => {
  const m = (error as { data?: { message?: unknown } })?.data?.message;
  if (Array.isArray(m)) return m.join(" ");
  return typeof m === "string" && m ? m : fallback;
};

const uploadToS3 = async (file: File, presignedUrl: string) => {
  const res = await fetch(presignedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!res.ok) throw new Error("upload failed");
};

const inputClass =
  "h-10 w-full rounded-none border-0 border-b border-border-dark bg-white px-3 py-2 text-base placeholder:text-typography-placeholder focus:outline-none focus-visible:border-b-2 focus-visible:border-primary-500";

const linkButtonClass =
  "text-primary-600 text-sm font-medium hover:text-primary-700 disabled:text-typography-disabled";

const Field: FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div className="flex flex-col gap-2">
    <span className="text-sm text-typography-700">{label}</span>
    {children}
    {hint && <p className="text-xs text-typography-500">{hint}</p>}
  </div>
);

export const OrgBranding = () => {
  const { t } = useTranslation();
  const { canEdit, isLoading: isAccessLoading } = useCanEditOrgBranding();
  const { data: tenant, refetch } = useGetLogoUrlQuery(undefined, { skip: !canEdit });

  if (isAccessLoading) return null;
  if (!canEdit) return <AccessDenied />;
  if (!tenant?.id) return null;

  const initial = formFromTenant(tenant);

  return (
    <div className="p-4 md:p-8 font-primary flex flex-col gap-6" data-testid="org-branding-page">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl text-typography-900">{t("orgBranding.title")}</h1>
        <p className="text-sm text-typography-600">{t("orgBranding.intro")}</p>
      </div>

      {tenant.brandedSignInUrl && <SignInLink url={tenant.brandedSignInUrl} />}

      {/* Keyed on the loaded values: a refetch after Save or Reset remounts the
          editor with fresh state instead of syncing it through an effect. */}
      <BrandingEditor
        key={JSON.stringify(initial)}
        tenantId={tenant.id}
        orgName={tenant.name}
        initial={initial}
        onSaved={() => void refetch()}
      />
    </div>
  );
};

const SignInLink: FC<{ url: string }> = ({ url }) => {
  const { t } = useTranslation();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("orgBranding.linkCopied"));
    } catch {
      // Clipboard blocked: the link is on screen to select by hand.
      toast.error(t("orgBranding.copyFailed"));
    }
  };
  return (
    <div
      className="flex flex-col gap-2 w-full lg:w-2/3 border border-border-light rounded p-4 bg-white"
      data-testid="org-branding-sign-in-link"
    >
      <span className="text-sm text-typography-700">{t("orgBranding.signInLink")}</span>
      <div className="flex flex-row items-center gap-3 min-w-0">
        <code className="text-sm text-typography-800 truncate">{url}</code>
        <button type="button" onClick={copy} className={linkButtonClass}>
          {t("orgBranding.copyLink")}
        </button>
      </div>
      <p className="text-xs text-typography-500">{t("orgBranding.signInLinkHint")}</p>
    </div>
  );
};

interface BrandingEditorProps {
  tenantId: string;
  orgName: string;
  initial: BrandingForm;
  onSaved: () => void;
}

const BrandingEditor: FC<BrandingEditorProps> = ({ tenantId, orgName, initial, onSaved }) => {
  const { t } = useTranslation();
  const [updateBranding] = useUpdateOrgBrandingMutation();
  const [getLogoUploadUrl] = useGetOrgLogoUploadUrlMutation();
  const [deleteLogo] = useDeleteOrgLogoMutation();
  const [getFaviconUploadUrl] = useGetOrgFaviconUploadUrlMutation();

  const [form, setForm] = useState<BrandingForm>(initial);
  const [hexInput, setHexInput] = useState(initial.primaryColor);
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "favicon" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  const hexValid = isHexColour(hexInput);
  const contrast = useMemo(
    () => (hexValid ? brandContrastVerdict(normaliseHex(hexInput)) : null),
    [hexInput, hexValid],
  );
  const canSave = isDirty && hexValid && contrast?.verdict !== "fail" && !isSaving && !uploading;

  const previewColor = hexValid ? normaliseHex(hexInput) : form.primaryColor;
  const ramp = useMemo(() => buildPreviewRamp(previewColor), [previewColor]);
  const onPrimary = useMemo(() => pickOnPrimary(previewColor), [previewColor]);

  const handleHexChange = (raw: string) => {
    const value = raw.startsWith("#") ? raw : `#${raw}`;
    setHexInput(value);
    if (isHexColour(value)) set("primaryColor", normaliseHex(value));
  };

  const handleLogoPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return void toast.error(t("orgBranding.logoWrongType"));
    if (file.size > LOGO_MAX_BYTES) return void toast.error(t("orgBranding.logoTooLarge"));
    setUploading("logo");
    try {
      const res = await getLogoUploadUrl({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      }).unwrap();
      await uploadToS3(file, res.presignedUrl);
      set("logoUrl", res.logoUrl);
    } catch (error) {
      toast.error(errorText(error, t("orgBranding.uploadFailed")));
    } finally {
      setUploading(null);
    }
  };

  const handleFaviconPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!FAVICON_TYPES.includes(file.type))
      return void toast.error(t("orgBranding.faviconWrongType"));
    if (file.size > FAVICON_MAX_BYTES) return void toast.error(t("orgBranding.faviconTooLarge"));
    setUploading("favicon");
    try {
      const res = await getFaviconUploadUrl({
        id: tenantId,
        data: { fileName: file.name, fileSize: file.size, contentType: file.type },
      }).unwrap();
      await uploadToS3(file, res.presignedUrl);
      set("faviconUrl", res.faviconUrl);
    } catch (error) {
      toast.error(errorText(error, t("orgBranding.uploadFailed")));
    } finally {
      setUploading(null);
    }
  };

  const handleCancel = () => {
    setForm(initial);
    setHexInput(initial.primaryColor);
    setConfirmReset(false);
  };

  const persist = async (patch: UpdateOrgBrandingBody) => {
    setIsSaving(true);
    try {
      const res = await updateBranding({ id: tenantId, data: patch }).unwrap();
      // The old logo file is unreferenced once the new URL is stored.
      if (patch.logoUrl !== undefined && initial.logoUrl && patch.logoUrl !== initial.logoUrl) {
        deleteLogo({ logoUrl: initial.logoUrl });
      }
      toast.success(t("orgBranding.saved"));
      res.warnings?.forEach(w => toast.warning(w));
      onSaved();
    } catch (error) {
      toast.error(errorText(error, t("orgBranding.failedToSave")));
    } finally {
      setIsSaving(false);
      setConfirmReset(false);
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    const text = (v: string) => (v.trim().length ? v.trim() : null);
    persist({
      ...(form.logoUrl !== initial.logoUrl ? { logoUrl: form.logoUrl } : {}),
      displayName: text(form.displayName),
      primaryColor: form.primaryColor === ALLY_BRAND_PRIMARY ? null : form.primaryColor,
      faviconUrl: form.faviconUrl,
      welcomeLine: text(form.welcomeLine),
    });
  };

  const handleReset = () => {
    if (!confirmReset) return setConfirmReset(true);
    persist({ displayName: null, primaryColor: null, faviconUrl: null, welcomeLine: null });
  };

  const displayName = form.displayName.trim() || orgName;

  const contrastText = !contrast
    ? null
    : contrast.verdict === "fail"
      ? t("orgBranding.contrastFail", { ratio: contrast.ratio })
      : contrast.verdict === "weak"
        ? t("orgBranding.contrastWeak", { ratio: contrast.ratio })
        : t("orgBranding.contrastPass", { ratio: contrast.ratio });

  return (
    <div className="flex flex-col lg:flex-row gap-8 w-full">
      {/* Form */}
      <div className="flex flex-col gap-6 w-full lg:w-1/2">
        <Field label={t("orgBranding.logo")} hint={t("orgBranding.logoHint")}>
          <div className="flex flex-row items-center gap-4">
            <div className="w-16 h-16 border border-border-light rounded flex items-center justify-center overflow-hidden bg-white">
              {form.logoUrl ? (
                <CustomImage
                  src={form.logoUrl}
                  alt={t("orgBranding.logo")}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-xs text-typography-400 text-center px-1">
                  {t("orgBranding.noLogo")}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={!!uploading}
              className={linkButtonClass}
            >
              {uploading === "logo"
                ? t("common.uploading")
                : form.logoUrl
                  ? t("orgBranding.changeLogo")
                  : t("orgBranding.uploadLogo")}
            </button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleLogoPick}
              className="hidden"
              data-testid="logo-input"
            />
          </div>
        </Field>

        <Field label={t("orgBranding.displayName")} hint={t("orgBranding.displayNameHint")}>
          <input
            type="text"
            value={form.displayName}
            maxLength={DISPLAY_NAME_MAX}
            placeholder={orgName}
            onChange={e => set("displayName", e.target.value)}
            aria-label={t("orgBranding.displayName")}
            className={inputClass}
          />
          <span className="text-xs text-typography-500 self-end">
            {form.displayName.length}/{DISPLAY_NAME_MAX}
          </span>
        </Field>

        <Field label={t("orgBranding.primaryColor")} hint={t("orgBranding.primaryColorHint")}>
          <div className="flex flex-row items-center gap-3">
            <input
              type="color"
              value={hexValid ? normaliseHex(hexInput) : form.primaryColor}
              onChange={e => handleHexChange(e.target.value)}
              aria-label={t("orgBranding.primaryColor")}
              className="h-10 w-12 p-0 border border-border-light rounded cursor-pointer bg-transparent"
            />
            <input
              type="text"
              value={hexInput}
              maxLength={7}
              placeholder={ALLY_BRAND_PRIMARY}
              onChange={e => handleHexChange(e.target.value)}
              aria-label={`${t("orgBranding.primaryColor")} hex`}
              className={`${inputClass} w-32 font-mono uppercase`}
            />
          </div>
          {!hexValid ? (
            <p className="text-xs text-red-600" data-testid="contrast-readout">
              {t("orgBranding.invalidHex")}
            </p>
          ) : (
            contrast && (
              <p
                className={`text-xs ${
                  contrast.verdict === "fail"
                    ? "text-red-600"
                    : contrast.verdict === "weak"
                      ? "text-amber-700"
                      : "text-typography-500"
                }`}
                data-testid="contrast-readout"
                data-verdict={contrast.verdict}
              >
                {contrastText}
              </p>
            )
          )}
        </Field>

        <Field label={t("orgBranding.favicon")} hint={t("orgBranding.faviconHint")}>
          <div className="flex flex-row items-center gap-4">
            <div className="w-8 h-8 border border-border-light rounded flex items-center justify-center overflow-hidden bg-white">
              {form.faviconUrl ? (
                <CustomImage
                  src={form.faviconUrl}
                  alt={t("orgBranding.favicon")}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="w-4 h-4 rounded-sm" style={{ background: ALLY_BRAND_PRIMARY }} />
              )}
            </div>
            {!form.faviconUrl && (
              <span className="text-sm text-typography-600">{t("orgBranding.allyFavicon")}</span>
            )}
            <button
              type="button"
              onClick={() => faviconInputRef.current?.click()}
              disabled={!!uploading}
              className={linkButtonClass}
            >
              {uploading === "favicon"
                ? t("common.uploading")
                : form.faviconUrl
                  ? t("orgBranding.changeFavicon")
                  : t("orgBranding.uploadFavicon")}
            </button>
            {form.faviconUrl && (
              <button
                type="button"
                onClick={() => set("faviconUrl", null)}
                className="text-typography-600 text-sm hover:text-typography-900"
              >
                {t("orgBranding.removeFavicon")}
              </button>
            )}
            <input
              ref={faviconInputRef}
              type="file"
              accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/webp,image/jpeg"
              onChange={handleFaviconPick}
              className="hidden"
              data-testid="favicon-input"
            />
          </div>
        </Field>

        <Field label={t("orgBranding.welcomeLine")} hint={t("orgBranding.welcomeLineHint")}>
          <textarea
            value={form.welcomeLine}
            maxLength={WELCOME_LINE_MAX}
            rows={2}
            placeholder={t("orgBranding.welcomeLinePlaceholder")}
            onChange={e => set("welcomeLine", e.target.value)}
            aria-label={t("orgBranding.welcomeLine")}
            className={`${inputClass} h-auto resize-none`}
          />
          <span className="text-xs text-typography-500 self-end">
            {form.welcomeLine.length}/{WELCOME_LINE_MAX}
          </span>
        </Field>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border-light">
          <div className="flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving || !!uploading}
              className={`text-sm ${confirmReset ? "text-red-600" : "text-typography-600"} hover:text-typography-900 disabled:text-typography-disabled`}
            >
              {confirmReset ? t("orgBranding.resetConfirm") : t("orgBranding.resetToDefaults")}
            </button>
            {confirmReset && (
              <span className="text-xs text-typography-500">{t("orgBranding.resetHint")}</span>
            )}
          </div>
          <div className="flex flex-row gap-2">
            <Button
              variant="secondary"
              onClick={handleCancel}
              disabled={!isDirty || isSaving}
              className="flex-1 sm:flex-none sm:w-[140px]"
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 sm:flex-none sm:w-[140px]"
            >
              {isSaving ? t("orgBranding.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="w-full lg:w-1/2">
        <div className="flex flex-row items-center gap-2 mb-2">
          <span className="text-sm text-typography-700">{t("orgBranding.preview")}</span>
          <span className="text-xs text-typography-500">{t("orgBranding.previewHint")}</span>
        </div>
        <div
          className="border border-border-light rounded overflow-hidden bg-white"
          data-testid="branding-preview"
        >
          <div className="flex flex-row items-center gap-2 px-3 py-2 bg-neutral-100 border-b border-border-light">
            <span className="w-4 h-4 rounded-sm overflow-hidden flex items-center justify-center bg-white">
              {form.faviconUrl ? (
                <CustomImage src={form.faviconUrl} alt="" className="w-4 h-4 object-contain" />
              ) : (
                <span className="w-3 h-3 rounded-sm" style={{ background: ALLY_BRAND_PRIMARY }} />
              )}
            </span>
            <span className="text-xs text-typography-800 truncate" data-testid="preview-tab-title">
              {displayName}
            </span>
          </div>
          <div className="flex flex-row min-h-[260px]" style={{ background: ALLY_PAGE_BACKGROUND }}>
            <div className="w-36 shrink-0 bg-white border-r border-border-light p-3 flex flex-col gap-3">
              <div className="flex flex-row items-center gap-2 min-w-0">
                {form.logoUrl ? (
                  <CustomImage
                    src={form.logoUrl}
                    alt=""
                    className="w-7 h-7 object-contain shrink-0"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-sm shrink-0" style={{ background: ramp[100] }} />
                )}
                <span
                  className="text-xs font-medium text-typography-900 truncate"
                  data-testid="preview-display-name"
                >
                  {displayName}
                </span>
              </div>
              <div className="flex flex-col gap-1 mt-2">
                <span
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: ramp[50], color: ramp[700] }}
                >
                  {t("orgBranding.previewNavHome")}
                </span>
                <span className="text-xs px-2 py-1 text-typography-600">
                  {t("orgBranding.previewNavRoleplays")}
                </span>
                <span className="text-xs px-2 py-1 text-typography-600">
                  {t("orgBranding.previewNavProgress")}
                </span>
              </div>
              <span className="mt-auto text-[10px] text-typography-500">
                {t("common.poweredByAlly")}
              </span>
            </div>
            <div className="flex-1 p-4 flex flex-col gap-3 min-w-0">
              {form.welcomeLine.trim() && (
                <p className="text-sm text-typography-800" data-testid="preview-welcome-line">
                  {form.welcomeLine.trim()}
                </p>
              )}
              <div className="h-2 w-2/3 rounded bg-neutral-200" />
              <div className="h-2 w-1/2 rounded bg-neutral-200" />
              <div className="flex flex-row items-center gap-4 mt-2">
                <span
                  className="text-xs px-3 py-2 rounded-none"
                  style={{ background: ramp[500], color: onPrimary }}
                  data-testid="preview-button"
                >
                  {t("orgBranding.previewButton")}
                </span>
                <span className="text-xs underline" style={{ color: ramp[600] }}>
                  {t("orgBranding.previewLink")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrgBranding;
