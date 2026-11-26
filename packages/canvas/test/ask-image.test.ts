import { describe, expect, it } from "vitest";
import { describeImage } from "../src/ask-rules";

// Item 84: an ask about an image says what the image is, not "(Image, no text)".
describe("an image as an ask gives it", () => {
  it("names the file, its size, the caption and the alt text", () => {
    expect(describeImage({ kind: "image", name: "pricing-sketch.png", w: 1600, h: 900, caption: "Three tiers on a napkin", alt: "Hand-drawn boxes labelled S, M, L" })).toBe(
      'Image "pricing-sketch.png", 1600×900 px. Caption: "Three tiers on a napkin". Alt text: "Hand-drawn boxes labelled S, M, L".',
    );
  });
  it("leaves out what it does not have", () => {
    expect(describeImage({ kind: "image", name: "photo.jpg" })).toBe('Image "photo.jpg".');
    expect(describeImage({ kind: "image", caption: "Logo idea" })).toBe('Image. Caption: "Logo idea".');
    expect(describeImage({ kind: "video", w: 640.4, h: 360 })).toBe("Video, 640×360 px.");
  });
  it("says plainly when there is nothing to go on", () => {
    expect(describeImage({ kind: "image" })).toBe("Image with no file name, caption or alt text: you cannot see it.");
  });
  it("trims whitespace and ignores empty parts", () => {
    expect(describeImage({ kind: "image", name: "  ", caption: "  Logo  ", alt: "" })).toBe('Image. Caption: "Logo".');
  });
});
