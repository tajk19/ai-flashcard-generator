import { describe, expect, it } from "vitest";
import {
  getPromptPreset,
  normalizePromptPresetId,
  PROMPT_PRESETS,
  resolvePromptInstructions
} from "../services/prompt-presets";

describe("prompt presets", () => {
  it("offers notes, English translation, and custom profiles", () => {
    expect(PROMPT_PRESETS.map((preset) => preset.id)).toEqual([
      "notes",
      "english-translation",
      "custom"
    ]);
    expect(getPromptPreset("notes").template).toContain(
      "information explicitly contained"
    );
  });

  it("falls back to the notes profile for stale saved values", () => {
    expect(normalizePromptPresetId("removed-preset")).toBe("notes");
    expect(normalizePromptPresetId(null)).toBe("notes");
  });

  it("resolves the English profile and its target language", () => {
    const prompt = resolvePromptInstructions({
      presetId: "english-translation",
      count: 18,
      targetLanguage: "Russian",
      customPrompt: ""
    });

    expect(prompt).toContain("up to 18 English/translation pairs");
    expect(prompt).toContain("Russian translation");
    expect(prompt).toContain("You may translate it");
    expect(prompt).toContain("reviewed both English → Russian and Russian → English");
    expect(prompt).toContain("Do not create a second JSON card");
  });

  it("uses custom instructions and replaces supported variables", () => {
    const prompt = resolvePromptInstructions({
      presetId: "custom",
      count: 6,
      targetLanguage: "Spanish",
      customPrompt:
        "Make {{count}} term cards and answer in {{targetLanguage}}."
    });

    expect(prompt).toBe("Make 6 term cards and answer in Spanish.");
  });

  it("validates custom prompts and required translation language", () => {
    expect(() =>
      resolvePromptInstructions({
        presetId: "custom",
        count: 5,
        targetLanguage: "Russian",
        customPrompt: "   "
      })
    ).toThrow("Custom prompt is empty");

    expect(() =>
      resolvePromptInstructions({
        presetId: "english-translation",
        count: 5,
        targetLanguage: " ",
        customPrompt: ""
      })
    ).toThrow("Target translation language is empty");
  });
});

