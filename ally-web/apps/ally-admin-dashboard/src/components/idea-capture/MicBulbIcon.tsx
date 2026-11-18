import React from "react";

interface MicBulbIconProps {
  size?: number;
  className?: string;
}

/**
 * A microphone sitting inside a light bulb: "say the idea". Inline SVG rather than a Material
 * Symbol because no single symbol is both, and a new symbol name would also have to be added to
 * index.html's `icon_names` subset or it renders as literal text. Stroked in `currentColor` so it
 * takes the surrounding hover colour like its siblings.
 */
export const MicBulbIcon: React.FC<MicBulbIconProps> = ({ size = 20, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {/* the bulb */}
    <path d="M8.2 17.2c0-1.5-2.7-2.6-2.7-6.2a6.5 6.5 0 1 1 13 0c0 3.6-2.7 4.7-2.7 6.2" />
    <path d="M9.2 20h5.6M10.2 22h3.6" />
    {/* the mic */}
    <rect x="10.4" y="5.6" width="3.2" height="5.4" rx="1.6" />
    <path d="M8.9 10.2a3.1 3.1 0 0 0 6.2 0M12 13.3v1.4" />
  </svg>
);
