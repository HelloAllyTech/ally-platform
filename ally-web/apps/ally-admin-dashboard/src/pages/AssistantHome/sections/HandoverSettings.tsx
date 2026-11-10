import React, { useId } from "react";

import type { HandoverSettings as Settings } from "@types";

import { HOME } from "../copy";
import { Group } from "../fields";

import type { HomeField } from "../useHomeField";

const t = HOME.handover;
const DAYS = [1, 2, 3, 4, 5, 6, 0];

/**
 * When someone asks for a person (chunk 11a): what visitors are told, opening hours (optional;
 * without them the in-hours line is always used), the auto hand-back, the owners' email, and
 * whether a reply is signed with the team member's first name. Saves as you go, like every field.
 */
export const HandoverSettingsGroup: React.FC<{
  field: HomeField<Settings>;
  disabled: boolean;
}> = ({ field, disabled }) => {
  const id = useId();
  const value = field.value;
  const set = (patch: Partial<Settings>, now = false) => field.set({ ...value, ...patch }, { now });
  const hours = value.hours;

  return (
    <Group title={t.title} testId="share-handover">
      <div className="ally-field">
        <label className="ally-field__label" htmlFor={`${id}-within`}>
          {t.replyWithin}
        </label>
        <input
          id={`${id}-within`}
          className="ally-input"
          value={value.replyWithin}
          maxLength={40}
          disabled={disabled}
          onChange={event => set({ replyWithin: event.target.value })}
          onBlur={field.flush}
        />
      </div>

      <fieldset className="ally-field ally-home__hours" disabled={disabled}>
        <legend className="ally-field__label">{t.hours}</legend>
        <span className="ally-field__hint">{t.hoursHint}</span>
        <label className="ally-home__check">
          <input
            type="checkbox"
            checked={hours !== null}
            onChange={event =>
              set(
                {
                  hours: event.target.checked
                    ? {
                        timeZone: "Asia/Kolkata",
                        days: [1, 2, 3, 4, 5],
                        from: "09:00",
                        to: "18:00",
                      }
                    : null,
                },
                true,
              )
            }
          />{" "}
          {t.hours}
        </label>
        {hours && (
          <>
            <div className="ally-home__days" role="group" aria-label={t.days}>
              {DAYS.map(day => (
                <label key={day} className="ally-home__check">
                  <input
                    type="checkbox"
                    checked={hours.days.includes(day)}
                    onChange={event =>
                      set(
                        {
                          hours: {
                            ...hours,
                            days: event.target.checked
                              ? [...hours.days, day].sort()
                              : hours.days.filter(d => d !== day),
                          },
                        },
                        true,
                      )
                    }
                  />{" "}
                  {t.dayNames[day]}
                </label>
              ))}
            </div>
            <div className="ally-home__times">
              <label>
                {t.from}{" "}
                <input
                  type="time"
                  className="ally-input"
                  value={hours.from}
                  onChange={event => set({ hours: { ...hours, from: event.target.value } }, true)}
                />
              </label>
              <label>
                {t.to}{" "}
                <input
                  type="time"
                  className="ally-input"
                  value={hours.to}
                  onChange={event => set({ hours: { ...hours, to: event.target.value } }, true)}
                />
              </label>
            </div>
          </>
        )}
      </fieldset>

      <div className="ally-home__numbers">
        <label className="ally-field">
          <span className="ally-field__label">{t.autoHandBack}</span>
          <input
            type="number"
            className="ally-input"
            min={1}
            max={72}
            value={value.autoHandBackHours}
            disabled={disabled}
            onChange={event => set({ autoHandBackHours: Number(event.target.value) })}
            onBlur={field.flush}
          />
        </label>
        <label className="ally-field">
          <span className="ally-field__label">{t.emailAfter}</span>
          <input
            type="number"
            className="ally-input"
            min={5}
            max={240}
            value={value.emailAfterMinutes}
            disabled={disabled}
            onChange={event => set({ emailAfterMinutes: Number(event.target.value) })}
            onBlur={field.flush}
          />
        </label>
      </div>

      <label className="ally-home__check">
        <input
          type="checkbox"
          checked={value.showFirstName}
          disabled={disabled}
          onChange={event => set({ showFirstName: event.target.checked }, true)}
        />{" "}
        {t.showFirstName}
      </label>

      {field.error && (
        <p className="ally-error" role="alert">
          {field.error}
        </p>
      )}
    </Group>
  );
};
