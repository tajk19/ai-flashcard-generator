import { normalizePath, type App } from "obsidian";
import { normalizeBasicSeparator } from "./flashcard-generator";

export const SPACED_REPETITION_PLUGIN_ID = "obsidian-spaced-repetition";
export const DEFAULT_BASIC_SEPARATOR = "::";
export const DEFAULT_REVERSED_SEPARATOR = ":::";

export type SeparatorResolutionSource = "runtime" | "data-file" | "default";

export interface SpacedRepetitionSeparators {
  basic: string;
  reversed: string;
  source: SeparatorResolutionSource;
  compatible: boolean;
  message: string;
}

interface RawSeparators {
  basic: string | undefined;
  reversed: string | undefined;
}

export const DEFAULT_SPACED_REPETITION_SEPARATORS: SpacedRepetitionSeparators = {
  basic: DEFAULT_BASIC_SEPARATOR,
  reversed: DEFAULT_REVERSED_SEPARATOR,
  source: "default",
  compatible: true,
  message:
    "Using the canonical Spaced Repetition defaults because its saved settings were not found."
};

export async function resolveSpacedRepetitionSeparators(
  app: App
): Promise<SpacedRepetitionSeparators> {
  const runtime = readRuntimeSeparators(app);
  if (runtime) {
    return validateResolvedSeparators(runtime, "runtime");
  }

  const saved = await readSavedSeparators(app);
  if (saved) {
    return validateResolvedSeparators(saved, "data-file");
  }

  return { ...DEFAULT_SPACED_REPETITION_SEPARATORS };
}

export function parseSpacedRepetitionPluginData(
  value: unknown
): RawSeparators | null {
  if (!isRecord(value)) {
    return null;
  }

  const settings = isRecord(value.settings) ? value.settings : value;
  const basic =
    typeof settings.singleLineCardSeparator === "string"
      ? settings.singleLineCardSeparator
      : undefined;
  const reversed =
    typeof settings.singleLineReversedCardSeparator === "string"
      ? settings.singleLineReversedCardSeparator
      : undefined;

  return basic === undefined && reversed === undefined
    ? null
    : { basic, reversed };
}

function readRuntimeSeparators(app: App): RawSeparators | null {
  try {
    const pluginRegistry = (
      app as unknown as {
        plugins?: { getPlugin(pluginId: string): unknown };
      }
    ).plugins;
    const plugin = pluginRegistry?.getPlugin(SPACED_REPETITION_PLUGIN_ID);
    if (!isRecord(plugin)) {
      return null;
    }

    const isLoaded = plugin.isDataManagerLoaded;
    if (typeof isLoaded === "function" && !isLoaded.call(plugin)) {
      return null;
    }

    const dataManager = plugin.dataManager;
    if (!isRecord(dataManager) || !isRecord(dataManager.settingsManager)) {
      return null;
    }

    return parseSpacedRepetitionPluginData({
      settings: dataManager.settingsManager.settings
    });
  } catch {
    return null;
  }
}

async function readSavedSeparators(app: App): Promise<RawSeparators | null> {
  const dataPath = normalizePath(
    `${app.vault.configDir}/plugins/${SPACED_REPETITION_PLUGIN_ID}/data.json`
  );

  try {
    if (!(await app.vault.adapter.exists(dataPath))) {
      return null;
    }

    return parseSpacedRepetitionPluginData(
      JSON.parse(await app.vault.adapter.read(dataPath)) as unknown
    );
  } catch {
    return null;
  }
}

function validateResolvedSeparators(
  raw: RawSeparators,
  source: Exclude<SeparatorResolutionSource, "default">
): SpacedRepetitionSeparators {
  const basic = raw.basic ?? DEFAULT_BASIC_SEPARATOR;
  const reversed = raw.reversed ?? DEFAULT_REVERSED_SEPARATOR;
  const invalid: string[] = [];

  validateLiteralSeparator("basic", basic, invalid);
  validateLiteralSeparator("reversed", reversed, invalid);

  if (basic === reversed) {
    return {
      basic,
      reversed,
      source,
      compatible: false,
      message:
        "Spaced Repetition uses the same value for its basic and reversed separators. They must be different for bidirectional English cards."
    };
  }

  if (invalid.length > 0) {
    return {
      basic,
      reversed,
      source,
      compatible: false,
      message:
        `The Spaced Repetition ${invalid.join(" and ")} separator cannot be serialized safely. ` +
        "Choose compatible punctuation separators such as :: and :::, or enable manual override."
    };
  }

  return {
    basic,
    reversed,
    source,
    compatible: true,
    message:
      source === "runtime"
        ? "Detected from the currently loaded Spaced Repetition plugin."
        : "Detected from the saved Spaced Repetition settings."
  };
}

function validateLiteralSeparator(
  label: "basic" | "reversed",
  value: string,
  invalid: string[]
): void {
  try {
    if (normalizeBasicSeparator(value) !== value) {
      invalid.push(label);
    }
  } catch {
    invalid.push(label);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

