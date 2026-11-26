import type { Editor, TLAsset, TLAssetStore } from "tldraw";

// Images the person drops, pastes or imports are kept in the board itself, as data URLs, so a
// board saved to an account opens with its images in a clean browser or on another device.
// tldraw's default keeps them in this browser's IndexedDB (an `asset:` src), which travels
// nowhere. Large photos are scaled down so a few of them fit under the board size limit.

/** Images above this size are scaled down before they go into the board. */
export const SHRINK_ABOVE_BYTES = 1_500_000;
/** The longest side of a scaled-down image, in pixels. */
export const MAX_SIDE = 2048;

/** Formats that are kept exactly as they are: animation, vectors, or already small. */
export function keepAsIs(type: string, bytes: number) {
  return bytes <= SHRINK_ABOVE_BYTES || type === "image/gif" || type === "image/svg+xml" || !type.startsWith("image/");
}

/** Width and height that fit within `max` on the longest side, never enlarged. */
export function fitWithin(w: number, h: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
    reader.readAsDataURL(blob);
  });

async function shrink(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.w, size.h);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    // Keep the original if the browser cannot encode, or encoding made it no smaller.
    return out && out.size < blob.size ? out : blob;
  } finally {
    bitmap.close();
  }
}

/** The data URL an image is stored as: the file itself, or a scaled-down copy of a large photo. */
export async function imageDataUrl(blob: Blob) {
  if (keepAsIs(blob.type, blob.size)) return readAsDataUrl(blob);
  try {
    return await readAsDataUrl(await shrink(blob));
  } catch {
    return readAsDataUrl(blob);
  }
}

/** Upload is the only override: tldraw's own resolve still shows older `asset:` images. */
export const boardImageStore: TLAssetStore = {
  upload: async (_asset, file) => ({ src: await imageDataUrl(file) }),
};

const isLocalOnly = (asset: TLAsset) => typeof asset.props.src === "string" && asset.props.src.startsWith("asset:");

/**
 * Images added before this change live only in this browser. Copy each into the board, so the
 * next save carries it. Returns how many were moved; ones this browser no longer has are left.
 */
export async function moveLocalImagesIntoBoard(editor: Editor) {
  let moved = 0;
  for (const asset of editor.getAssets().filter(isLocalOnly)) {
    try {
      const url = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true });
      if (!url) continue;
      const blob = await (await fetch(url)).blob();
      const src = await imageDataUrl(blob);
      const now = editor.getAsset(asset.id);
      if (!now || !isLocalOnly(now)) continue;
      // Where the image is kept is not the person's edit: keep it off their undo stack.
      editor.run(() => editor.updateAssets([{ ...now, props: { ...now.props, src } } as TLAsset]), { history: "ignore" });
      moved++;
    } catch {
      // Not readable here (cleared site data): leave it, nothing better can be done.
    }
  }
  return moved;
}
