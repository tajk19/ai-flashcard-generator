import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASIC_SEPARATOR,
  DEFAULT_REVERSED_SEPARATOR,
  parseSpacedRepetitionPluginData,
  resolveSpacedRepetitionSeparators
} from "../services/spaced-repetition-compat";

function makeApp(options?: {
  runtimeSettings?: Record<string, unknown>;
  savedData?: unknown;
}): App {
  const savedText = JSON.stringify(options?.savedData ?? {});
  return {
    plugins: {
      getPlugin: () =>
        options?.runtimeSettings
          ? {
              isDataManagerLoaded: () => true,
              dataManager: {
                settingsManager: { settings: options.runtimeSettings }
              }
            }
          : null
    },
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: async () => options?.savedData !== undefined,
        read: async () => savedText
      }
    }
  } as unknown as App;
}

describe("Spaced Repetition separator compatibility", () => {
  it("parses the nested settings object used by Spaced Repetition 1.15.4", () => {
    expect(
      parseSpacedRepetitionPluginData({
        settings: {
          singleLineCardSeparator: "::",
          singleLineReversedCardSeparator: ":::"
        }
      })
    ).toEqual({ basic: "::", reversed: ":::" });
  });

  it("prefers live plugin settings over a stale data file", async () => {
    const result = await resolveSpacedRepetitionSeparators(
      makeApp({
        runtimeSettings: {
          singleLineCardSeparator: "::",
          singleLineReversedCardSeparator: ":::"
        },
        savedData: {
          settings: {
            singleLineCardSeparator: ";;",
            singleLineReversedCardSeparator: ";;;"
          }
        }
      })
    );

    expect(result).toMatchObject({
      basic: "::",
      reversed: ":::",
      source: "runtime",
      compatible: true
    });
  });

  it("falls back to data.json and accepts safe custom literals", async () => {
    const result = await resolveSpacedRepetitionSeparators(
      makeApp({
        savedData: {
          settings: {
            singleLineCardSeparator: ";;",
            singleLineReversedCardSeparator: "???"
          }
        }
      })
    );

    expect(result).toMatchObject({
      basic: ";;",
      reversed: "???",
      source: "data-file",
      compatible: true
    });
  });

  it("uses canonical defaults when Spaced Repetition settings are unavailable", async () => {
    const result = await resolveSpacedRepetitionSeparators(makeApp());

    expect(result).toMatchObject({
      basic: DEFAULT_BASIC_SEPARATOR,
      reversed: DEFAULT_REVERSED_SEPARATOR,
      source: "default",
      compatible: true
    });
  });

  it("reports unsafe or identical separators instead of silently changing them", async () => {
    const unsafe = await resolveSpacedRepetitionSeparators(
      makeApp({
        savedData: {
          settings: {
            singleLineCardSeparator: ";",
            singleLineReversedCardSeparator: ":::"
          }
        }
      })
    );
    const identical = await resolveSpacedRepetitionSeparators(
      makeApp({
        savedData: {
          settings: {
            singleLineCardSeparator: "::",
            singleLineReversedCardSeparator: "::"
          }
        }
      })
    );

    expect(unsafe.compatible).toBe(false);
    expect(unsafe.message).toContain("basic");
    expect(identical.compatible).toBe(false);
    expect(identical.message).toContain("must be different");
  });
});

