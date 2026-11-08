import React from "react";

/**
 * The orb (DESIGN.md §4): the one signature element. A breathing accent sphere beside every
 * assistant line, and while reading, building or checking. Decorative: the text beside it speaks.
 */
export const Orb: React.FC<{ size?: number; working?: boolean; className?: string }> = ({
  size = 28,
  working = false,
  className = "",
}) => (
  <span
    aria-hidden="true"
    data-working={working}
    className={`ally-orb ally-breathe ${className}`}
    style={{ width: size, height: size }}
  />
);
