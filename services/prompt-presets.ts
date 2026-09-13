export const PROMPT_PRESET_IDS = [
  "notes",
  "english-translation",
  "custom"
] as const;

export type PromptPresetId = (typeof PROMPT_PRESET_IDS)[number];

export interface PromptPresetDefinition {
  id: PromptPresetId;
  name: string;
  description: string;
  template: string;
}

export interface ResolvePromptOptions {
  presetId: PromptPresetId;
  count: number;
  targetLanguage: string;
  customPrompt: string;
}

export const PROMPT_PRESETS: readonly PromptPresetDefinition[] = [
  {
    id: "notes",
    name: "Atomic notes",
    description:
      "Create concise active-recall cards only from knowledge stated in the note.",
    template: `Create up to {{count}} atomic study cards from the source note.

Rules:
1. Use only information explicitly contained in the source note.
2. Test exactly one fact or concept per card.
3. Prefer short active-recall questions and concise answers.
4. Prioritize important definitions, relationships, distinctions, mechanisms, and conditions.
5. Avoid broad, trivial, speculative, duplicate, or near-duplicate cards.
6. Ignore filler and examples that contain no important knowledge.
7. Preserve technical terminology from the source.
8. Use the same language as the source note for questions and answers.
9. Return fewer cards, including zero, when the note contains too little useful knowledge.`
  },
  {
    id: "english-translation",
    name: "English vocabulary and phrases",
    description:
      "Create native bidirectional English ↔ translation cards from useful words and phrases.",
    template: `Create up to {{count}} English/translation pairs for bidirectional vocabulary study from the source note.

Rules:
1. Select useful English words, phrasal verbs, collocations, idioms, and short phrases that occur explicitly in the source note.
2. In every JSON card, put the exact English word or phrase in question and a concise, natural {{targetLanguage}} translation in answer.
3. The plugin saves each pair as one native Spaced Repetition bidirectional card, so it will be reviewed both English → {{targetLanguage}} and {{targetLanguage}} → English.
4. Choose the meaning supported by the surrounding context. You may translate it even when the translation is not written in the note.
5. Test one word, phrase, or meaning per card.
6. Preserve English spelling and meaningful particles or prepositions.
7. Skip proper names, isolated function words, obvious duplicates, and items that are not useful for language learning.
8. Do not add unrelated definitions, examples, usage notes, or facts.
9. The evidence quote must contain the exact English word or phrase used on the front.
10. Do not create a second JSON card with question and answer swapped; one pair already provides both review directions.
11. Return fewer pairs, including zero, when the note contains too little suitable English material.`
  },
  {
    id: "custom",
    name: "Custom prompt",
    description:
      "Use your own instructions while the plugin still enforces question-and-answer JSON output.",
    template: ""
  }
];

export function normalizePromptPresetId(value: unknown): PromptPresetId {
  return typeof value === "string" &&
    PROMPT_PRESET_IDS.includes(value as PromptPresetId)
    ? (value as PromptPresetId)
    : "notes";
}

export function getPromptPreset(
  presetId: PromptPresetId
): PromptPresetDefinition {
  return (
    PROMPT_PRESETS.find((preset) => preset.id === presetId) ??
    PROMPT_PRESETS[0]
  );
}

export function resolvePromptInstructions(
  options: ResolvePromptOptions
): string {
  const preset = getPromptPreset(options.presetId);
  const source =
    options.presetId === "custom" ? options.customPrompt.trim() : preset.template;

  if (!source) {
    throw new Error(
      "Custom prompt is empty. Add it here or in the plugin settings."
    );
  }

  const targetLanguage = options.targetLanguage.trim();
  if (
    source.includes("{{targetLanguage}}") &&
    targetLanguage.length === 0
  ) {
    throw new Error("Target translation language is empty.");
  }

  return source
    .replace(/\{\{count\}\}/g, String(options.count))
    .replace(/\{\{targetLanguage\}\}/g, targetLanguage)
    .trim();
}

