"use client";

import { FC } from "react";

import { ButtonGroupProps } from "./types";

const ButtonGroup: FC<ButtonGroupProps> = ({ buttonList }) => (
  <div className="flex w-fit rounded-button-group bg-button-group-bg overflow-hidden">
    {buttonList
      .filter(button => button.show)
      .map(({ action, isActive, isDisabled, leftIcon, text, className }, buttonIndex) => {
        const isLastButton = buttonIndex === buttonList.length - 1;

        return (
          <button
            key={text}
            type="button"
            onClick={action}
            disabled={isDisabled}
            aria-pressed={isActive}
            aria-disabled={isDisabled}
            className={`w-[44px] sm:w-[120px] md:w-[140px] lg:w-[196px] h-[48px] sm:h-[56px] flex items-center justify-center px-2 sm:px-4 py-3 rounded-none leading-[16px] text-wrap focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed ${isActive ? "!bg-button-group-active-bg" : ""}
              ${isLastButton ? "" : "!border-solid border-r-[0.5px] border-button-group-divider"} ${className}`}
          >
            {leftIcon}
            <span
              className={`hidden sm:block text-[12px] ml-2 ${isActive ? "text-button-group-active-fg" : "text-[#fff]"}`}
            >
              {text}
            </span>
          </button>
        );
      })}
  </div>
);

export default ButtonGroup;
