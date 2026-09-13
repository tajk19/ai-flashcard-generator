export interface Flashcard {
  question: string;
  answer: string;
}

export interface GeneratedFlashcard extends Flashcard {
  evidence: string;
}

export interface FlashcardResponse {
  cards: GeneratedFlashcard[];
}

export interface GenerateFlashcardsOptions {
  apiKey: string;
  model: string;
  note: string;
  count: number;
  instructions: string;
  signal?: AbortSignal;
}

