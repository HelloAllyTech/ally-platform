import React, { useState } from "react";

import { Trash } from "@icons";

import {
  Button,
  Checkbox,
  ContentSwitcher,
  IconButton,
  Switch,
  TextInput,
} from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { AllyGuideLanguage } from "@types";

import { ALLY_GUIDE_LANGUAGES } from "./allyGuideFormat";
import { InfoTip } from "./InfoTip";
import {
  DraftLine,
  emptyLine,
  LineErrors,
  LIMITS,
  MAX_LINES_PER_LANGUAGE,
} from "./orgProfileDraft";

interface SupportLinesEditorProps {
  value: Record<AllyGuideLanguage, DraftLine[]>;
  onChange: (next: Record<AllyGuideLanguage, DraftLine[]>) => void;
  disabled?: boolean;
  /** Errors by line key. Shown only once the admin has touched a row, so a fresh row is not red. */
  errors: Record<string, LineErrors>;
  /** Line keys the admin has edited; an untouched new row stays quiet until then. */
  touched: Set<string>;
  onTouch: (key: string) => void;
}

/**
 * Support lines, one language at a time: name, phone, hours, link and a crisis flag per line.
 *
 * One language is shown at a time because the five lists are independent (the learner sees their
 * language's, else English's, else the platform's) and stacking them would bury the one being
 * edited. Each language's tab carries its line count, so an admin can see at a glance which are
 * empty and will fall back.
 */
export const SupportLinesEditor: React.FC<SupportLinesEditorProps> = ({
  value,
  onChange,
  disabled = false,
  errors,
  touched,
  onTouch,
}) => {
  const strings = en.allyConsole.org.supportLines;
  const [language, setLanguage] = useState<AllyGuideLanguage>("en");
  const lines = value[language] ?? [];
  const atCap = lines.length >= MAX_LINES_PER_LANGUAGE;

  const setLines = (next: DraftLine[]) => onChange({ ...value, [language]: next });
  const patchLine = (key: string, patch: Partial<DraftLine>) => {
    onTouch(key);
    setLines(lines.map(line => (line.key === key ? { ...line, ...patch } : line)));
  };

  const errorText = (key: string, field: keyof LineErrors): string | undefined => {
    const code = errors[key]?.[field];
    if (!code || !touched.has(key)) return undefined;
    return strings.errors[code];
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-typography-800">{strings.languageSwitch}</span>
        <InfoTip label={strings.help} ariaLabel="About support lines" />
      </div>
      <div data-testid="support-lines-switcher">
        <ContentSwitcher
          size="md"
          selectedIndex={ALLY_GUIDE_LANGUAGES.indexOf(language)}
          onChange={(event: { name?: string | number }) =>
            setLanguage(String(event.name) as AllyGuideLanguage)
          }
          className="max-w-2xl"
        >
          {ALLY_GUIDE_LANGUAGES.map(code => (
            <Switch
              key={code}
              name={code}
              text={`${en.allyConsole.languages[code]}${(value[code]?.length ?? 0) > 0 ? ` (${value[code].length})` : ""}`}
            />
          ))}
        </ContentSwitcher>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-typography-700" data-testid="support-lines-empty">
          {strings.none}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const idBase = `ally-line-${language}-${line.key}`;
            return (
              <li
                key={line.key}
                className="border border-border-light p-3"
                aria-label={strings.lineLabel(index + 1)}
                data-testid="support-line-row"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <TextInput
                    id={`${idBase}-name`}
                    labelText={strings.name}
                    placeholder={strings.namePlaceholder}
                    size="md"
                    value={line.name}
                    maxLength={LIMITS.lineName}
                    disabled={disabled}
                    invalid={Boolean(errorText(line.key, "name"))}
                    invalidText={errorText(line.key, "name")}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      patchLine(line.key, { name: event.target.value })
                    }
                  />
                  <TextInput
                    id={`${idBase}-phone`}
                    labelText={strings.phone}
                    placeholder={strings.phonePlaceholder}
                    size="md"
                    inputMode="tel"
                    value={line.phone}
                    maxLength={LIMITS.linePhone}
                    disabled={disabled}
                    invalid={Boolean(errorText(line.key, "phone"))}
                    invalidText={errorText(line.key, "phone")}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      patchLine(line.key, { phone: event.target.value })
                    }
                  />
                  <TextInput
                    id={`${idBase}-hours`}
                    labelText={strings.hours}
                    placeholder={strings.hoursPlaceholder}
                    size="md"
                    value={line.hours}
                    maxLength={LIMITS.lineHours}
                    disabled={disabled}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      patchLine(line.key, { hours: event.target.value })
                    }
                  />
                  <TextInput
                    id={`${idBase}-url`}
                    labelText={strings.url}
                    placeholder={strings.urlPlaceholder}
                    size="md"
                    inputMode="url"
                    value={line.url}
                    maxLength={LIMITS.lineUrl}
                    disabled={disabled}
                    invalid={Boolean(errorText(line.key, "url"))}
                    invalidText={errorText(line.key, "url")}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      patchLine(line.key, { url: event.target.value })
                    }
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Checkbox
                      id={`${idBase}-crisis`}
                      labelText={strings.isCrisis}
                      checked={line.isCrisis}
                      disabled={disabled}
                      onChange={(_event: unknown, { checked }: { checked: boolean }) =>
                        patchLine(line.key, { isCrisis: checked })
                      }
                    />
                    <InfoTip label={strings.isCrisisHelp} ariaLabel="About crisis lines" />
                  </div>
                  {!disabled && (
                    <IconButton
                      label={strings.remove(index + 1)}
                      kind="ghost"
                      size="sm"
                      autoAlign
                      onClick={() => setLines(lines.filter(item => item.key !== line.key))}
                    >
                      <Trash />
                    </IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            kind="tertiary"
            size="md"
            disabled={atCap}
            onClick={() => setLines([...lines, emptyLine()])}
          >
            {strings.add}
          </Button>
          {atCap && (
            <span className="text-xs text-typography-700">
              {strings.capReached(MAX_LINES_PER_LANGUAGE)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
