import React, { useEffect, useState } from "react";

import { Select, SelectItem, TextInput } from "@ally-ui-mono/ui-shared";
import { useGetTracksQuery } from "@api";
import { en } from "@constants";

const PAGE = 50;

export interface PickedCourse {
  id: string;
  title: string;
}

interface CoursePickerProps {
  value: PickedCourse | null;
  onChange: (course: PickedCourse | null) => void;
  /** Distinguishes two pickers on one page. */
  idPrefix?: string;
}

/**
 * Search for a course by title, then choose it. The search is sent to the server (debounced) rather
 * than filtering a fixed page, so a course beyond the first page is never silently missing; the
 * chosen course stays in the list while the search changes.
 */
export const CoursePicker: React.FC<CoursePickerProps> = ({
  value,
  onChange,
  idPrefix = "ally-course",
}) => {
  const strings = en.allyConsole.playground.course;
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError } = useGetTracksQuery({
    limit: PAGE,
    ...(debounced ? { search: debounced } : {}),
  });
  const tracks = data?.data ?? [];
  const options =
    value && !tracks.some(track => track.id === value.id) ? [value, ...tracks] : tracks;

  return (
    <div className="flex flex-col gap-2">
      <TextInput
        id={`${idPrefix}-search`}
        labelText={strings.searchLabel}
        placeholder={strings.searchPlaceholder}
        value={search}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
      />
      <Select
        id={`${idPrefix}-select`}
        labelText={strings.choose}
        value={value?.id ?? ""}
        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
          const picked = options.find(option => option.id === event.target.value);
          onChange(picked ? { id: picked.id, title: picked.title } : null);
        }}
      >
        <SelectItem value="" text={strings.choose} />
        {options.map(option => (
          <SelectItem key={option.id} value={option.id} text={option.title} />
        ))}
      </Select>
      {isLoading && <p className="text-xs text-typography-700">{strings.loading}</p>}
      {isError && (
        <p className="text-xs text-destructive-600" role="alert">
          {strings.failed}
        </p>
      )}
      {!isLoading && !isError && tracks.length === 0 && (
        <p className="text-xs text-typography-700">{strings.noMatches}</p>
      )}
      {typeof data?.count === "number" && data.count > tracks.length && (
        <p className="text-xs text-typography-700">{strings.shownOf(tracks.length, data.count)}</p>
      )}
    </div>
  );
};
