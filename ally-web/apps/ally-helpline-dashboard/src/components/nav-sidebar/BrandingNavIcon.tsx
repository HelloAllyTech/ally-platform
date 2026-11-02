import type { SVGProps } from "react";

/**
 * Nav icon for the org admin's Branding page: a painter's palette.
 *
 * Dependency-free (no @assets, no lucide-react) for the same reason as
 * HelplineNavIcon: `constants/routes.ts` imports it, and many tests mock
 * @assets or lucide-react with an explicit object that would not list it.
 */
const BrandingNavIcon = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={`text-typography-900 ${className ?? ""}`}
    {...props}
  >
    <path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a1.5 1.5 0 0 1 0-3h4.5A4.5 4.5 0 0 0 21 8.5 7.5 7.5 0 0 0 12 3z" />
    <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
    <circle cx="10.5" cy="7" r="1" fill="currentColor" />
    <circle cx="15" cy="7" r="1" fill="currentColor" />
  </svg>
);

export default BrandingNavIcon;
