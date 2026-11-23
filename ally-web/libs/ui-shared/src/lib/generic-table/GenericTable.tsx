"use client";

import React, {
  useState,
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useMemo,
} from "react";

import { Popover, PopoverContent, Loading } from "@carbon/react";
import { Plus } from "lucide-react";

import FilterPopover from "./FilterPopover";
import SelectedFiltersView from "./SelectedFiltersView";
import TableBody from "./TableBody";
import TableHeader from "./TableHeader";
import { GenericTableProps, TableSort, TableFilter, Column, SortDirection } from "./types";

/**
 * GenericTable is a reusable, type-safe, and highly customizable table component.
 * Supports sorting, filtering, and row click handling.
 * Only supports external control of sort and filter logic for server-side data fetching.
 *
 * @template T - The type of data for each row.
 * @param {GenericTableProps<T>} props - The props for the table.
 * @param {React.Ref<HTMLDivElement | null>} ref - Forwarded ref to the scrollable div.
 */
export const GenericTable = forwardRef(
  <T extends Record<string, any>>(
    {
      columns,
      data,
      initialSort,
      initialFilter,
      onRowClick,
      className = "",
      style = {},
      fallbackUI,
      isLoading,
      showSelectedFilters = false,
      onFilterChange,
      handleLoadMore,
      loadMoreLabel = "Load More",
    }: GenericTableProps<T>,
    ref: React.Ref<HTMLDivElement | null>,
  ) => {
    // Internal state for sort and filter (if not controlled externally)
    const [sort, setSort] = useState<TableSort>(initialSort || { key: "", value: null });
    const [filter, setFilter] = useState<TableFilter>(initialFilter || []);

    // State for the "+ Filter" column-name list popover (which column to add
    // a filter for) — separate from the filter popover below.
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);

    // Single source of truth for "which column's filter popover is open and
    // what's in it", shared by both ways a filter popover can be opened:
    // clicking a column header (TableHeader renders its own instance inside
    // that header's <th>, for correct anchoring) and clicking the "+ Filter"
    // chip or an already-applied filter chip (GenericTable renders its own
    // instance at the table level). Previously each of those two entry
    // points kept an entirely independent copy of this state with its own
    // handler functions — bugs (e.g. TEXT blanking out on reopen) had to be
    // found and fixed twice because the two copies could silently diverge.
    // `filterSource` decides which of the two JSX render sites actually
    // shows the popover's content, since both would otherwise become `open`
    // together whenever a column is selected.
    const [selectedColumn, setSelectedColumn] = useState<
      null | (Column<T> & { filterOptions: { label: string; value: string }[] })
    >(null);
    const [filterSource, setFilterSource] = useState<"header" | "chip" | null>(null);
    const [searchText, setSearchText] = useState("");
    const [multiSelectValues, setMultiSelectValues] = useState<string[]>([]);
    // TEXT filter type's own draft/committed value — kept separate from
    // `searchText` (which only ever filters a MULTISELECT/SINGLESELECT
    // option list now), so applying a TEXT filter can never be confused
    // with, or accidentally cleared by, option-list search state.
    const [textDraft, setTextDraft] = useState("");

    // Expose the scrollable div to the parent via the forwarded ref
    const scrollRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => scrollRef.current, []);

    // Memoize filterable columns for performance
    const filterableColumns = useMemo(() => columns.filter(c => c.filterable), [columns]);

    // Column widths are caller-supplied percentages with no floor, so on
    // narrow viewports columns are squeezed illegibly instead of the table
    // scrolling. Give the table a real px min-width (one column's worth of
    // breathing room each) so percentages have something concrete to divide
    // up, and horizontal scroll — not squeeze — is what kicks in below that.
    const MIN_COLUMN_WIDTH_PX = 140;
    const tableMinWidthPx = useMemo(
      () => columns.filter(c => !c.hidden).length * MIN_COLUMN_WIDTH_PX,
      [columns],
    );

    /**
     * Opens the "+ Filter" column-name list popover.
     * @param {React.MouseEvent<HTMLElement>} event
     */
    const handleOpenFilterPopover = (event: React.MouseEvent<HTMLElement>) => {
      // Stop the opening click before Carbon Popover's window-level
      // outside-click listener sees it and closes the popover as it opens
      // (the trigger lives outside the Popover subtree).
      event.stopPropagation();
      setFilterAnchorEl(event.currentTarget);
      setSelectedColumn(null);
      setFilterSource(null);
      setSearchText("");
    };

    /**
     * Opens the filter popover for a column, seeding its draft state from
     * whatever filter is already applied so reopening shows what's active
     * instead of a blank slate. The single function both entry points call:
     * `source` is "chip" for the "+ Filter" list / an already-applied
     * filter's chip (called directly below), and "header" for a column
     * header's Filter menu item (called via the `onOpenFilter` prop passed
     * to TableHeader).
     * @param {Column<T> | undefined} col
     * @param {React.MouseEvent<HTMLElement>} event
     * @param {"header" | "chip"} source
     */
    const openFilterForColumn = (
      col: Column<T> | undefined,
      event: React.MouseEvent<HTMLElement>,
      source: "header" | "chip",
    ) => {
      if (!col || !col.filterable) return;
      // See handleOpenFilterPopover; also close the column list or its
      // outside-click listener would close the options popover on the next click.
      event.stopPropagation();
      setFilterAnchorEl(null);
      setSelectedColumn(col as Column<T> & { filterOptions: { label: string; value: string }[] });
      setFilterSource(source);
      const existing = filter.find(f => f.key === col.key);
      if (col.filterType === "text") {
        // TEXT has its own dedicated draft, not the option-list search box,
        // so reopening it restores what's already applied instead of a
        // blank box whose Apply click would otherwise silently clear it.
        setTextDraft(typeof existing?.value === "string" ? existing.value : "");
        setMultiSelectValues([]);
        setSearchText("");
      } else {
        // MULTISELECT's staging array, NUMBER's initial [min, max], and
        // DATE's initial [isoStart, isoEnd] all seed from the same
        // already-applied array value.
        setMultiSelectValues(Array.isArray(existing?.value) ? existing.value : []);
        setSearchText("");
        setTextDraft("");
      }
    };

    /**
     * Selects a column from the "+ Filter" list, or an already-applied
     * filter's chip, and opens its filter popover.
     * @param {Column<T> | undefined} col
     * @param {React.MouseEvent<HTMLElement>} event
     */
    const handleSelectColumn = (col: Column<T> | undefined, event: React.MouseEvent<HTMLElement>) =>
      openFilterForColumn(col, event, "chip");

    /**
     * Closes all filter and option popovers.
     */
    const handleCloseFilterPopover = () => {
      setFilterAnchorEl(null);
      setSelectedColumn(null);
      setFilterSource(null);
      setSearchText("");
      setMultiSelectValues([]);
      setTextDraft("");
    };

    /**
     * Selects a filter option (single select or TEXT's Apply button).
     * @param {string} colKey
     * @param {string} value
     */
    const handleSelectFilterOption = (colKey: string, value: string) => {
      handleFilterChange(colKey, value);
      handleCloseFilterPopover();
    };

    /**
     * Toggles a multi-select filter option.
     * @param {string} value
     */
    const handleToggleMultiSelectOption = (value: string) => {
      setMultiSelectValues(prev =>
        prev?.includes(value) ? prev?.filter(v => v !== value) : [...prev, value],
      );
    };

    /**
     * Saves the selected multi-select filter values.
     */
    const handleSaveMultiSelect = () => {
      if (selectedColumn) {
        handleFilterChange(selectedColumn.key as string, multiSelectValues);
      }
      handleCloseFilterPopover();
    };

    // Notify parent of filter/sort changes
    useEffect(() => {
      onFilterChange?.({ filter, sort });
    }, [filter, sort]);

    /**
     * Handles date filter selection.
     * @param {string} key
     * @param {string[]} value
     */
    const handleDateSelect = (key: string, value: string[]) => {
      if (key && value) {
        handleFilterChange(key, value);
      }
      handleCloseFilterPopover();
    };

    const handleNumberSelect = (key: string, value: string[]) => {
      if (key) {
        // Both bounds empty → treat as clearing the filter.
        const hasBound = value.some(v => v && v.trim() !== "");
        handleFilterChange(key, hasBound ? value : []);
      }
      handleCloseFilterPopover();
    };

    /**
     * Handles sort changes. Cycles through ASC, DESC, and none.
     * @param {string} key - The column key to sort by.
     * @param {string} value - The sort direction.
     */
    const handleSort = (key: string, value: SortDirection) => {
      setSort({ key, value });
    };

    /**
     * Handles filter changes. Updates or removes filters as needed.
     * @param {string} key - The column key to filter by.
     * @param {string | string[]} value - The filter value(s).
     */
    const handleFilterChange = (key: string, value: string | string[]) => {
      setFilter((prev: TableFilter) => {
        if (!value || (Array.isArray(value) && value.length === 0))
          return prev.filter(f => f.key !== key);
        const existing = prev.find(f => f.key === key);
        if (existing) {
          return prev.map(f => (f.key === key ? { key, value } : f));
        }
        return [...prev, { key, value }];
      });
    };

    /**
     * Renders the filter popover UIs.
     * @returns {JSX.Element}
     */
    const renderPopovers = () => (
      <>
        <Popover
          open={Boolean(filterAnchorEl)}
          onRequestClose={handleCloseFilterPopover}
          align="bottom-start"
          dropShadow={false}
          caret={false}
          className="font-['IBM_Plex_Serif'] z-50"
        >
          <span aria-hidden className="block h-0 w-0" />
          <PopoverContent className="border border-[#e3dbce] mt-[2px]">
            {/* A table with many filterable columns (custom fields included)
                had no scroll container here at all, unlike the option lists
                below — the list just grew past the viewport, so scrolling it
                scrolled the whole page behind it instead of just the list. */}
            <div className="max-h-[300px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              {filterableColumns.map(col => (
                <div
                  key={col.key as string}
                  className="flex flex-row items-center cursor-pointer px-4 py-[14px] min-w-[200px] hover:bg-[#f0eee7] text-[#6e6656]"
                  onClick={e => handleSelectColumn(col, e)}
                >
                  <div>{col.header}</div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {/* Shared FilterPopover for the "+ Filter"/chip entry point — only
            shown when that's where the open column was selected from, so
            this and TableHeader's own instance (for the header entry point)
            never both render content for the same column at once. */}
        <FilterPopover
          open={Boolean(selectedColumn) && filterSource === "chip"}
          onClose={handleCloseFilterPopover}
          column={selectedColumn}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          selectedValues={multiSelectValues}
          onToggleOption={handleToggleMultiSelectOption}
          onSaveMultiSelect={handleSaveMultiSelect}
          onSelectSingle={handleSelectFilterOption}
          singleSelectedValue={
            selectedColumn
              ? (() => {
                  const found = filter.find(f => f.key === selectedColumn.key);
                  return typeof found?.value === "string" ? found.value : "";
                })()
              : ""
          }
          onDateSelect={handleDateSelect}
          onNumberSelect={handleNumberSelect}
          textValue={textDraft}
          onTextChange={setTextDraft}
        />
      </>
    );

    return (
      <div
        ref={scrollRef}
        className={`overflow-x-auto min-w-full custom-scrollbar ${className}`}
        style={style}
      >
        {/* Display selected sort and filter options */}
        {showSelectedFilters && (
          <SelectedFiltersView
            columns={columns}
            sort={sort}
            filter={filter}
            openFilterList={handleSelectColumn}
            onAddFilter={handleOpenFilterPopover}
            onRemoveSort={() => setSort({ key: "", value: null })}
            onRemoveFilter={(key: string) => setFilter(prev => prev.filter(f => f.key !== key))}
          />
        )}
        {renderPopovers()}
        <table className="w-full" style={{ minWidth: `${tableMinWidthPx}px` }}>
          <TableHeader
            columns={columns}
            filter={filter}
            onSort={handleSort}
            selectedColumn={selectedColumn}
            filterSource={filterSource}
            searchText={searchText}
            onSearchTextChange={setSearchText}
            selectedValues={multiSelectValues}
            textValue={textDraft}
            onTextChange={setTextDraft}
            onOpenFilter={(col, event) => openFilterForColumn(col, event, "header")}
            onCloseFilter={handleCloseFilterPopover}
            onToggleOption={handleToggleMultiSelectOption}
            onSaveMultiSelect={handleSaveMultiSelect}
            onSelectFilterOption={handleSelectFilterOption}
            onDateSelect={handleDateSelect}
            onNumberSelect={handleNumberSelect}
          />
          {
            <TableBody
              columns={columns}
              data={data}
              onRowClick={onRowClick}
              fallbackUI={fallbackUI}
            />
          }
        </table>
        {handleLoadMore && (
          <div
            onClick={isLoading ? undefined : handleLoadMore}
            className={`flex mt-4 text-center items-center pb-[60px] ${
              isLoading ? "cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <Plus size={20} />
            <span className="font-['IBM_Plex_Serif'] text-[16px] ml-[5px]">{loadMoreLabel}</span>
            {isLoading && <Loading withOverlay={false} small className="ml-2 mr-2" />}
          </div>
        )}
      </div>
    );
  },
);

export default GenericTable;
