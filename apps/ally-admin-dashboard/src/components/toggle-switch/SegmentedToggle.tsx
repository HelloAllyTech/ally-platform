export interface SegmentedToggleOption<T extends string = string> {
  label: string;
  value: T;
}

interface SegmentedToggleProps<T extends string = string> {
  value: T;
  options: readonly SegmentedToggleOption<T>[];
  onChange: (value: T) => void;
  label?: string;
}

export const SegmentedToggle = <T extends string = string>({
  value,
  options,
  onChange,
  label = "Segmented toggle",
}: SegmentedToggleProps<T>) => {
  return (
    <div
      // Carbon content switcher: square segments in one bordered strip; the selected
      // segment is inverse (text-primary ground, white label), labels stay Regular.
      className="inline-flex items-stretch border border-typography-900 bg-white"
      role="tablist"
      aria-label={label}
    >
      {options.map(option => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isSelected}
            className={`h-8 px-4 text-sm font-normal transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500 ${
              isSelected
                ? "bg-typography-900 text-white"
                : "text-typography-700 hover:bg-gray-100 hover:text-typography-900"
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
