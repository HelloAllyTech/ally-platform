import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, CarbonToggle, Select, SelectItem } from "@ally-ui-mono/ui-shared";
import {
  useGetAllyGuideSettingsQuery,
  useGetTenantsQuery,
  useUpdateAllyGuideSettingsMutation,
} from "@api";
import { AddItemInput, ChipList } from "@components/ally-guide/ChipList";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock, ViewOnlyNote } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideSwitches, UpdateAllyGuideSwitchesBody } from "@types";
import { getErrorMessage } from "@utils";

const TENANT_PAGE_SIZE = 200;

type ListKey = "disabledCourses" | "disabledTenants" | "disabledCapabilities";
type SwitchKey = "enabled" | "anonymousChat" | "voice";

interface ListEditorProps {
  heading: string;
  help: string;
  emptyText: string;
  items: string[];
  labelFor?: (item: string) => string;
  removeLabel: (item: string) => string;
  canEdit: boolean;
  isSaving: boolean;
  testId: string;
  /** The control that adds an id: a text field for courses and capabilities, a picker for organisations. */
  adder: (onAdd: (value: string) => void) => React.ReactNode;
  onChange: (next: string[]) => void;
}

const ListEditor: React.FC<ListEditorProps> = ({
  heading,
  help,
  emptyText,
  items,
  labelFor,
  removeLabel,
  canEdit,
  isSaving,
  testId,
  adder,
  onChange,
}) => (
  <section className="flex flex-col gap-3" data-testid={testId}>
    <div className="flex items-center gap-1">
      <h4 className="text-lg font-normal text-typography-900">{heading}</h4>
      <InfoTip label={help} ariaLabel={`About ${heading}`} />
    </div>
    <ChipList
      items={items}
      labelFor={labelFor}
      removeLabel={removeLabel}
      onRemove={item => onChange(items.filter(existing => existing !== item))}
      disabled={!canEdit || isSaving}
      emptyText={emptyText}
      testId={`${testId}-chips`}
    />
    {canEdit && adder(value => onChange([...items, value]))}
  </section>
);

const OrganisationAdder: React.FC<{
  options: { id: string; name: string }[];
  taken: string[];
  disabled: boolean;
  onAdd: (id: string) => void;
}> = ({ options, taken, disabled, onAdd }) => {
  const strings = en.allyConsole.settings.lists.tenants;
  const [choice, setChoice] = useState("");
  const available = options.filter(option => !taken.includes(option.id));

  // No list to pick from (it failed to load, or the platform has none): fall back to an id.
  if (options.length === 0) {
    return (
      <AddItemInput
        id="ally-settings-tenant-id"
        label={strings.label}
        placeholder={strings.placeholder}
        addLabel={strings.add}
        disabled={disabled}
        validate={value =>
          !value
            ? en.allyConsole.settings.lists.blank
            : taken.includes(value)
              ? en.allyConsole.settings.lists.duplicate
              : null
        }
        onAdd={onAdd}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <Select
          id="ally-settings-tenant-select"
          labelText={strings.label}
          hideLabel
          size="md"
          value={choice}
          disabled={disabled}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setChoice(event.target.value)}
        >
          <SelectItem value="" text={strings.selectPlaceholder} />
          {available.map(option => (
            <SelectItem key={option.id} value={option.id} text={option.name} />
          ))}
        </Select>
      </div>
      <Button
        kind="tertiary"
        size="md"
        disabled={disabled || !choice}
        onClick={() => {
          onAdd(choice);
          setChoice("");
        }}
      >
        {strings.add}
      </Button>
    </div>
  );
};

/**
 * The kill switches (`global_settings.ally_guide`): the master switch, anonymous chat, voice, and the
 * courses, organisations and capabilities Ally is switched off for.
 *
 * They sit outside releases so they act at once, which is also why every change here is applied
 * the moment it is made, with no Save button to forget. The one confirm is the master switch going
 * OFF, because that moves every learner at once; turning things on, and the narrower switches, are
 * undone by the same click. The page always shows what the SERVER holds: a switch moves only when
 * the save has come back, so it never claims a protection that did not get written.
 */
