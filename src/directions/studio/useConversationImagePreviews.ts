import { useEffect, useMemo, useRef, useState } from "react";

import { readImageAsDataUrl } from "../../lib/bridge";
import type { ConversationImageAttachment } from "../../lib/types";
import {
  conversationImageKey,
  conversationImageLabel,
} from "./conversation-images";

export type ConversationImagePreview = {
  attachment: ConversationImageAttachment;
  key: string;
  label: string;
  loading: boolean;
  previewUrl: string | null;
};

const previewCache = new Map<string, string>();

export function useConversationImagePreviews(
  images: ConversationImageAttachment[] | null | undefined,
) {
  const loadingPathsRef = useRef(new Set<string>());
  const [localPreviews, setLocalPreviews] = useState<
    Record<string, { loading: boolean; previewUrl: string | null }>
  >({});

  useEffect(() => {
    if (!images || images.length === 0) {
      return;
    }

    let cancelled = false;
    for (const image of images) {
      if (image.type !== "localImage") {
        continue;
      }
      const path = image.path;
      if (previewCache.has(path) || loadingPathsRef.current.has(path)) {
        continue;
      }
      loadingPathsRef.current.add(path);

      setLocalPreviews((current) => ({
        ...current,
        [path]: { loading: true, previewUrl: null },
      }));

      void readImageAsDataUrl(path)
        .then((previewUrl) => {
          previewCache.set(path, previewUrl);
          loadingPathsRef.current.delete(path);
          if (cancelled) {
            return;
          }
          setLocalPreviews((current) => ({
            ...current,
            [path]: { loading: false, previewUrl },
          }));
        })
        .catch(() => {
          loadingPathsRef.current.delete(path);
          if (cancelled) {
            return;
          }
          setLocalPreviews((current) => ({
            ...current,
            [path]: { loading: false, previewUrl: null },
          }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [images]);

  return useMemo<ConversationImagePreview[]>(() => {
    return (images ?? []).map((image) => {
      if (image.type === "image") {
        return {
          attachment: image,
          key: conversationImageKey(image),
          label: conversationImageLabel(image),
          loading: false,
          previewUrl: image.url,
        };
      }

      const cached = previewCache.get(image.path);
      const local = localPreviews[image.path];
      return {
        attachment: image,
        key: conversationImageKey(image),
        label: conversationImageLabel(image),
        loading: local?.loading ?? !cached,
        previewUrl: cached ?? local?.previewUrl ?? null,
      };
    });
  }, [images, localPreviews]);
}
