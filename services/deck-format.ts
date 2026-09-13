import type { Flashcard } from "../models/flashcard";
import { cardsToMarkdown, toSafeInlineMarkdown } from "./flashcard-generator";
import { utf8ByteLength } from "./generation-limits";

// Keep room for the collision suffix " (9999).md" on filesystems with a
// 255-byte component limit (including typical Linux and Android filesystems).
const MAX_BASENAME_BYTES = 240;

export function normalizeOutputFolder(value: string): string {
  const trimmed = value
    .normalize("NFKC")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return "";
  }

  const rawSegments = trimmed.split("/");
  if (rawSegments.some((segment) => !segment.trim())) {
    throw new Error("Output folder contains an invalid path segment.");
  }

  const segments = rawSegments.map((segment) => segment.trim());
  if (segments.some((segment) => utf8ByteLength(segment) > 255)) {
    throw new Error("An output folder name exceeds 255 UTF-8 bytes. Use a shorter name.");
  }
  if (
    segments.some(
      (segment) =>
        segment.startsWith(".") ||
        /[\u0000-\u001f<>:"|?*]/.test(segment) ||
        /[. ]$/.test(segment) ||
        isWindowsReservedName(segment)
    )
  ) {
    throw new Error("Output folder contains an invalid path segment.");
  }

  return segments.join("/");
}

export function normalizeDeckTag(value: string): string {
  const raw = value.normalize("NFKC").trim().replace(/^#+/, "");
  if (!raw) {
    throw new Error("Enter a Spaced Repetition deck tag.");
  }

  const normalized = raw.replace(/\s*\/\s*/g, "/");
  const segments = normalized.split("/");
  if (
    segments.some((segment) => !segment) ||
    !/^[\p{L}\p{N}_/-]+$/u.test(normalized)
  ) {
    throw new Error(
      "Deck tag may contain only letters, numbers, underscores, hyphens, and slashes."
    );
  }

  if (!/[^\p{N}/]/u.test(normalized)) {
    throw new Error("Deck tag must contain at least one non-numeric character.");
  }

  return normalized;
}

export function validateDeckTagSeparator(
  deckTag: string,
  cardSeparator: string
): void {
  if (deckTag.includes(cardSeparator)) {
    throw new Error(
      "The deck tag cannot contain the selected card separator, or Spaced Repetition would parse the tag line as a card."
    );
  }
}

export function sanitizeFileName(value: string): string {
  const safe = sanitizeFileNameCore(value);
  return safe || "Untitled";
}

export function normalizeOutputFileName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  const withoutExtension = normalized.replace(/\.md$/i, "").trim();

  if (!withoutExtension || withoutExtension === "." || withoutExtension === "..") {
    throw new Error("Enter a file name for the generated deck.");
  }

  if (/[\u0000-\u001f<>:"/\\|?*]/u.test(withoutExtension)) {
    throw new Error("The output file name contains characters that are not allowed.");
  }

  if (/[. ]$/u.test(withoutExtension)) {
    throw new Error("The output file name cannot end with a dot or space.");
  }

  if (isWindowsReservedName(withoutExtension)) {
    throw new Error("The output file name is reserved by the operating system.");
  }
  if (withoutExtension.startsWith(".")) {
    throw new Error("The output file name cannot be hidden.");
  }

  if (Array.from(withoutExtension).length > 180) {
    throw new Error("The output file name cannot exceed 180 characters.");
  }
  if (utf8ByteLength(withoutExtension) > MAX_BASENAME_BYTES) {
    throw new Error("The output file name exceeds 240 UTF-8 bytes. Use a shorter name for Linux and mobile compatibility.");
  }

  return withoutExtension;
}

export function suggestOutputFileName(sourceBaseName: string): string {
  return `${sanitizeFileName(sourceBaseName)} - Flashcards`;
}

function sanitizeFileNameCore(value: string): string {
  let normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();

  normalized = Array.from(normalized)
    .slice(0, 180)
    .join("")
    .replace(/[. ]+$/g, "")
    .trim();

  if (isWindowsReservedName(normalized)) {
    normalized = `${normalized} - Flashcards`;
  }

  return normalized;
}

export function renderDeckMarkdown(options: {
  title: string;
  deckTag: string;
  sourceLink: string;
  cards: Flashcard[];
  cardSeparator?: string;
  reservedSeparators?: readonly string[];
}): string {
  if (options.cardSeparator) {
    validateDeckTagSeparator(options.deckTag, options.cardSeparator);
  }
  for (const separator of options.reservedSeparators ?? []) {
    validateDeckTagSeparator(options.deckTag, separator);
  }
  const title = toSafeInlineMarkdown(
    options.title,
    options.cardSeparator,
    options.reservedSeparators
  );
  const markdown = cardsToMarkdown(
    options.cards,
    options.cardSeparator,
    options.reservedSeparators
  );

  return `# ${title}\n\n#${options.deckTag}\n\n<!-- AI Flashcard Generator source --> Source: ${options.sourceLink}\n\n## Flashcards\n\n${markdown}\n`;
}

function isWindowsReservedName(value: string): boolean {
  const baseName = value.replace(/[. ]+$/g, "").split(".")[0] ?? "";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName);
}

