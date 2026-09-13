export const MAX_SOURCE_CHARACTERS = 100_000;
export const MAX_CUSTOM_PROMPT_CHARACTERS = 8_000;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_CARD_FIELD_CHARACTERS = 2_000;
export const QUESTION_WARNING_CHARACTERS = 300;
export const ANSWER_WARNING_CHARACTERS = 500;
export const MAX_OUTPUT_TOKENS = 8_192;

export function countCharacters(value: string): number {
  return Array.from(value).length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function validateSourceText(value: string): void {
  if (!value.trim()) {
    throw new Error("The selected source text is empty.");
  }

  const length = countCharacters(value);
  if (length > MAX_SOURCE_CHARACTERS) {
    throw new Error(
      `The source contains ${length.toLocaleString()} characters. Select a smaller fragment (maximum ${MAX_SOURCE_CHARACTERS.toLocaleString()}).`
    );
  }
}

export function validateCustomPrompt(value: string): void {
  const length = countCharacters(value);
  if (length > MAX_CUSTOM_PROMPT_CHARACTERS) {
    throw new Error(
      `The custom prompt contains ${length.toLocaleString()} characters. The maximum is ${MAX_CUSTOM_PROMPT_CHARACTERS.toLocaleString()}.`
    );
  }
}

export function validateGenerationInstructions(value: string): void {
  const length = countCharacters(value);
  if (length > MAX_CUSTOM_PROMPT_CHARACTERS) {
    throw new Error(
      `The resolved generation prompt contains ${length.toLocaleString()} characters. The maximum is ${MAX_CUSTOM_PROMPT_CHARACTERS.toLocaleString()}. Shorten the custom prompt or its variable values.`
    );
  }
}

export function validateResponseTextSize(value: string): void {
  if (utf8ByteLength(value) > MAX_RESPONSE_BYTES) {
    throw new Error("Gemini returned a JSON response larger than 1 MiB.");
  }
}

export function validateCardFieldLength(
  fieldName: "question" | "answer" | "evidence",
  value: string
): void {
  if (countCharacters(value) > MAX_CARD_FIELD_CHARACTERS) {
    throw new Error(
      `Gemini returned a ${fieldName} longer than ${MAX_CARD_FIELD_CHARACTERS.toLocaleString()} characters.`
    );
  }
}

