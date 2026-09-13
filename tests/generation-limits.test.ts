import { describe, expect, it } from "vitest";
import {
  MAX_CARD_FIELD_CHARACTERS,
  MAX_CUSTOM_PROMPT_CHARACTERS,
  MAX_RESPONSE_BYTES,
  MAX_SOURCE_CHARACTERS,
  utf8ByteLength,
  validateCardFieldLength,
  validateCustomPrompt,
  validateGenerationInstructions,
  validateResponseTextSize,
  validateSourceText
} from "../services/generation-limits";

describe("generation limits", () => {
  it("accepts source and prompt values exactly at their character limits", () => {
    expect(() => validateSourceText("x".repeat(MAX_SOURCE_CHARACTERS))).not.toThrow();
    expect(() => validateCustomPrompt("x".repeat(MAX_CUSTOM_PROMPT_CHARACTERS))).not.toThrow();
  });

  it("rejects oversized source text and custom prompts without truncation", () => {
    expect(() => validateSourceText("x".repeat(MAX_SOURCE_CHARACTERS + 1))).toThrow(
      "Select a smaller fragment"
    );
    expect(() =>
      validateCustomPrompt("x".repeat(MAX_CUSTOM_PROMPT_CHARACTERS + 1))
    ).toThrow("The maximum is");
    expect(() =>
      validateGenerationInstructions(
        "x".repeat(MAX_CUSTOM_PROMPT_CHARACTERS + 1)
      )
    ).toThrow("resolved generation prompt");
  });

  it("counts Unicode code points for card fields", () => {
    expect(() =>
      validateCardFieldLength(
        "evidence",
        "😀".repeat(MAX_CARD_FIELD_CHARACTERS)
      )
    ).not.toThrow();
    expect(() =>
      validateCardFieldLength(
        "evidence",
        "😀".repeat(MAX_CARD_FIELD_CHARACTERS + 1)
      )
    ).toThrow(/evidence longer than 2.000/u);
  });

  it("enforces the response limit in UTF-8 bytes", () => {
    expect(utf8ByteLength("😀")).toBe(4);
    expect(() => validateResponseTextSize("x".repeat(MAX_RESPONSE_BYTES))).not.toThrow();
    expect(() => validateResponseTextSize("x".repeat(MAX_RESPONSE_BYTES + 1))).toThrow(
      "larger than 1 MiB"
    );
  });
});

