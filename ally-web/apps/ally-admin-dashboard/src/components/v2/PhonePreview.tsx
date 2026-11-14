import React from "react";

/**
 * A phone frame (DESIGN.md §4: 300 × 560–600) around a live preview of the bot page. The page
 * inside is the real bot page components, drawn with the current settings; it is decorative to
 * assistive technology (the controls beside it say what changed), so `label` names it.
 */
export const PhonePreview: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <figure className="ally-phone" aria-label={label} style={{ margin: 0 }}>
    <div className="ally-phone__screen" data-testid="phone-preview">
      {children}
    </div>
  </figure>
);
