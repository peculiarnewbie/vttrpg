import { MAX_BOARD_IMAGE_BYTES } from "./board";

/** What a world accepts as an uploaded file, for direct uploads and imported worlds alike. */
export const uploadRules = {
  board: {
    types: ["image/png", "image/jpeg", "image/webp"],
    maxBytes: MAX_BOARD_IMAGE_BYTES,
    typeMessage: "Use a PNG, JPEG, or WebP image",
    sizeMessage: "Image must be 10MB or smaller",
  },
  avatars: {
    types: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    maxBytes: 5 * 1024 * 1024,
    typeMessage: "Avatar must be a PNG, JPEG, WebP, or GIF",
    sizeMessage: "Avatar must be 5MB or smaller",
  },
} as const;
export type UploadKind = keyof typeof uploadRules;

export const AVATAR_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
