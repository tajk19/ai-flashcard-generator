import { clampCardCount, normalizeBasicSeparator } from "./flashcard-generator";
import { normalizePromptPresetId, type PromptPresetId } from "./prompt-presets";

export interface AIFlashcardSettings {
  geminiApiKeySecretId: string;
  model: string;
  defaultCardCount: number;
  defaultPromptPreset: PromptPresetId;
  targetLanguage: string;
  customPrompt: string;
  outputFolder: string;
  deckTag: string;
  openDeckAfterCreation: boolean;
  separatorMode: "auto" | "manual";
  basicSeparator: string;
  reversedSeparator: string;
}

export const DEFAULT_SETTINGS: AIFlashcardSettings = {
  geminiApiKeySecretId: "",
  model: "gemini-3.1-flash-lite",
  defaultCardCount: 10,
  defaultPromptPreset: "notes",
  targetLanguage: "Russian",
  customPrompt: "",
  outputFolder: "Flashcards",
  deckTag: "flashcards/generated",
  openDeckAfterCreation: true,
  separatorMode: "auto",
  basicSeparator: "::",
  reversedSeparator: ":::"
};

// Only documented, non-secret settings may survive a load/save round trip.
export function parseSettings(value: unknown): AIFlashcardSettings {
  const saved = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const settings = { ...DEFAULT_SETTINGS };
  const textKeys = ["geminiApiKeySecretId", "model", "targetLanguage", "customPrompt",
    "outputFolder", "deckTag", "basicSeparator", "reversedSeparator"] as const;
  for (const key of textKeys) {
    if (typeof saved[key] === "string") settings[key] = saved[key];
  }
  settings.defaultPromptPreset = normalizePromptPresetId(saved.defaultPromptPreset);
  settings.defaultCardCount = clampCardCount(
    typeof saved.defaultCardCount === "number" ? saved.defaultCardCount : 10
  );
  settings.separatorMode = saved.separatorMode === "manual" ? "manual" : "auto";
  if (typeof saved.openDeckAfterCreation === "boolean") {
    settings.openDeckAfterCreation = saved.openDeckAfterCreation;
  }
  for (const key of ["basicSeparator", "reversedSeparator"] as const) {
    try { settings[key] = normalizeBasicSeparator(settings[key]); }
    catch { settings[key] = DEFAULT_SETTINGS[key]; }
  }
  return settings;
}

