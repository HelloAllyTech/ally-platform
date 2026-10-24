/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";

/**
 * Light stand-ins for the `@ally-ui-mono/ui-shared` primitives the Ally Console uses.
 *
 * Carbon's modal, switcher and side panel need real layout and focus handling that jsdom does not
 * provide, and the admin's other suites stub them the same way. These keep the behaviour the
 * console relies on (a closed modal renders nothing; a toggle reports `checked`; a content switcher
 * reports the chosen `name`) and drop everything else.
 *
 * Used as `vi.mock("@ally-ui-mono/ui-shared", async () => (await import("…/uiSharedFakes")).uiSharedFakes)`.
 */

const passthrough =
  (tag: keyof React.JSX.IntrinsicElements) =>
  ({ children, className, onClick, ...rest }: any) =>
    React.createElement(
      tag,
      {
        className,
        onClick,
        "data-testid": rest["data-testid"],
        title: rest.title,
        "aria-label": rest["aria-label"],
      },
      children,
    );

export const uiSharedFakes = {
  Button: ({ children, onClick, disabled, className, ...rest }: any) => (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={rest["aria-expanded"]}
    >
      {children}
    </button>
  ),
  IconButton: ({ label, onClick, children }: any) => (
    <button type="button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  ),
  ComposedModal: ({ open, children, ...rest }: any) =>
    open ? (
      <div role="dialog" aria-label={rest["aria-label"]}>
        {children}
      </div>
    ) : null,
  ModalBody: ({ children }: any) => <div>{children}</div>,
  Checkbox: ({ id, labelText, checked, disabled, onChange }: any) => (
    <label htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={event => onChange?.(event, { checked: event.target.checked, id })}
      />
      {labelText}
    </label>
  ),
  CarbonToggle: ({ id, labelText, toggled, disabled, onToggle }: any) => (
    <label htmlFor={id}>
      {labelText}
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={Boolean(toggled)}
        disabled={disabled}
        onChange={event => onToggle?.(event.target.checked)}
      />
    </label>
  ),
  TextArea: ({
    id,
    labelText,
    value,
    placeholder,
    disabled,
    onChange,
    helperText,
    invalid,
    invalidText,
  }: any) => (
    <div>
      <label htmlFor={id}>{labelText}</label>
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid ? "true" : undefined}
        onChange={onChange}
      />
      {helperText && <p>{helperText}</p>}
      {invalid && invalidText && <p role="alert">{invalidText}</p>}
    </div>
  ),
  TextInput: ({
    id,
    labelText,
    value,
    placeholder,
    disabled,
    onChange,
    onKeyDown,
    invalid,
    invalidText,
    maxLength,
  }: any) => (
    <div>
      <label htmlFor={id}>{labelText}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={invalid ? "true" : undefined}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      {invalid && invalidText && <p role="alert">{invalidText}</p>}
    </div>
  ),
  Search: ({ labelText, placeholder, value, onChange }: any) => (
    <input
      type="search"
      aria-label={labelText}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
  ),
  Select: ({ id, labelText, value, disabled, onChange, children }: any) => (
    <div>
      <label htmlFor={id}>{labelText}</label>
      <select id={id} value={value} disabled={disabled} onChange={onChange}>
        {children}
      </select>
    </div>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  ContentSwitcher: ({ children, selectedIndex, onChange, ...rest }: any) => (
    <div role="group" aria-label={rest["aria-label"]}>
      {React.Children.map(children, (child: any, index: number) =>
        React.cloneElement(child, {
          selected: index === selectedIndex,
          onClick: () => onChange?.({ name: child.props.name, index }),
        }),
      )}
    </div>
  ),
  Switch: ({ text, selected, onClick }: any) => (
    <button type="button" aria-pressed={Boolean(selected)} onClick={onClick}>
      {text}
    </button>
  ),
  InlineNotification: ({ title, subtitle, ...rest }: any) => (
    <div role="status" data-testid={rest["data-testid"]}>
      <strong>{title}</strong>
      {subtitle && <span>{subtitle}</span>}
    </div>
  ),
  SkeletonText: () => <div data-testid="skeleton" />,
  SkeletonPlaceholder: () => <div data-testid="skeleton" />,
  Tile: passthrough("div"),
  Table: passthrough("table"),
  TableHead: passthrough("thead"),
  TableBody: passthrough("tbody"),
  TableRow: passthrough("tr"),
  TableHeader: passthrough("th"),
  TableCell: passthrough("td"),
  Tooltip: ({ children, label }: any) => <span data-tooltip={label}>{children}</span>,
  SidePanel: ({ open, title, onClose, closeLabel, children }: any) =>
    open ? (
      <aside role="dialog" aria-label="Side panel">
        <div>{title}</div>
        <button type="button" aria-label={closeLabel ?? "Close"} onClick={onClose} />
        {children}
      </aside>
    ) : null,
  Tabs: ({ items, activeId, onChange }: any) => (
    <nav>
      {items.map((item: any) => (
        <button
          key={item.id}
          type="button"
          data-testid={`tab-${item.id}`}
          aria-pressed={item.id === activeId}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  ),
  InlineLoading: ({ description }: any) => <span>{description}</span>,
};
