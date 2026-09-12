import { MAX_BOARD_IMAGE_BYTES } from "../domain/board";

/** Decode once and bound texture size before upload; the board only stores asset IDs. */
export async function prepareBoardImage(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image");
  }
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20MB");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare image");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Could not prepare image"))),
        "image/webp",
        0.85,
      ),
    );
    if (blob.size > MAX_BOARD_IMAGE_BYTES) throw new Error("Image is too large after resizing");
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}
