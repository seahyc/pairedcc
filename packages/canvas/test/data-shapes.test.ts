import { describe, expect, it } from "vitest";
import type { TLShape } from "tldraw";
import { contentVersion, dataPrototypeEnabled, recordedInputs } from "../src/data/shapes";
import { syntheticOrders } from "../src/data/model";

const shape = (s: { type: string; props?: object; meta?: object }) => ({ meta: {}, props: {}, ...s }) as unknown as TLShape;

describe("data prototype flag", () => {
  it("is off unless ?prototype=data is present", () => {
    expect(dataPrototypeEnabled("")).toBe(false);
    expect(dataPrototypeEnabled("?prototype=other")).toBe(false);
    expect(dataPrototypeEnabled("?prototype=data")).toBe(true);
    expect(dataPrototypeEnabled("?x=1&prototype=other&prototype=data")).toBe(true);
  });
});

describe("content versions and recorded inputs", () => {
  it("uses the data version for datasets, the state version for charts and the revision otherwise", () => {
    expect(contentVersion(shape({ type: "dataset", props: { data: { ...syntheticOrders(), version: 4 } }, meta: { revision: 9 } }))).toBe(4);
    expect(contentVersion(shape({ type: "chart", props: { version: 2 }, meta: { revision: 9 } }))).toBe(2);
    expect(contentVersion(shape({ type: "card", meta: { revision: 9 } }))).toBe(9);
  });
  it("reads a chart's dataset input and meta.inputs on other objects, ignoring malformed ones", () => {
    expect(recordedInputs(shape({ type: "chart", props: { datasetId: "shape:d", inputVersion: 3 } }))).toEqual([{ id: "shape:d", version: 3 }]);
    expect(recordedInputs(shape({ type: "chart", props: { datasetId: "", inputVersion: 0 } }))).toEqual([]);
    expect(recordedInputs(shape({ type: "card", meta: { inputs: [{ id: "shape:c", version: 1 }] } }))).toEqual([{ id: "shape:c", version: 1 }]);
    expect(recordedInputs(shape({ type: "card", meta: { inputs: "nope" } }))).toEqual([]);
  });
});
