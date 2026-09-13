import type {
  Flashcard,
  GeneratedFlashcard
} from "../models/flashcard";
import type { PromptPresetId } from "./prompt-presets";
import {
  ANSWER_WARNING_CHARACTERS,
  countCharacters,
  MAX_CARD_FIELD_CHARACTERS,
  QUESTION_WARNING_CHARACTERS
} from "./generation-limits";

export type CardQualityIssue =
  | "not-grounded"
  | "duplicate"
  | "conflict"
  | "too-long"
  | "invalid";

export interface PreviewFlashcard extends GeneratedFlashcard {
  id: string;
  originalQuestion: string;
  originalAnswer: string;
  selected: boolean;
  issues: CardQualityIssue[];
}

export function createPreviewFlashcards(
  cards: GeneratedFlashcard[],
  sourceText: string,
  presetId: PromptPresetId
): PreviewFlashcard[] {
  const previewCards = cards.map((card, index) => ({
    ...card,
    id: `card-${index + 1}`,
    originalQuestion: card.question,
    originalAnswer: card.answer,
    selected: false,
    issues: [] as CardQualityIssue[]
  }));

  refreshPreviewQuality(previewCards, sourceText, presetId, true);
  return previewCards;
}

export function refreshPreviewQuality(
  cards: PreviewFlashcard[],
  sourceText: string,
  presetId: PromptPresetId,
  resetSelection = false
): void {
  const issueSets = analyzeCards(cards, sourceText, presetId);

  cards.forEach((card, index) => {
    const previousIssues = new Set(card.issues);
    card.issues = Array.from(issueSets[index] ?? []);

    if (resetSelection) {
      card.selected = isRecommended(card);
    } else if (
      card.issues.includes("invalid") ||
      card.issues.some(
        (issue) => isSelectionWarning(issue) && !previousIssues.has(issue)
      )
    ) {
      card.selected = false;
    }
  });
}

export function selectRecommendedCards(cards: PreviewFlashcard[]): void {
  for (const card of cards) {
    card.selected = isRecommended(card);
  }
}

export function isCardEdited(card: PreviewFlashcard): boolean {
  return (
    card.question !== card.originalQuestion || card.answer !== card.originalAnswer
  );
}

export function selectedCardsToFlashcards(
  cards: PreviewFlashcard[]
): Flashcard[] {
  return cards
    .filter((card) => card.selected && !card.issues.includes("invalid"))
    .map((card) => ({
      question: card.question.trim(),
      answer: card.answer.trim()
    }));
}

export function normalizeForEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function normalizeCardFront(value: string): string {
  return normalizeForEvidence(value)
    .replace(/[?!.,:;…]+$/u, "")
    .trim();
}

function analyzeCards(
  cards: PreviewFlashcard[],
  sourceText: string,
  presetId: PromptPresetId
): Array<Set<CardQualityIssue>> {
  const normalizedSource = normalizeForEvidence(sourceText);
  const issueSets = cards.map((card) => {
    const issues = new Set<CardQualityIssue>();
    const question = card.question.trim();
    const answer = card.answer.trim();
    const evidence = normalizeForEvidence(card.evidence);

    if (!question || !answer ||
        countCharacters(question) > MAX_CARD_FIELD_CHARACTERS ||
        countCharacters(answer) > MAX_CARD_FIELD_CHARACTERS) {
      issues.add("invalid");
    }

    const evidenceFound = evidence.length > 0 && normalizedSource.includes(evidence);
    const normalizedFront = normalizeCardFront(question);
    const englishEvidenceContainsFront =
      presetId !== "english-translation" ||
      (normalizedFront.length > 0 && evidence.includes(normalizedFront));

    if (!evidenceFound || !englishEvidenceContainsFront) {
      issues.add("not-grounded");
    }

    if (
      countCharacters(question) > QUESTION_WARNING_CHARACTERS ||
      countCharacters(answer) > ANSWER_WARNING_CHARACTERS
    ) {
      issues.add("too-long");
    }

    return issues;
  });

  const frontGroups = new Map<string, number[]>();
  cards.forEach((card, index) => {
    const front = normalizeCardFront(card.question);
    if (!front) {
      return;
    }
    const indexes = frontGroups.get(front) ?? [];
    indexes.push(index);
    frontGroups.set(front, indexes);
  });

  for (const indexes of frontGroups.values()) {
    if (indexes.length < 2) {
      continue;
    }

    const answers = new Set(
      indexes.map((index) => normalizeForEvidence(cards[index]?.answer ?? ""))
    );

    if (answers.size > 1) {
      for (const index of indexes) {
        issueSets[index]?.add("conflict");
      }
      continue;
    }

    const preferredIndex = indexes[0];
    for (const index of indexes) {
      if (index !== preferredIndex) {
        issueSets[index]?.add("duplicate");
      }
    }
  }

  return issueSets;
}

function isRecommended(card: PreviewFlashcard): boolean {
  return !card.issues.some(isSelectionWarning);
}

function isSelectionWarning(issue: CardQualityIssue): boolean {
  return (
    issue === "not-grounded" ||
    issue === "duplicate" ||
    issue === "conflict" ||
    issue === "invalid"
  );
}

