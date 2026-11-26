import { ImageShapeUtil, type TLAsset, type TLShapePartial, type VecModel } from "tldraw";

// A photo the person drops or pastes is placed at its pixel size by default, so one large
// picture covers the board and everything on it. Place it no larger than a card-sized view
// beside the person's thoughts instead; the asset keeps its full resolution, so zooming in or
// resizing shows every pixel.

/** The longest side of an image as it first lands on the board, in board units. */
export const IMAGE_PLACE_MAX = 600;

/** Size at which an image of w × h first lands: scaled to fit, never enlarged. */
export function placedSize(w: number, h: number, max = IMAGE_PLACE_MAX) {
  if (!(w > 0) || !(h > 0)) return { w, h };
  const scale = Math.min(1, max / Math.max(w, h));
  // Not rounded: a very thin image (3000 × 2) would round to zero height, which tldraw refuses.
  return { w: w * scale, h: h * scale };
}

/** tldraw's image shape, placing new images at a size that fits beside cards. */
export class BoardImageShapeUtil extends ImageShapeUtil {
  override createShapeForAsset(asset: TLAsset, position: VecModel): TLShapePartial | null {
    const partial = super.createShapeForAsset(asset, position);
    const props = partial?.props as { w?: number; h?: number } | undefined;
    if (!partial || !props || typeof props.w !== "number" || typeof props.h !== "number") return partial;
    return { ...partial, props: { ...props, ...placedSize(props.w, props.h) } } as TLShapePartial;
  }
}
