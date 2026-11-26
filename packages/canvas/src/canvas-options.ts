import { defaultTldrawOptions, type TldrawOptions } from "tldraw";

/**
 * Editor limits. tldraw allows 4,000 shapes per page by default, and createShapes refuses a
 * whole batch that would exceed it, so a 10k-object board (the sprint's performance target)
 * could not exist. 20,000 leaves headroom above that target; performance at that size is
 * measured by `pnpm eval:canvas`, not assumed.
 */
export const MAX_SHAPES_PER_PAGE = 20_000;

export const canvasOptions: Partial<TldrawOptions> = { maxShapesPerPage: MAX_SHAPES_PER_PAGE };

export const defaultMaxShapesPerPage = defaultTldrawOptions.maxShapesPerPage;
