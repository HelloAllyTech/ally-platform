import { FC, useEffect, useMemo, useState } from "react";

import {
  Checkbox,
  CarbonToggle,
  ComboBox,
  Modal,
  Select,
  SelectItem,
  TextInput,
} from "@ally-ui-mono/ui-shared";

import {
  blankLandingPageForm,
  LANDING_LANGUAGE_LABELS,
  LANDING_LANGUAGE_NAMES_EN,
  LANDING_LANGUAGES,
  LandingPageFormValues,
  NAME_MAX,
  slugify,
  SLUG_MAX,
  validateLandingPageForm,
} from "./landingPageForm";
import { useGetTenantsQuery } from "../../api/userManagement";

interface LandingPageFormDialogProps {
  open: boolean;
  /** Create picks the organization; settings keeps the page's own and shows it. */
  mode: "create" | "settings";
  initial?: LandingPageFormValues;
  /** The page's organization, shown in settings mode. */
  tenantLabel?: string;
  /** The organization's code, to show the address as visitors will type it. */
  tenantCode?: string;
  submitting?: boolean;
  /** A message from the server (for example, that the address is taken). */
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (values: LandingPageFormValues) => void;
}

/**
 * The few settings that are not visible on the page itself: which organization,
 * what to call the page and where it lives, which languages it offers, and
 * whether visitors may sign up. Everything else is edited on the page.
 */
export const LandingPageFormDialog: FC<LandingPageFormDialogProps> = ({
  open,
  mode,
  initial,
  tenantLabel,
  tenantCode,
  submitting = false,
  serverError,
  onClose,
  onSubmit,
}) => {
  const [values, setValues] = useState<LandingPageFormValues>(initial ?? blankLandingPageForm());
  const [slugTouched, setSlugTouched] = useState(mode === "settings");
  const [showErrors, setShowErrors] = useState(false);
  const [tenantSearch, setTenantSearch] = useState("");

  const { data: tenantData } = useGetTenantsQuery(
    { limit: 50, search: tenantSearch || undefined },
    { skip: mode !== "create" || !open },
  );
  const tenants = useMemo(() => tenantData?.data ?? [], [tenantData]);

  useEffect(() => {
    if (open) {
      setValues(initial ?? blankLandingPageForm());
      setSlugTouched(mode === "settings");
      setShowErrors(false);
    }
    // Reset only when the dialog opens, not on every change to `initial`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errors = validateLandingPageForm(values, { needsTenant: mode === "create" });
  const code = tenantCode ?? tenants.find(tenant => tenant.id === values.tenantId)?.code ?? "";

  const set = (patch: Partial<LandingPageFormValues>) =>
    setValues(current => ({ ...current, ...patch }));

  const toggleLanguage = (language: (typeof LANDING_LANGUAGES)[number], on: boolean) => {
    const languages = on
      ? LANDING_LANGUAGES.filter(item => values.languages.includes(item) || item === language)
      : values.languages.filter(item => item !== language);
    set({
      languages,
      defaultLanguage: languages.includes(values.defaultLanguage)
        ? values.defaultLanguage
        : (languages[0] ?? "en"),
    });
  };

  const submit = () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    onSubmit({ ...values, name: values.name.trim() });
  };

  return (
    <Modal
      open={open}
      modalHeading={mode === "create" ? "New landing page" : "Page settings"}
      primaryButtonText={mode === "create" ? "Create page" : "Save settings"}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={submitting}
      onRequestClose={onClose}
      onRequestSubmit={submit}
      onSecondarySubmit={onClose}
      size="sm"
    >
      <div className="flex flex-col gap-5">
        {mode === "create" ? (
          <ComboBox
            id="landing-form-tenant"
            titleText="Organization"
            placeholder="Search organizations"
            items={tenants}
            itemToString={(tenant: { name: string; code: string } | null) =>
              tenant ? `${tenant.name} (${tenant.code})` : ""
            }
            onInputChange={(text: string) => setTenantSearch(text)}
            onChange={({ selectedItem }: { selectedItem: { id: string } | null }) =>
              set({ tenantId: selectedItem?.id ?? "" })
            }
            invalid={showErrors && !!errors.tenantId}
            invalidText={errors.tenantId}
          />
        ) : (
          <p>
            <strong>Organization:</strong> {tenantLabel}
          </p>
        )}

        <TextInput
          id="landing-form-name"
          labelText="Page name"
          helperText="Only you see this. Visitors never do."
          maxLength={NAME_MAX}
          value={values.name}
          invalid={showErrors && !!errors.name}
          invalidText={errors.name}
          onChange={event => {
            const name = event.target.value;
            set({ name, ...(slugTouched ? {} : { slug: slugify(name) }) });
          }}
        />

        <TextInput
          id="landing-form-slug"
          labelText="Address"
          helperText={`Visitors open ${code ? `/${code}` : "/<organization code>"}/${values.slug || "<address>"}`}
          maxLength={SLUG_MAX}
          value={values.slug}
          invalid={showErrors && !!errors.slug}
          invalidText={errors.slug}
          onChange={event => {
            setSlugTouched(true);
            set({ slug: event.target.value.toLowerCase() });
          }}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm">Languages the page offers</legend>
          {LANDING_LANGUAGES.map(language => (
            <Checkbox
              key={language}
              id={`landing-form-lang-${language}`}
              labelText={`${LANDING_LANGUAGE_NAMES_EN[language]} (${LANDING_LANGUAGE_LABELS[language]})`}
              checked={values.languages.includes(language)}
              onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                toggleLanguage(language, checked)
              }
            />
          ))}
          {showErrors && errors.languages && (
            <p role="alert" className="text-sm text-red-700">
              {errors.languages}
            </p>
          )}
        </fieldset>

        {values.languages.length > 1 && (
          <Select
            id="landing-form-default-language"
            labelText="Opens in"
            value={values.defaultLanguage}
            onChange={event =>
              set({ defaultLanguage: event.target.value as typeof values.defaultLanguage })
            }
          >
            {values.languages.map(language => (
              <SelectItem
                key={language}
                value={language}
                text={LANDING_LANGUAGE_NAMES_EN[language]}
              />
            ))}
          </Select>
        )}

        <CarbonToggle
          id="landing-form-signup"
          labelText="Sign-up"
          labelA="Visitors can't sign up"
          labelB="Visitors can sign up"
          toggled={values.signUpEnabled}
          onToggle={(on: boolean) => set({ signUpEnabled: on })}
        />
        <p className="text-sm">
          Saved with the page. Sign-up itself isn&apos;t built yet, so this does nothing visible
          today.
        </p>

        {serverError && (
          <p role="alert" className="text-sm text-red-700">
            {serverError}
          </p>
        )}
      </div>
    </Modal>
  );
};
