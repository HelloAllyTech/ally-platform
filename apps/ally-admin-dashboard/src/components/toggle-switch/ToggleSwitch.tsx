export const ToggleSwitch: React.FC<{
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label?: string;
  switchStyles?: React.CSSProperties;
  disabled?: boolean;
}> = ({ enabled, onChange, label, switchStyles, disabled = false }) => (
  <button
    type="button"
    onClick={() => {
      if (!disabled) onChange(!enabled);
    }}
    disabled={disabled}
    // Carbon toggle: 48×24 track, gray-50 off / green-50 on, 18px handle inset 3px,
    // brand focus ring. aria-pressed carries the on/off state to assistive tech.
    className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-500 ${
      enabled ? "bg-success" : "bg-neutral-400"
    } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    aria-label={label ?? "Toggle"}
    aria-pressed={enabled}
  >
    <span
      className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform ${
        enabled ? "translate-x-[27px]" : "translate-x-[3px]"
      }`}
      style={switchStyles}
    />
  </button>
);
