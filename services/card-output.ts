import type { PromptPresetId } from "./prompt-presets";

export function isBidirectionalPreset(presetId: PromptPresetId): boolean {
  return presetId === "english-translation";
}

export function resolveOutputSeparator(
  presetId: PromptPresetId,
  basicSeparator: string,
  reversedSeparator: string
): string {
  return isBidirectionalPreset(presetId)
    ? reversedSeparator
    : basicSeparator;
}

