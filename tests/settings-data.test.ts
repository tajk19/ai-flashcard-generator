import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../services/settings-data";

describe("stored settings validation", () => {
  it("rejects malformed types and discards unknown secret-bearing properties", () => {
    const result = parseSettings({ model: {}, customPrompt: 4, defaultCardCount: "20",
      geminiApiKeySecretId: "gemini", apiKey: "legacy-secret", unexpected: "value" });
    expect(result.model).toBe(DEFAULT_SETTINGS.model);
    expect(result.customPrompt).toBe("");
    expect(result.defaultCardCount).toBe(10);
    expect(result.geminiApiKeySecretId).toBe("gemini");
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("unexpected");
  });
  it("keeps valid preferences and safely defaults old data", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ basicSeparator: ";;", defaultPromptPreset: "english-translation" }))
      .toMatchObject({ separatorMode: "auto", basicSeparator: ";;",
        reversedSeparator: ":::", defaultPromptPreset: "english-translation" });
  });
});

