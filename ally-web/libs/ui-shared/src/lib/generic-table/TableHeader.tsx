"use client";

import React, { useState } from "react";

import { ArrowUp, ArrowDown, Filter, SortAscending } from "@carbon/icons-react";
import { Popover, PopoverContent } from "@carbon/react";

import FilterPopover from "./FilterPopover";
import HeaderTooltip from "./HeaderTooltip";
import { Column, SortDirection, TableFilter } from "./types";

/**
 * TableHeader renders the table's <thead> with sortable and filterable
 * columns. Sort state (which column's header was clicked, to drive the
 * Sort/Filter menu and the Sort popover) is local to this component. The
 * filter popover's state is NOT local — it's owned by GenericTable and
 * shared with its own "+ Filter"/chip entry point, so the two ways to open
 * a filter popover can never silently diverge (see GenericTable.tsx's
 * `openFilterForColumn`).
 *
 * @template T - The type of data for each row.
 */
const TableHeader = <T extends Record<string, any>>({
  columns,
  filter,
  onSort,
  selectedColumn,
  filterSource,
  searchText,
  onSearchTextChange,
  selectedValues,
  textValue,
  onTextChange,
  onOpenFilter,
  onCloseFilter,
  onToggleOption,
  onSaveMultiSelect,
  onSelectFilterOption,
  onDateSelect,
  onNumberSelect,
}: {
  columns: Column<T>[];
  filter: TableFilter;
  onSort: (key: string, value: SortDirection) => void;
  selectedColumn: (Column<T> & { filterOptions: { label: string; value: string }[] }) | null;
  filterSource: "header" | "chip" | null;
  searchText: string;
  onSearchTextChange: (text: string) => void;
  selectedValues: string[];
  textValue: string;
  onTextChange: (text: string) => void;
  onOpenFilter: (col: Column<T> | undefined, event: React.MouseEvent<HTMLElement>) => void;
  onCloseFilter: () => void;
  onToggleOption: (value: string) => void;
  onSaveMultiSelect: () => void;
  onSelectFilterOption: (colKey: string, value: string) => void;
  onDateSelect: (key: string, value: string[]) => void;
  onNumberSelect: (key: string, value: string[]) => void;
}) => {
  // Local state for the Sort/Filter mini-menu and the Sort popover — purely
  // "which column's header was clicked", unrelated to the shared filter
  // popover state above.
  const [mainAnchorEl, setMainAnchorEl] = useState<null | HTMLElement>(null);
  const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);
  const [activeCol, setActiveCol] = useState<null | Column<T>>(null);

  // Open main popover (Sort/Filter)
  const handleHeaderClick = (event: React.MouseEvent<HTMLElement>, col: Column<T>) => {
    if (col.sortable || col.filterable) {
      setSortAnchorEl(null);
      setMainAnchorEl(event.currentTarget);
      setActiveCol(col);
    }
  };

  // Open sort popover
  const handleSortClick = (event: React.MouseEvent<HTMLElement>) => {
    setSortAnchorEl(event.currentTarget);
  };

  // Open the shared filter popover for the active column
  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    onOpenFilter(activeCol ?? undefined, event);
  };

  // Close the Sort/Filter menu and Sort popover (the shared filter popover
  // closes via its own onCloseFilter prop, called directly where needed).
  const handleCloseAll = () => {
    setSortAnchorEl(null);
    setMainAnchorEl(null);
    setActiveCol(null);
  };

  // Handle sort selection
  const handleSortSelect = (value: SortDirection) => {
    if (activeCol) {
      onSort(activeCol.key as string, value);
    }
    handleCloseAll();
  };

  // Render filter popover content for the column currently open via the
  // header entry point.
  const renderFilterPopover = (col: Column<T>) => {
    if (selectedColumn?.key !== col.key || filterSource !== "header" || !col.filterable)
      return null;
    return (
      <FilterPopover
        open
        onClose={onCloseFilter}
        column={selectedColumn}
        searchText={searchText}
        onSearchTextChange={onSearchTextChange}
        selectedValues={selectedValues}
        onToggleOption={onToggleOption}
        onSaveMultiSelect={onSaveMultiSelect}
        onSelectSingle={onSelectFilterOption}
        onDateSelect={onDateSelect}
        onNumberSelect={onNumberSelect}
        textValue={textValue}
        onTextChange={onTextChange}
        singleSelectedValue={(() => {
          const found = filter.find(f => f.key === col.key);
          return typeof found?.value === "string" ? found.value : "";
        })()}
      />
    );
  };

  // Render sort popover content
  const renderSortPopover = () => (
    <Popover
      open={Boolean(sortAnchorEl)}
      onRequestClose={handleCloseAll}
      align="right-start"
      dropShadow={false}
      caret={false}
      className="font-['IBM_Plex_Serif']"
    >
      <span aria-hidden className="block h-0 w-0" />
      <PopoverContent className="border border-[#e3dbce]">
        <div>
          <div
            className="flex flex-row items-center cursor-pointer px-4 py-[14px] min-w-[200px] hover:bg-[#f0eee7] text-[#6e6656]"
            onClick={() => handleSortSelect("ASC")}
          >
            <ArrowUp size={16} className="mr-2" />
            <div>Ascending</div>
          </div>
          <div
            className="flex flex-row items-center cursor-pointer px-4 py-[14px] min-w-[200px] hover:bg-[#f0eee7] text-[#6e6656]"
            onClick={() => handleSortSelect("DESC")}
          >
            <ArrowDown size={16} className="mr-2" />
            <div>Descending</div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  const renderMainPopover = (col: Column<T>) => {
    return (
      <Popover
        open={Boolean(mainAnchorEl) && activeCol?.key === col.key}
        onRequestClose={handleCloseAll}
        align="bottom-start"
        dropShadow={false}
        caret={false}
        className="font-['IBM_Plex_Serif']"
      >
        <span aria-hidden className="block h-0 w-0" />
        <PopoverContent className="border border-[#e3dbce] font-['IBM_Plex_Serif']">
          <div>
            {col.sortable && (
              <div
                className="flex flex-row items-center cursor-pointer px-4 py-[14px] min-w-[200px] hover:bg-[#f0eee7] text-[#6e6656]"
                onClick={handleSortClick}
              >
                <SortAscending size={16} className="mr-2" />
                <div>Sort</div>
              </div>
            )}
            {col.filterable && (
              <div
                className="text-[#6e6656] flex flex-row items-center cursor-pointer px-4 py-[14px] min-w-[200px] hover:bg-[#f0eee7]"
                onClick={handleFilterClick}
              >
                <Filter size={16} className="mr-2" />
                <div>Filter</div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <thead>
      <tr className="bg-[#FFF] sticky top-0 border-b border-gray-300 z-10">
        {columns
          ?.filter(col => !col.hidden)
          .map(col => (
            <th
              key={col.key as string}
              className={`text-left font-[500] text-[#000] min-w-[100px] ${col.className || ""}`}
              style={col.style}
            >
              {col.headerNode ? (
                <div className="px-4 py-[14px] flex items-center justify-center">
                  {col.headerNode}
                </div>
              ) : (
                <div
                  className={`px-4 py-[14px] flex flex-row items-center justify-between ${
                    (col.filterable || col.sortable) && "cursor-pointer"
                  }`}
                  onClick={e => handleHeaderClick(e, col)}
                >
                  <div className="flex flex-row items-center">
                    {col?.icon && <div className="pr-[8px]">{col?.icon}</div>}
                    <div className="font-[500] text-[#6e6656]">{col.header}</div>
                    {col.tooltip && <HeaderTooltip text={col.tooltip} />}
                  </div>
                </div>
              )}
              {renderMainPopover(col)}
              {activeCol?.key === col.key && renderSortPopover()}
              {renderFilterPopover(col)}
            </th>
          ))}
      </tr>
    </thead>
  );
};

export default TableHeader;
