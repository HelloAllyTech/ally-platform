import { FC, useEffect, useMemo, useState } from "react";

import { toast } from "sonner";

import { Select, SelectItem, TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import {
  CrmContactBody,
  CrmContactDetail,
  useCreateCrmContactMutation,
  useDeleteCrmContactMutation,
  useGetCrmContactMatchesQuery,
  useGetCrmContactQuery,
  useGetCrmManagersQuery,
  useUpdateCrmContactMutation,
} from "@api";
import { ActionConfirmationPopup, Button, EntitySidePanel } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";

import { ContactLog } from "./ContactLog";

interface FormValues {
  fullName: string;
  organization: string;
  jobTitle: string;
  notes: string;
  /** "" is unassigned; otherwise the user id as a string (a <select>'s value). */
  managerId: string;
}

const EMPTY: FormValues = {
  fullName: "",
  organization: "",
  jobTitle: "",
  notes: "",
  managerId: "",
};

const toFormValues = (contact: CrmContactDetail): FormValues => ({
  fullName: contact.fullName,
  organization: contact.organization ?? "",
  jobTitle: contact.jobTitle ?? "",
  notes: contact.notes ?? "",
  managerId: contact.relationshipManagerId == null ? "" : String(contact.relationshipManagerId),
});

/** Only what changed, so an edit never overwrites a field someone else just changed. */
export const diffFormValues = (values: FormValues, original: FormValues): CrmContactBody => {
  const body: CrmContactBody = {};
  if (values.fullName.trim() !== original.fullName) body.fullName = values.fullName.trim();
  if (values.organization.trim() !== original.organization)
    body.organization = values.organization.trim();
  if (values.jobTitle.trim() !== original.jobTitle) body.jobTitle = values.jobTitle.trim();
  if (values.notes !== original.notes) body.notes = values.notes;
  if (values.managerId !== original.managerId)
    body.relationshipManagerId = values.managerId === "" ? null : Number(values.managerId);
  return body;
};

const useDebounced = (value: string, ms: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(handle);
  }, [value, ms]);
  return debounced;
};

interface ContactPanelProps {
  /** null creates a new contact. */
  contactId: string | null;
  /** Jump to an existing contact, from the duplicate suggestions. */
  onOpenContact: (id: string) => void;
  onClose: () => void;
}

