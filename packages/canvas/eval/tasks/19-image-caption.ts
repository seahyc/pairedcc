import { task } from "../task-kit";
// A 1×1 PNG, for the reference solution only.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
export default task({
  id: "19-image-caption",
  prompt: 'Place a small image on the board (any PNG you can produce, for example a single coloured square) with the caption "Logo idea".',
  check({ read }) {
    const img = read.objects.find((o: any) => o.type === "image");
    if (!img) return "no image";
    // A caption is its own object pointing at the image (meta.captionFor).
    const caption = read.objects.find((o: any) => o.meta?.captionFor === img.id);
    return caption && /logo idea/i.test(caption.text ?? "") ? true : "image has no Logo idea caption";
  },
  solution: async ({ call }) => void (await call("canvas_image", { src: PNG, x: 0, y: 0, width: 120, height: 120, caption: "Logo idea" })),
});
