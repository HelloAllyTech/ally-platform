import { useCallback, useMemo, useState } from "react";

/** Row selection by id. Call `clear()` when the filters/search/page change. */
export const useRowSelection = <T extends string | number>(allIds: T[] = []) => {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const toggle = useCallback((id: T) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }, [allSelected, allIds]);

  return useMemo(
    () => ({
      selected,
      selectedIds: Array.from(selected),
      count: selected.size,
      isSelected: (id: T) => selected.has(id),
      toggle,
      toggleAll,
      clear,
      allSelected,
      someSelected,
    }),
    [selected, toggle, toggleAll, clear, allSelected, someSelected],
  );
};
