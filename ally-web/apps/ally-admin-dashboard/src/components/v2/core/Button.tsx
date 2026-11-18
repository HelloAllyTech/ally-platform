import React from "react";

/** Mono key cap: "A", "Enter ↵". */
export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="ally-kbd">{children}</kbd>
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

/** A v2 button. `primary` is the screen's one main action (ink, or the brand colour on visitor pages). */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", className = "", type = "button", ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`ally-btn ally-btn--${variant} ally-press ${className}`}
      {...rest}
    />
  ),
);
Button.displayName = "Button";

/**
 * The screen's primary action, with the "press Enter ↵" hint beside it on desktop. The hint is a
 * reminder only: Enter itself is bound by the screen (`useEnterToSubmit`) or a form.
 */
export const PrimaryButton = React.forwardRef<
  HTMLButtonElement,
  ButtonProps & { enterHint?: string }
>(({ enterHint, children, ...rest }, ref) => (
  <div className="ally-btn-row">
    <Button ref={ref} variant="primary" {...rest}>
      {children}
    </Button>
    {enterHint && !rest.disabled && (
      <span className="ally-enter-hint" aria-hidden="true">
        {enterHint}
      </span>
    )}
  </div>
));
PrimaryButton.displayName = "PrimaryButton";
