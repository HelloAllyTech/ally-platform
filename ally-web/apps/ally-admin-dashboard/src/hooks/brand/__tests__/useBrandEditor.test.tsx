import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRAND_SAVE_DEBOUNCE_MS, useBrandEditor } from "../useBrandEditor";

const brand = {
  logo: "img-logo",
  accent: "#C4512D",
  accentContrast: "#B5431F",
  headingStyle: "classic",
  theme: "light",
  coverImage: null,
  shareImage: null,
  landingImages: { hero: null, gallery: [] },
  peoplePhotos: {},
};
const logo = {
  id: "img-logo",
  kind: "logo",
  alt: "",
  fileName: "logo.png",
  width: 256,
  height: 256,
  status: "attached",
  urls: { 256: "s256", 768: "s768", 1600: "s1600" },
};

const saveBrand = vi.fn();
const uploadImage = vi.fn();
const removeImage = vi.fn();
const restoreImage = vi.fn();
const unwrap = <T,>(value: T) => ({ unwrap: () => Promise.resolve(value) });

vi.mock("@api", () => ({
  useGetBotPageQuery: () => ({ data: { settings: { brand } } }),
  useGetBotImagesQuery: () => ({ data: [logo] }),
  useUpdateBotPageBrandMutation: () => [saveBrand],
  useUploadBotImageMutation: () => [uploadImage],
  useRemoveBotImageMutation: () => [removeImage],
  useRestoreBotImageMutation: () => [restoreImage],
}));

describe("useBrandEditor (chunk 20d: saves as you go, with Undo)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveBrand.mockReset().mockImplementation(() => unwrap({}));
    uploadImage.mockReset();
    removeImage.mockReset().mockImplementation(() => unwrap(undefined));
    restoreImage.mockReset().mockImplementation(() => unwrap(logo));
  });
  afterEach(() => vi.useRealTimers());

  it("shows a change at once and saves a run of changes once, after a pause", () => {
    const { result } = renderHook(() => useBrandEditor("bot-1", "failed"));
    act(() => result.current.change({ accent: "#3B3BD9" }));
    act(() => result.current.change({ headingStyle: "modern" }));
    expect(result.current.brand).toMatchObject({ accent: "#3B3BD9", headingStyle: "modern" });
    expect(result.current.saved).toBe(false);
    expect(saveBrand).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(BRAND_SAVE_DEBOUNCE_MS));
    expect(saveBrand).toHaveBeenCalledTimes(1);
    expect(saveBrand).toHaveBeenCalledWith({
      id: "bot-1",
      accent: "#3B3BD9",
      headingStyle: "modern",
    });
  });

  it("Undo puts back the brand from before the last change", () => {
    const { result } = renderHook(() => useBrandEditor("bot-1", "failed"));
    act(() => result.current.change({ accent: "#3B3BD9" }));
    expect(result.current.changed).toBe(true);
    act(() => result.current.undo());
    expect(result.current.brand?.accent).toBe("#C4512D");
    expect(result.current.changed).toBe(false);
    act(() => vi.advanceTimersByTime(BRAND_SAVE_DEBOUNCE_MS));
    expect(saveBrand).toHaveBeenLastCalledWith(expect.objectContaining({ accent: "#C4512D" }));
    expect(saveBrand.mock.calls.at(-1)?.[0]).not.toHaveProperty("accentContrast");
  });

  it("removing an image detaches it, and Undo restores it", async () => {
    const { result } = renderHook(() => useBrandEditor("bot-1", "failed"));
    expect(result.current.imageFor("logo")?.fileName).toBe("logo.png");
    act(() => result.current.remove("logo"));
    expect(result.current.brand?.logo).toBeNull();
    expect(removeImage).toHaveBeenCalledWith({ id: "bot-1", imageId: "img-logo" });
    act(() => result.current.undo());
    expect(restoreImage).toHaveBeenCalledWith({ id: "bot-1", imageId: "img-logo" });
    expect(result.current.brand?.logo).toBe("img-logo");
  });

  it("puts an uploaded image in its slot, or shows the server's reason", async () => {
    uploadImage.mockImplementationOnce(() => unwrap({ ...logo, id: "img-cover", kind: "cover" }));
    const { result } = renderHook(() => useBrandEditor("bot-1", "failed"));
    await act(async () => result.current.upload("coverImage", new File(["x"], "cover.jpg")));
    expect(result.current.brand?.coverImage).toBe("img-cover");

    uploadImage.mockImplementationOnce(() => ({
      unwrap: () => Promise.reject({ data: { message: "That image is over 5 MB." } }),
    }));
    await act(async () => result.current.upload("shareImage", new File(["x"], "big.jpg")));
    expect(result.current.errors.shareImage).toBe("That image is over 5 MB.");
    expect(result.current.brand?.shareImage).toBeNull();
  });
});
