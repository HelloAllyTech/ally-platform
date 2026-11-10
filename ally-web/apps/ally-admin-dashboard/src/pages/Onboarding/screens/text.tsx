import React from "react";

/** "…turned on **Mental health safety**." → the pack name in bold, as the chat showed it. */
export const withBold = (text: string): React.ReactNode =>
  text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
