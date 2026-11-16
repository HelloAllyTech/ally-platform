import { ButtonProps, ButtonVariant } from "../types";

// Kept apart from utils/common so the button pulls in nothing heavy (utils drags in the store).
// Maps button variants to IBM Carbon button "kinds": Primary (Blue 60),
// Secondary (Gray 80 fill), Danger (Red 60), and Ghost (transparent).
export const getButtonStyles = (variant: ButtonProps["variant"]) => {
  switch (variant) {
    case ButtonVariant.DESTRUCTIVE:
      return "bg-destructive text-white hover:bg-destructive-600 active:bg-destructive-700 disabled:bg-neutral-300 disabled:text-neutral-500";
    case ButtonVariant.SECONDARY:
      return "bg-secondary-700 text-white hover:bg-secondary-800 active:bg-secondary-900 disabled:bg-neutral-300 disabled:text-neutral-500";
    case ButtonVariant.TERTIARY:
      return "bg-transparent border border-primary-500 text-primary-500 hover:bg-primary-500 hover:text-white active:bg-primary-700 active:text-white disabled:bg-transparent disabled:border-neutral-300 disabled:text-neutral-500";
    case ButtonVariant.ICON:
      return "bg-transparent border-none text-typography-900 hover:bg-secondary-50 disabled:bg-transparent !p-2 !h-fit";
    case ButtonVariant.TEXT:
      return "bg-transparent border-none text-primary-500 hover:bg-secondary-50 disabled:bg-transparent";
    case ButtonVariant.PRIMARY:
    default:
      return "text-white bg-primary-500 hover:bg-primary-600 active:bg-primary-700 disabled:bg-neutral-300 disabled:text-neutral-500";
  }
};
