import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useGetBotImagesQuery,
  useGetBotPageQuery,
  useRemoveBotImageMutation,
  useRestoreBotImageMutation,
  useUpdateBotPageBrandMutation,
  useUploadBotImageMutation,
} from "@api";

import type { BotImageKind, BotImageView, BotPageBrand } from "../../types/botPage";

/** Edits wait this long for the next one before saving (chunk-20d §5: saves as you go). */
export const BRAND_SAVE_DEBOUNCE_MS = 600;

/** The brand's single-image slots and the kind of image each holds. */
export const BRAND_SLOTS = {
  logo: "logo",
  coverImage: "cover",
  shareImage: "share",
} as const satisfies Record<string, BotImageKind>;
export type BrandSlot = keyof typeof BRAND_SLOTS;

type BrandChange = Partial<Omit<BotPageBrand, "accentContrast">>;

export interface BrandEditor {
  /** The brand as the owner sees it now (changes show at once; the save follows). */
  brand: BotPageBrand | null;
  /** The bot's images by id, with signed URLs. */
  images: Record<string, BotImageView>;
  imageFor: (slot: BrandSlot) => BotImageView | null;
  uploading: Partial<Record<BrandSlot, boolean>>;
  errors: Partial<Record<BrandSlot, string | null>>;
  /** "Changed", with Undo, after each change; null once it's gone. */
  changed: boolean;
  /** The last save finished and nothing is waiting. */
  saved: boolean;
  change: (patch: BrandChange) => void;
  upload: (slot: BrandSlot, file: File) => Promise<void>;
  remove: (slot: BrandSlot) => void;
  /** A team member's photo (Look and feel's Team photos). */
  uploadPerson: (name: string, file: File) => Promise<void>;
  personUploading: string | null;
  personError: { name: string; message: string } | null;
  undo: () => void;
  dismissChanged: () => void;
}

const message = (error: unknown, fallback: string): string => {
  const data = (error as { data?: { message?: unknown } })?.data;
  return typeof data?.message === "string" ? data.message : fallback;
};

/**
 * The page's look, edited in place (chunk 20d): logo, cover and link-preview images, colour,
 * heading style and theme. Each change shows at once and is saved as a brand PATCH after a short
 * pause, so a run of changes is one save; "Changed. Undo" puts back the brand from before the
 * last change (and restores an image it removed). Used by onboarding's "Make it yours" and by
 * Look and feel. Screens only draw this and call it.
 */
export const useBrandEditor = (chatbotId: string | null, failed: string): BrandEditor => {
  const skip = !chatbotId;
  const { data: page } = useGetBotPageQuery(chatbotId ?? "", { skip });
  const { data: imageList } = useGetBotImagesQuery(chatbotId ?? "", { skip });
  const [saveBrand] = useUpdateBotPageBrandMutation();
  const [uploadImage] = useUploadBotImageMutation();
  const [removeImage] = useRemoveBotImageMutation();
  const [restoreImage] = useRestoreBotImageMutation();

  const [local, setLocal] = useState<BotPageBrand | null>(null);
  const [uploading, setUploading] = useState<Partial<Record<BrandSlot, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<BrandSlot, string | null>>>({});
  const [changed, setChanged] = useState(false);
  const [pending, setPending] = useState(false);
  const [extra, setExtra] = useState<Record<string, BotImageView>>({});
  const [personUploading, setPersonUploading] = useState<string | null>(null);
  const [personError, setPersonError] = useState<{ name: string; message: string } | null>(null);
  const queued = useRef<BrandChange>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const before = useRef<{ brand: BotPageBrand; removed: string | null } | null>(null);

  const brand = local ?? page?.settings.brand ?? null;
  const images = useMemo(() => {
    const byId: Record<string, BotImageView> = { ...extra };
    for (const image of imageList ?? []) byId[image.id] = image;
    return byId;
  }, [imageList, extra]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const patch = queued.current;
    queued.current = {};
    if (!chatbotId || !Object.keys(patch).length) {
      setPending(false);
      return;
    }
    saveBrand({ id: chatbotId, ...patch })
      .unwrap()
      .catch(() => setErrors(e => ({ ...e, logo: e.logo ?? failed })))
      .finally(() => setPending(Object.keys(queued.current).length > 0));
  }, [chatbotId, failed, saveBrand]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = useCallback(
    (patch: BrandChange, options: { undoable?: boolean; removed?: string | null } = {}) => {
      if (!brand) return;
      if (options.undoable !== false) {
        before.current = { brand, removed: options.removed ?? null };
        setChanged(true);
      }
      setLocal({ ...brand, ...patch });
      queued.current = { ...queued.current, ...patch };
      setPending(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, BRAND_SAVE_DEBOUNCE_MS);
    },
    [brand, flush],
  );

  const upload = useCallback(
    async (slot: BrandSlot, file: File) => {
      if (!chatbotId) return;
      setUploading(u => ({ ...u, [slot]: true }));
      setErrors(e => ({ ...e, [slot]: null }));
      try {
        const image = await uploadImage({ id: chatbotId, kind: BRAND_SLOTS[slot], file }).unwrap();
        setExtra(x => ({ ...x, [image.id]: image }));
        apply({ [slot]: image.id });
      } catch (error) {
        setErrors(e => ({ ...e, [slot]: message(error, failed) }));
      } finally {
        setUploading(u => ({ ...u, [slot]: false }));
      }
    },
    [apply, chatbotId, failed, uploadImage],
  );

  const uploadPerson = useCallback(
    async (name: string, file: File) => {
      if (!chatbotId || !brand) return;
      setPersonUploading(name);
      setPersonError(null);
      try {
        const image = await uploadImage({
          id: chatbotId,
          kind: "person",
          file,
          alt: name,
        }).unwrap();
        setExtra(x => ({ ...x, [image.id]: image }));
        apply({ peoplePhotos: { ...brand.peoplePhotos, [name]: image.id } });
      } catch (error) {
        setPersonError({ name, message: message(error, failed) });
      } finally {
        setPersonUploading(null);
      }
    },
    [apply, brand, chatbotId, failed, uploadImage],
  );

  const remove = useCallback(
    (slot: BrandSlot) => {
      const id = brand?.[slot] ?? null;
      apply({ [slot]: null }, { removed: id });
      if (chatbotId && id) void removeImage({ id: chatbotId, imageId: id });
    },
    [apply, brand, chatbotId, removeImage],
  );

  const undo = useCallback(() => {
    const previous = before.current;
    if (!previous || !brand) return;
    before.current = null;
    setChanged(false);
    if (chatbotId && previous.removed) {
      void restoreImage({ id: chatbotId, imageId: previous.removed });
    }
    const { accentContrast: _derived, ...restore } = previous.brand;
    void _derived;
    apply(restore, { undoable: false });
  }, [apply, brand, chatbotId, restoreImage]);

  return {
    brand,
    images,
    imageFor: slot => {
      const id = brand?.[slot];
      return id ? (images[id] ?? null) : null;
    },
    uploading,
    errors,
    changed,
    saved: !pending,
    change: patch => apply(patch),
    upload,
    remove,
    uploadPerson,
    personUploading,
    personError,
    undo,
    dismissChanged: () => setChanged(false),
  };
};
