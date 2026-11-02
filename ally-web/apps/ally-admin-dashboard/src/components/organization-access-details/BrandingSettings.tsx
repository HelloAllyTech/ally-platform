import { ChangeEvent, FC, useCallback, useMemo, useRef, useState } from "react";

import axios from "axios";
import { useSelector } from "react-redux";
import { toast } from "sonner";

import { CustomImage, Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useDeleteLogoMutation,
  useGetTenantByIdQuery,
  usePostBrandingFaviconUrlMutation,
  usePostLogoUrlMutation,
  useUpdateTenantBrandingMutation,
  useUpdateTenantMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { Button, ToggleSwitch } from "@components";
import { en } from "@constants";
import { RootState } from "@store";
import { Tenant, UpdateTenantBrandingBody } from "@types";
import {
  ALLY_BRAND_PRIMARY,
  ALLY_PAGE_BACKGROUND,
  brandContrastVerdict,
  buildPreviewRamp,
  isHexColour,
  normaliseHex,
  pickOnPrimary,
} from "@utils";

/**
 * Organization branding editor (admin console → organization → Branding tab).
 *
 * Who may edit what: every admin who can open this org may edit the fields,
 * but the on/off switch at the top is an org-level policy and only an
 * unrestricted platform admin (restrictedTenantIds === null on /users/me) can
 * flip it. The backend enforces both; this screen only mirrors them.
 *
 * Save model: explicit. Uploads go to S3 as soon as a file is picked, but the
 * resulting URL sits in the form until Save, so Cancel still discards it from
 * the org. The logo is the one field persisted through updateTenant rather
 * than the branding route, since it lives on the tenant row and every client
 * already reads it from there.
 *
 * The preview and the contrast readout are computed client-side as the admin
 * types; what is actually stored (and the ramp the web app paints with) comes
 * back from the backend on Save.
 */

interface BrandingSettingsProps {
  tenantId: string;
  onUpdateTenant: () => void;
}

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

const formFromTenant = (tenant: Tenant): BrandingForm => {
  const b = tenant.branding;
  return {
    logoUrl: tenant.logoUrl || null,
    // The response is RESOLVED: displayName falls back to the org name, so a
    // value equal to the name reads as "not set" here. Saving blank gives the
    // same result on the backend, so nothing is lost.
    displayName: b?.displayName && b.displayName !== tenant.name ? b.displayName : "",
    primaryColor: b?.primaryColor ?? ALLY_BRAND_PRIMARY,
    faviconUrl: b?.faviconUrl ?? null,
    welcomeLine: b?.welcomeLine ?? "",
  };
};

const errorText = (error: any, fallback: string): string => {
  const m = error?.data?.message;
  if (Array.isArray(m)) return m.join(" ");
  return typeof m === "string" && m ? m : fallback;
};

const uploadToS3 = async (file: File, presignedUrl: string) => {
  const res = await axios.put(presignedUrl, file, { headers: { "Content-Type": file.type } });
  if (res.status !== 200) throw new Error("upload failed");
};

const FieldLabel: FC<{ label: string; hint?: string }> = ({ label, hint }) => (
  <div className="flex flex-row items-center gap-2 text-sm text-typography-700 font-normal">
    {label}
    {hint && (
      <Tooltip label={hint} align="top">
        <button type="button" className="cursor-pointer inline-flex items-center">
          <TooltipIcon />
        </button>
      </Tooltip>
    )}
  </div>
);

const BrandingSkeleton = () => (
  <div className="w-full animate-pulse flex flex-col gap-4 mt-2" data-testid="branding-skeleton">
    <div className="h-9 bg-neutral-200 rounded w-1/2" />
    <div className="h-40 bg-neutral-200 rounded w-full md:w-2/3" />
  </div>
);

const inputClass =
  "h-10 w-full rounded-none border-0 border-b border-border-dark bg-secondary-50 px-3 py-2 text-base placeholder:text-typography-placeholder focus:outline-none focus-visible:border-b-2 focus-visible:border-primary-500";

const linkButtonClass =
  "text-primary-600 text-sm font-medium hover:text-primary-700 disabled:text-typography-disabled";

export const BrandingSettings: FC<BrandingSettingsProps> = ({ tenantId, onUpdateTenant }) => {
  const { data: tenant, isLoading, refetch } = useGetTenantByIdQuery(tenantId);
  const [updateTenant] = useUpdateTenantMutation();
  const [isSwitching, setIsSwitching] = useState(false);

  const restrictedTenantIds = useSelector(
    (state: RootState) => state.user.user?.restrictedTenantIds ?? null,
  );
  const canFlipSwitch = restrictedTenantIds === null;

  const initial = useMemo(() => (tenant ? formFromTenant(tenant) : null), [tenant]);
  const enabled = tenant?.brandingEnabled === true;

  const handleSaved = useCallback(() => {
    onUpdateTenant();
    refetch();
  }, [onUpdateTenant, refetch]);

  const handleSwitch = async (next: boolean) => {
    if (!canFlipSwitch || isSwitching) return;
    setIsSwitching(true);
    try {
      await updateTenant({ id: tenantId, data: { brandingEnabled: next } }).unwrap();
      toast.success(next ? en.orgBranding.switchedOn : en.orgBranding.switchedOff);
      handleSaved();
    } catch (error: any) {
      toast.error(errorText(error, en.orgBranding.failedToSwitch));
    } finally {
      setIsSwitching(false);
    }
  };

  if (isLoading || !tenant || !initial) return <BrandingSkeleton />;

  return (
    <div className="flex flex-col gap-6 font-primary w-full">
      {/* Org-level switch */}
      <div className="flex min-h-9 flex-row justify-between items-center gap-3 w-full md:w-2/3">
        <FieldLabel label={en.orgBranding.switchLabel} hint={en.orgBranding.switchHint} />
        <div className="flex flex-row items-center gap-2">
          <ToggleSwitch
            enabled={enabled}
            onChange={handleSwitch}
            disabled={!canFlipSwitch || isSwitching}
            label={en.orgBranding.switchLabel}
          />
          <span className="text-sm text-typography-900 font-normal">
            {enabled ? en.common.enabled : en.common.disabled}
          </span>
        </div>
      </div>
      {!canFlipSwitch && (
        <p className="text-xs text-typography-500 -mt-4">{en.orgBranding.switchRestricted}</p>
      )}

      {!enabled ? (
        <div
          className="border border-border-light rounded p-6 w-full md:w-2/3 flex flex-col gap-2"
          data-testid="branding-off"
        >
          <span className="text-base text-typography-900">{en.orgBranding.offTitle}</span>
          <p className="text-sm text-typography-600">{en.orgBranding.offBody}</p>
        </div>
      ) : (
        // Keyed on the loaded values: a refetch after Save or Reset remounts the
        // editor with fresh state instead of syncing it through an effect.
        <BrandingEditor
          key={JSON.stringify(initial)}
          tenantId={tenantId}
          orgName={tenant.name}
          initial={initial}
          onSaved={handleSaved}
        />
      )}
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
  const [updateTenant] = useUpdateTenantMutation();
  const [updateBranding] = useUpdateTenantBrandingMutation();
  const [postLogoUrl] = usePostLogoUrlMutation();
  const [deleteLogo] = useDeleteLogoMutation();
  const [postFaviconUrl] = usePostBrandingFaviconUrlMutation();

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
    if (!LOGO_TYPES.includes(file.type)) return void toast.error(en.orgBranding.logoWrongType);
    if (file.size > LOGO_MAX_BYTES) return void toast.error(en.orgBranding.logoTooLarge);
    setUploading("logo");
    try {
      const res = await postLogoUrl({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      }).unwrap();
      await uploadToS3(file, res.presignedUrl);
      set("logoUrl", res.logoUrl);
    } catch {
      toast.error(en.orgBranding.uploadFailed);
    } finally {
      setUploading(null);
    }
  };

  const handleFaviconPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!FAVICON_TYPES.includes(file.type))
      return void toast.error(en.orgBranding.faviconWrongType);
    if (file.size > FAVICON_MAX_BYTES) return void toast.error(en.orgBranding.faviconTooLarge);
    setUploading("favicon");
    try {
      const res = await postFaviconUrl({
        id: tenantId,
        data: { fileName: file.name, fileSize: file.size, contentType: file.type },
      }).unwrap();
      await uploadToS3(file, res.presignedUrl);
      set("faviconUrl", res.faviconUrl);
    } catch (error: any) {
      toast.error(errorText(error, en.orgBranding.uploadFailed));
    } finally {
      setUploading(null);
    }
  };

  const handleCancel = () => {
    setForm(initial);
    setHexInput(initial.primaryColor);
    setConfirmReset(false);
  };

  const persist = async (patch: UpdateTenantBrandingBody, logoUrl: string | null | undefined) => {
    setIsSaving(true);
    try {
      if (logoUrl !== undefined && logoUrl !== initial.logoUrl) {
        await updateTenant({ id: tenantId, data: { logoUrl: logoUrl ?? "" } }).unwrap();
        if (initial.logoUrl) deleteLogo({ logoUrl: initial.logoUrl });
      }
      const res = await updateBranding({ id: tenantId, data: patch }).unwrap();
      toast.success(en.orgBranding.saved);
      res.warnings?.forEach(w => toast.warning(w));
      onSaved();
    } catch (error: any) {
      toast.error(errorText(error, en.orgBranding.failedToSave));
    } finally {
      setIsSaving(false);
      setConfirmReset(false);
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    const text = (v: string) => (v.trim().length ? v.trim() : null);
    persist(
      {
        displayName: text(form.displayName),
        primaryColor: form.primaryColor === ALLY_BRAND_PRIMARY ? null : form.primaryColor,
        faviconUrl: form.faviconUrl,
        welcomeLine: text(form.welcomeLine),
      },
      form.logoUrl,
    );
  };

  const handleReset = () => {
    if (!confirmReset) return setConfirmReset(true);
    persist(
      { displayName: null, primaryColor: null, faviconUrl: null, welcomeLine: null },
      undefined,
    );
  };

  const displayName = form.displayName.trim() || orgName;

  return (
    <div className="flex flex-col lg:flex-row gap-8 w-full">
      {/* Form */}
      <div className="flex flex-col gap-6 w-full lg:w-1/2">
        {/* Logo */}
        <div className="flex flex-col gap-2">
          <FieldLabel label={en.orgBranding.logo} hint={en.orgBranding.logoHint} />
          <div className="flex flex-row items-center gap-4">
            <div className="w-16 h-16 border border-border-light rounded flex items-center justify-center overflow-hidden bg-white">
              {form.logoUrl ? (
                <CustomImage
                  src={form.logoUrl}
                  alt={en.orgBranding.logo}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-xs text-typography-400 text-center px-1">
                  {en.orgBranding.noLogo}
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
                ? en.badge.uploading
                : form.logoUrl
                  ? en.orgBranding.changeLogo
                  : en.orgBranding.uploadLogo}
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
        </div>

        {/* Display name */}
        <div className="flex flex-col gap-2">
          <FieldLabel label={en.orgBranding.displayName} hint={en.orgBranding.displayNameHint} />
          <input
            type="text"
            value={form.displayName}
            maxLength={DISPLAY_NAME_MAX}
            placeholder={orgName}
            onChange={e => set("displayName", e.target.value)}
            aria-label={en.orgBranding.displayName}
            className={inputClass}
          />
          <span className="text-xs text-typography-500 self-end">
            {form.displayName.length}/{DISPLAY_NAME_MAX}
          </span>
        </div>

        {/* Brand colour */}
        <div className="flex flex-col gap-2">
          <FieldLabel label={en.orgBranding.primaryColor} hint={en.orgBranding.primaryColorHint} />
          <div className="flex flex-row items-center gap-3">
            <input
              type="color"
              value={hexValid ? normaliseHex(hexInput) : form.primaryColor}
              onChange={e => handleHexChange(e.target.value)}
              aria-label={en.orgBranding.primaryColor}
              className="h-10 w-12 p-0 border border-border-light rounded cursor-pointer bg-transparent"
            />
            <input
              type="text"
              value={hexInput}
              maxLength={7}
              placeholder={en.orgBranding.hexPlaceholder}
              onChange={e => handleHexChange(e.target.value)}
              aria-label={`${en.orgBranding.primaryColor} hex`}
              className={`${inputClass} w-32 font-mono uppercase`}
            />
          </div>
          {!hexValid ? (
            <p className="text-xs text-red-600" data-testid="contrast-readout">
              {en.orgBranding.invalidHex}
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
                {contrast.verdict === "fail"
                  ? en.orgBranding.contrastFail(contrast.ratio)
                  : contrast.verdict === "weak"
                    ? en.orgBranding.contrastWeak(contrast.ratio)
                    : en.orgBranding.contrastPass(contrast.ratio)}
              </p>
            )
          )}
        </div>

        {/* Favicon */}
        <div className="flex flex-col gap-2">
          <FieldLabel label={en.orgBranding.favicon} hint={en.orgBranding.faviconHint} />
          <div className="flex flex-row items-center gap-4">
            <div className="w-8 h-8 border border-border-light rounded flex items-center justify-center overflow-hidden bg-white">
              {form.faviconUrl ? (
                <CustomImage
                  src={form.faviconUrl}
                  alt={en.orgBranding.favicon}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="w-4 h-4 rounded-sm" style={{ background: ALLY_BRAND_PRIMARY }} />
              )}
            </div>
            {!form.faviconUrl && (
              <span className="text-sm text-typography-600">{en.orgBranding.allyFavicon}</span>
            )}
            <button
              type="button"
              onClick={() => faviconInputRef.current?.click()}
              disabled={!!uploading}
              className={linkButtonClass}
            >
              {uploading === "favicon"
                ? en.badge.uploading
                : form.faviconUrl
                  ? en.orgBranding.changeFavicon
                  : en.orgBranding.uploadFavicon}
            </button>
            {form.faviconUrl && (
              <button
                type="button"
                onClick={() => set("faviconUrl", null)}
                className="text-typography-600 text-sm hover:text-typography-900"
              >
                {en.orgBranding.removeFavicon}
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
        </div>

        {/* Welcome line */}
        <div className="flex flex-col gap-2">
          <FieldLabel label={en.orgBranding.welcomeLine} hint={en.orgBranding.welcomeLineHint} />
          <textarea
            value={form.welcomeLine}
            maxLength={WELCOME_LINE_MAX}
            rows={2}
            placeholder={en.orgBranding.welcomeLinePlaceholder}
            onChange={e => set("welcomeLine", e.target.value)}
            aria-label={en.orgBranding.welcomeLine}
            className={`${inputClass} h-auto resize-none`}
          />
          <span className="text-xs text-typography-500 self-end">
            {form.welcomeLine.length}/{WELCOME_LINE_MAX}
          </span>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border-light">
          <div className="flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving || !!uploading}
              className={`text-sm ${confirmReset ? "text-red-600" : "text-typography-600"} hover:text-typography-900 disabled:text-typography-disabled`}
            >
              {confirmReset ? en.orgBranding.resetConfirm : en.orgBranding.resetToDefaults}
            </button>
            {confirmReset && (
              <span className="text-xs text-typography-500">{en.orgBranding.resetHint}</span>
            )}
          </div>
          <div className="flex flex-row gap-2">
            <Button
              variant="secondary"
              onClick={handleCancel}
              disabled={!isDirty || isSaving}
              className="flex-1 sm:flex-none sm:w-[140px]"
            >
              {en.common.cancel}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 sm:flex-none sm:w-[140px]"
            >
              {isSaving ? en.orgBranding.saving : en.common.save}
            </Button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="w-full lg:w-1/2">
        <div className="flex flex-row items-center gap-2 mb-2">
          <span className="text-sm text-typography-700">{en.orgBranding.preview}</span>
          <span className="text-xs text-typography-500">{en.orgBranding.previewHint}</span>
        </div>
        <div
          className="border border-border-light rounded overflow-hidden bg-white"
          data-testid="branding-preview"
        >
          {/* Browser tab */}
          <div className="flex flex-row items-center gap-2 px-3 py-2 bg-neutral-100 border-b border-border-light">
            <span className="w-4 h-4 rounded-sm overflow-hidden flex items-center justify-center bg-white">
              {form.faviconUrl ? (
                <CustomImage src={form.faviconUrl} alt="" className="w-4 h-4 object-contain" />
              ) : (
                <span className="w-3 h-3 rounded-sm" style={{ background: ALLY_BRAND_PRIMARY }} />
              )}
            </span>
            <span className="text-xs text-typography-800 truncate" data-testid="preview-tab-title">
              {en.orgBranding.previewTab(displayName)}
            </span>
          </div>
          <div className="flex flex-row min-h-[260px]" style={{ background: ALLY_PAGE_BACKGROUND }}>
            {/* Sidebar */}
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
                  {en.orgBranding.previewNavHome}
                </span>
                <span className="text-xs px-2 py-1 text-typography-600">
                  {en.orgBranding.previewNavRoleplays}
                </span>
                <span className="text-xs px-2 py-1 text-typography-600">
                  {en.orgBranding.previewNavProgress}
                </span>
              </div>
              <span className="mt-auto text-[10px] text-typography-500">
                {en.orgBranding.poweredBy}
              </span>
            </div>
            {/* Page */}
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
                  {en.orgBranding.previewButton}
                </span>
                <span className="text-xs underline" style={{ color: ramp[600] }}>
                  {en.orgBranding.previewLink}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrandingSettings;
