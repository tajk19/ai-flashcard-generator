import { describe, expect, it } from "vitest";
import {
  isBidirectionalPreset,
  resolveOutputSeparator
} from "../services/card-output";

describe("card output mode", () => {
  it("uses the reversed separator only for the English profile", () => {
    expect(resolveOutputSeparator("english-translation", "::", ":::")).toBe(
      ":::"
    );
    expect(resolveOutputSeparator("notes", "::", ":::")).toBe("::");
    expect(resolveOutputSeparator("custom", "::", ":::")).toBe("::");
    expect(isBidirectionalPreset("english-translation")).toBe(true);
    expect(isBidirectionalPreset("notes")).toBe(false);
  });
});