export const SettingsTab: React.FC = () => {
  const strings = en.allyConsole.settings;
  const { canEdit } = useAllyGuideAccess();
  const { data, isLoading, isError, error, refetch } = useGetAllyGuideSettingsQuery();
  const [updateSettings, { isLoading: isSaving }] = useUpdateAllyGuideSettingsMutation();
  const [confirmOff, setConfirmOff] = useState(false);

  const { data: tenantPage } = useGetTenantsQuery({ limit: TENANT_PAGE_SIZE });
  const tenants = useMemo(
    () => (tenantPage?.data ?? []).map(tenant => ({ id: tenant.id, name: tenant.name })),
    [tenantPage],
  );
  const tenantNames = useMemo(
    () => Object.fromEntries(tenants.map(tenant => [tenant.id, tenant.name])),
    [tenants],
  );

  if (isLoading) return <LoadingBlock lines={6} />;
  if (isError || !data) {
    return <ErrorPanel what="the settings" error={error} onRetry={() => void refetch()} />;
  }

  const save = async (patch: UpdateAllyGuideSwitchesBody): Promise<boolean> => {
    try {
      await updateSettings(patch).unwrap();
      toast.success(strings.saved);
      return true;
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.saveFailed));
      return false;
    }
  };

  const handleToggle = (key: SwitchKey, checked: boolean) => {
    if (key === "enabled" && !checked) {
      setConfirmOff(true);
      return;
    }
    void save({ [key]: checked });
  };

  const switches: { key: SwitchKey; label: string; help: string }[] = [
    { key: "enabled", label: strings.enabled.label, help: strings.enabled.help },
    { key: "anonymousChat", label: strings.anonymousChat.label, help: strings.anonymousChat.help },
    { key: "voice", label: strings.voice.label, help: strings.voice.help },
  ];

  const setList = (key: ListKey) => (next: string[]) => void save({ [key]: next });
  const current: AllyGuideSwitches = data;

  return (
    <div className="flex max-w-3xl flex-col gap-8" data-testid="ally-settings">
      <p className="text-sm text-typography-800">{strings.intro}</p>
      {!canEdit && <ViewOnlyNote />}

      <section aria-labelledby="ally-switches-heading" className="flex flex-col gap-4">
        <h3 id="ally-switches-heading" className="text-xl font-normal text-typography-900">
          {strings.switchesHeading}
        </h3>
        {switches.map(({ key, label, help }) => (
          <div key={key} className="flex items-start gap-1" data-testid={`switch-${key}`}>
            <CarbonToggle
              id={`ally-switch-${key}`}
              size="sm"
              labelText={label}
              labelA={strings.off}
              labelB={strings.on}
              toggled={current[key]}
              disabled={!canEdit || isSaving}
              onToggle={(checked: boolean) => handleToggle(key, checked)}
            />
            <InfoTip label={help} ariaLabel={`About ${label}`} />
          </div>
        ))}
        <p className="text-xs text-typography-700" role="status">
          {isSaving ? strings.saving : ""}
        </p>
      </section>

      <section aria-labelledby="ally-lists-heading" className="flex flex-col gap-6">
        <h3 id="ally-lists-heading" className="text-xl font-normal text-typography-900">
          {strings.lists.heading}
        </h3>

        <ListEditor
          testId="list-courses"
          heading={strings.lists.courses.label}
          help={strings.lists.courses.help}
          emptyText={strings.lists.courses.empty}
          items={current.disabledCourses}
          removeLabel={strings.lists.remove}
          canEdit={canEdit}
          isSaving={isSaving}
          onChange={setList("disabledCourses")}
          adder={onAdd => (
            <AddItemInput
              id="ally-settings-course-id"
              label={strings.lists.courses.label}
              placeholder={strings.lists.courses.placeholder}
              addLabel={strings.lists.courses.add}
              disabled={isSaving}
              validate={value =>
                !value
                  ? strings.lists.blank
                  : current.disabledCourses.includes(value)
                    ? strings.lists.duplicate
                    : null
              }
              onAdd={onAdd}
            />
          )}
        />

        <ListEditor
          testId="list-tenants"
          heading={strings.lists.tenants.label}
          help={strings.lists.tenants.help}
          emptyText={strings.lists.tenants.empty}
          items={current.disabledTenants}
          labelFor={id => tenantNames[id] ?? id}
          removeLabel={id => strings.lists.remove(tenantNames[id] ?? id)}
          canEdit={canEdit}
          isSaving={isSaving}
          onChange={setList("disabledTenants")}
          adder={onAdd => (
            <OrganisationAdder
              options={tenants}
              taken={current.disabledTenants}
              disabled={isSaving}
              onAdd={onAdd}
            />
          )}
        />

        <ListEditor
          testId="list-capabilities"
          heading={strings.lists.capabilities.label}
          help={strings.lists.capabilities.help}
          emptyText={strings.lists.capabilities.empty}
          items={current.disabledCapabilities}
          removeLabel={strings.lists.remove}
          canEdit={canEdit}
          isSaving={isSaving}
          onChange={setList("disabledCapabilities")}
          adder={onAdd => (
            <AddItemInput
              id="ally-settings-capability-id"
              label={strings.lists.capabilities.label}
              placeholder={strings.lists.capabilities.placeholder}
              addLabel={strings.lists.capabilities.add}
              disabled={isSaving}
              validate={value =>
                !value
                  ? strings.lists.blank
                  : current.disabledCapabilities.includes(value)
                    ? strings.lists.duplicate
                    : null
              }
              onAdd={onAdd}
            />
          )}
        />
      </section>

      <ConfirmDialog
        isOpen={confirmOff}
        title={strings.turnOffDialog.title}
        cancelLabel={strings.turnOffDialog.cancel}
        confirmLabel={strings.turnOffDialog.confirm}
        danger
        isWorking={isSaving}
        onConfirm={() => {
          void save({ enabled: false }).then(ok => {
            if (ok) setConfirmOff(false);
          });
        }}
        onClose={() => setConfirmOff(false)}
      >
        <p>{strings.turnOffDialog.body}</p>
      </ConfirmDialog>
    </div>
  );
};