/** Create or edit one contact, with its conversation log underneath once it exists. */
export const ContactPanel: FC<ContactPanelProps> = ({ contactId, onOpenContact, onClose }) => {
  const t = en.crm.panel;
  const isNew = contactId === null;

  const {
    data: contact,
    isLoading,
    isError,
  } = useGetCrmContactQuery(contactId ?? "", {
    skip: isNew,
  });
  const { data: managersData } = useGetCrmManagersQuery();
  const [createContact, { isLoading: isCreating }] = useCreateCrmContactMutation();
  const [updateContact, { isLoading: isUpdating }] = useUpdateCrmContactMutation();
  const [deleteContact, { isLoading: isDeleting }] = useDeleteCrmContactMutation();

  const original = useMemo(() => (contact ? toFormValues(contact) : EMPTY), [contact]);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load the saved values into the form once per contact — not on every refetch, which would
  // overwrite what is being typed whenever a log entry is added.
  useEffect(() => {
    if (contact && loadedId !== contact.id) {
      setValues(toFormValues(contact));
      setLoadedId(contact.id);
    }
  }, [contact, loadedId]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: value }));

  // Duplicate check: as a new contact's name is typed, show who is already in the list.
  const debouncedName = useDebounced(isNew ? values.fullName.trim() : "", 250);
  const { data: matchData } = useGetCrmContactMatchesQuery(debouncedName, {
    skip: !isNew || debouncedName.length < 2,
  });
  const matches = isNew && debouncedName.length >= 2 ? (matchData?.contacts ?? []) : [];

  // The managers the server offers, plus the current one if they have since lost access, so
  // the select never silently shows "Unassigned" for a contact that has a manager.
  const managerOptions = useMemo(() => {
    const options = (managersData?.managers ?? []).map(m => ({
      value: String(m.userId),
      label: m.name,
    }));
    if (contact?.relationshipManagerId != null) {
      const id = String(contact.relationshipManagerId);
      if (!options.some(o => o.value === id)) {
        options.push({ value: id, label: contact.relationshipManagerName ?? `User ${id}` });
      }
    }
    return options;
  }, [managersData, contact]);

  const body = isNew
    ? ({
        fullName: values.fullName.trim(),
        organization: values.organization.trim(),
        jobTitle: values.jobTitle.trim(),
        notes: values.notes,
        relationshipManagerId: values.managerId === "" ? null : Number(values.managerId),
      } as CrmContactBody)
    : diffFormValues(values, original);
  const dirty = isNew
    ? Boolean(
        values.fullName ||
        values.organization ||
        values.jobTitle ||
        values.notes ||
        values.managerId,
      )
    : Object.keys(body).length > 0;
  const nameMissing = values.fullName.trim() === "";
  const isSaving = isCreating || isUpdating;

  const handleSave = async () => {
    const result = isNew
      ? await createContact(body)
      : await updateContact({ id: contactId, data: body });
    if ("error" in result && result.error) {
      const message = (result.error as { data?: { message?: string } }).data?.message;
      toast.error(message ?? en.crm.toasts.saveFailed);
      return;
    }
    if (isNew) {
      toast.success(en.crm.toasts.created(values.fullName.trim()));
      onClose();
      return;
    }
    toast.success(en.crm.toasts.saved);
    if ("data" in result && result.data) setValues(toFormValues(result.data));
  };

  const handleDelete = async () => {
    if (!contact) return;
    const result = await deleteContact(contact.id);
    setConfirmDelete(false);
    if ("error" in result && result.error) {
      toast.error(en.crm.toasts.deleteFailed);
      return;
    }
    toast.success(en.crm.toasts.deleted(contact.fullName));
    onClose();
  };

  return (
    <EntitySidePanel
      isOpen
      title={isNew ? t.newTitle : t.editTitle}
      dirty={dirty}
      saveDisabled={!dirty || nameMissing || isSaving}
      saveDisabledReason={nameMissing ? t.nameRequired : undefined}
      unsavedChangesWarning={t.unsavedChangesWarning}
      onClose={onClose}
      onSave={handleSave}
    >
      {!isNew && isLoading ? (
        <p className="text-typography-700">{t.loading}</p>
      ) : !isNew && (isError || !contact) ? (
        <p className="text-destructive-500">{t.loadFailed}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="crm-full-name" className="text-sm text-typography-900">
              {t.fullName}
            </label>
            <TextInput
              id="crm-full-name"
              labelText={t.fullName}
              hideLabel
              maxLength={200}
              value={values.fullName}
              onChange={e => set("fullName", e.target.value)}
            />
            {matches.length > 0 && (
              <div
                className="mt-1 rounded border border-border-light bg-background-secondary p-3"
                data-testid="crm-matches"
              >
                <p className="text-xs text-typography-700">{en.crm.matches.title}</p>
                <ul className="mt-1 flex flex-col divide-y divide-border-light">
                  {matches.map(match => (
                    <li key={match.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-sm text-typography-900">
                        <span className="font-medium">{match.fullName}</span>
                        <span className="text-typography-700">
                          {" · "}
                          {[match.organization, match.jobTitle].filter(Boolean).join(", ") ||
                            en.crm.matches.organizationFallback}
                        </span>
                      </span>
                      <Button
                        variant={ButtonVariant.TEXT}
                        onClick={() => onOpenContact(match.id)}
                        className="shrink-0"
                      >
                        {en.crm.matches.open}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="crm-organization" className="text-sm text-typography-900">
              {t.organization}
            </label>
            <TextInput
              id="crm-organization"
              labelText={t.organization}
              hideLabel
              maxLength={200}
              value={values.organization}
              onChange={e => set("organization", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="crm-job-title" className="text-sm text-typography-900">
              {t.jobTitle}
            </label>
            <TextInput
              id="crm-job-title"
              labelText={t.jobTitle}
              hideLabel
              maxLength={200}
              value={values.jobTitle}
              onChange={e => set("jobTitle", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="crm-manager" className="text-sm text-typography-900">
              {t.manager}
            </label>
            <p className="text-xs text-typography-700">{t.managerHelp}</p>
            <Select
              id="crm-manager"
              labelText={t.manager}
              hideLabel
              value={values.managerId}
              onChange={e => set("managerId", e.target.value)}
            >
              <SelectItem value="" text={t.noManager} />
              {managerOptions.map(o => (
                <SelectItem key={o.value} value={o.value} text={o.label} />
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="crm-notes" className="text-sm text-typography-900">
              {t.notes}
            </label>
            <TextArea
              id="crm-notes"
              labelText={t.notes}
              hideLabel
              rows={5}
              placeholder={t.notesPlaceholder}
              value={values.notes}
              onChange={e => set("notes", e.target.value)}
            />
          </div>

          {contact && (
            <>
              <ContactLog contactId={contact.id} logs={contact.logs} />
              <div className="border-t border-border-light pt-4">
                <Button
                  variant={ButtonVariant.TEXT}
                  onClick={() => setConfirmDelete(true)}
                  disabled={isDeleting}
                  className="text-destructive-500"
                >
                  {t.delete}
                </Button>
              </div>
              <ActionConfirmationPopup
                isOpen={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title={t.deleteTitle}
                description={t.deleteDescription(contact.fullName)}
                primaryButton={{ label: t.deleteConfirm, onClick: handleDelete }}
                secondaryButton={{ label: t.deleteCancel, onClick: () => setConfirmDelete(false) }}
              />
            </>
          )}
        </div>
      )}
    </EntitySidePanel>
  );
};
