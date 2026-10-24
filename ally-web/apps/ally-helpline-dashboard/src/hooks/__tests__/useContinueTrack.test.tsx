import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigate, getNextTrackItem } = vi.hoisted(() => ({
  navigate: vi.fn(),
  getNextTrackItem: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@api", () => ({ useLazyGetNextTrackItemQuery: () => [getNextTrackItem] }));

import { useContinueTrack } from "../useContinueTrack";

const KEY = "activeTrackContext";

describe("useContinueTrack", () => {
  beforeEach(() => {
    navigate.mockReset();
    getNextTrackItem.mockReset();
    sessionStorage.setItem(KEY, "{}");
  });

  it("classic (unchanged): opens the next unlocked item", async () => {
    getNextTrackItem.mockReturnValue({
      unwrap: () => Promise.resolve({ trackCompleted: false, nextItem: { id: "item-2" } }),
    });
    const { result } = renderHook(() => useContinueTrack({ trackId: "t1", itemId: "item-1" }));
    await act(() => result.current());
    expect(getNextTrackItem).toHaveBeenCalledWith({ trackId: "t1" });
    expect(navigate).toHaveBeenCalledWith("/track/t1/item/item-2");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("classic (unchanged): back to the course page when it is complete or the lookup fails", async () => {
    getNextTrackItem.mockReturnValue({
      unwrap: () => Promise.resolve({ trackCompleted: true, nextItem: null }),
    });
    const { result } = renderHook(() => useContinueTrack({ trackId: "t1", itemId: "item-1" }));
    await act(() => result.current());
    expect(navigate).toHaveBeenLastCalledWith("/track/t1");

    getNextTrackItem.mockReturnValue({ unwrap: () => Promise.reject(new Error("offline")) });
    await act(() => result.current());
    expect(navigate).toHaveBeenLastCalledWith("/track/t1");
  });

  it("guided: returns to Ally's journey with the card it launched, without asking for the next item", async () => {
    const { result } = renderHook(() =>
      useContinueTrack({
        trackId: "t1",
        itemId: "item-1",
        returnTo: "guided",
        threadId: "th1",
        cardId: "card-9",
      }),
    );
    await act(() => result.current());
    expect(getNextTrackItem).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/journey/t1?returned=card-9");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("does nothing without a context", async () => {
    const { result } = renderHook(() => useContinueTrack(null));
    await act(() => result.current());
    expect(navigate).not.toHaveBeenCalled();
  });
});
