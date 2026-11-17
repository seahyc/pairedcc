import { createShapeId, toRichText, type Editor } from "tldraw";

export function seed(editor: Editor) {
  const frame = createShapeId("first-thoughts");
  editor.createShape({
    id: frame,
    type: "frame",
    x: 0,
    y: 0,
    props: { w: 1000, h: 720, name: "First thoughts" },
  });
  editor.createShapes([
    {
      type: "text",
      parentId: frame,
      x: 68,
      y: 62,
      props: {
        font: "sans",
        size: "xl",
        richText: toRichText("A little room\nto think."),
      },
    },
    {
      type: "text",
      parentId: frame,
      x: 70,
      y: 192,
      props: {
        font: "sans",
        size: "s",
        richText: toRichText(
          "Bring a question. Make a connection.\nSee where it takes you.",
        ),
        color: "grey",
      },
    },
    {
      type: "geo",
      parentId: frame,
      x: 68,
      y: 330,
      meta: { name: "A starting point" },
      props: {
        w: 360,
        h: 230,
        geo: "rectangle",
        fill: "solid",
        color: "light-blue",
        dash: "solid",
        font: "sans",
        size: "m",
        richText: toRichText("What would I like\nto understand?"),
      },
    },
    {
      type: "note",
      parentId: frame,
      x: 555,
      y: 345,
      props: {
        color: "yellow",
        font: "sans",
        size: "m",
        richText: toRichText("Put the messy\nfirst thought here."),
      },
    },
    {
      type: "arrow",
      parentId: frame,
      x: 450,
      y: 435,
      props: {
        start: { x: 0, y: 0 },
        end: { x: 75, y: 0 },
        color: "grey",
        dash: "solid",
        size: "s",
      },
    },
    {
      type: "text",
      parentId: frame,
      x: 70,
      y: 638,
      props: {
        font: "sans",
        size: "s",
        color: "grey",
        richText: toRichText(
          "Space + drag to pan     ·     Scroll to move     ·     Pinch to zoom",
        ),
      },
    },
  ]);
  editor.selectNone();
  editor.zoomToFit({ animation: { duration: 0 } });
  editor.clearHistory();
}
