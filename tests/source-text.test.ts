import { describe, expect, it } from "vitest";
import { selectSourceText } from "../services/source-text";

describe("source text selection", () => {
  it("prefers a non-empty editor selection", () => {
    expect(selectSourceText("Selected fragment", "Whole current note")).toEqual({
      text: "Selected fragment",
      scope: "selection"
    });
  });

  it("uses the current editor value for a whitespace-only selection", () => {
    expect(selectSourceText(" \n\t ", "Unsaved editor changes")).toEqual({
      text: "Unsaved editor changes",
      scope: "note"
    });
  });
});

