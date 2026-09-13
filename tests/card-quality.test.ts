import { describe, expect, it } from "vitest";
import type { GeneratedFlashcard } from "../models/flashcard";
import {
  createPreviewFlashcards,
  isCardEdited,
  normalizeForEvidence,
  refreshPreviewQuality,
  selectedCardsToFlashcards
} from "../services/card-quality";

function generated(
  question: string,
  answer: string,
  evidence: string
): GeneratedFlashcard {
  return { question, answer, evidence };
}

describe("flashcard quality validation", () => {
  it("matches evidence after Unicode NFKC, case, and whitespace normalization", () => {
    const source = "The ＴＣＰ protocol is\n\nConnection-Oriented.";
    const cards = createPreviewFlashcards(
      [generated("What kind of protocol is TCP?", "Connection-oriented.", "tcp protocol is connection-oriented")],
      source,
      "notes"
    );

    expect(normalizeForEvidence("  ＴＣＰ\nProtocol  ")).toBe("tcp protocol");
    expect(cards[0]?.issues).not.toContain("not-grounded");
    expect(cards[0]?.selected).toBe(true);
  });

  it("leaves unsupported cards visible but unchecked by default", () => {
    const cards = createPreviewFlashcards(
      [generated("What is UDP?", "Connectionless.", "UDP is connectionless")],
      "TCP is connection-oriented.",
      "notes"
    );

    expect(cards[0]?.issues).toContain("not-grounded");
    expect(cards[0]?.selected).toBe(false);

    if (cards[0]) {
      cards[0].selected = true;
    }
    refreshPreviewQuality(cards, "TCP is connection-oriented.", "notes");
    expect(cards[0]?.selected).toBe(true);
  });

  it("selects only the first exact duplicate", () => {
    const cards = createPreviewFlashcards(
      [
        generated("What does TCP provide?", "Reliable delivery.", "TCP provides reliable delivery"),
        generated("what does tcp provide!", " reliable delivery. ", "TCP provides reliable delivery")
      ],
      "TCP provides reliable delivery.",
      "notes"
    );

    expect(cards[0]?.issues).not.toContain("duplicate");
    expect(cards[0]?.selected).toBe(true);
    expect(cards[1]?.issues).toContain("duplicate");
    expect(cards[1]?.selected).toBe(false);
  });

  it("unselects every card when one normalized question has conflicting answers", () => {
    const cards = createPreviewFlashcards(
      [
        generated("What port does HTTPS use?", "443", "HTTPS uses port 443"),
        generated("what port does https use!", "80", "HTTPS uses port 443")
      ],
      "HTTPS uses port 443.",
      "notes"
    );

    expect(cards.map((card) => card.issues)).toEqual([
      ["conflict"],
      ["conflict"]
    ]);
    expect(cards.map((card) => card.selected)).toEqual([false, false]);
  });

  it("requires English evidence itself to contain the source expression", () => {
    const cards = createPreviewFlashcards(
      [
        generated("break the ice", "разрядить обстановку", "break the ice"),
        generated("start a conversation", "начать разговор", "break the ice")
      ],
      "She told a joke to break the ice.",
      "english-translation"
    );

    expect(cards[0]?.issues).not.toContain("not-grounded");
    expect(cards[0]?.selected).toBe(true);
    expect(cards[1]?.issues).toContain("not-grounded");
    expect(cards[1]?.selected).toBe(false);
  });

  it("marks an empty English front as invalid and not grounded", () => {
    const cards = createPreviewFlashcards(
      [generated("", "перевод", "source expression")],
      "source expression",
      "english-translation"
    );

    expect(cards[0]?.issues).toEqual(["invalid", "not-grounded"]);
    expect(cards[0]?.selected).toBe(false);
  });

  it("unselects newly introduced conflicts but preserves an explicit override", () => {
    const cards = createPreviewFlashcards(
      [
        generated("First question?", "First answer", "First fact"),
        generated("Second question?", "Second answer", "Second fact")
      ],
      "First fact. Second fact.",
      "notes"
    );

    if (cards[1]) {
      cards[1].question = "First question?";
    }
    refreshPreviewQuality(cards, "First fact. Second fact.", "notes");
    expect(cards.map((card) => card.selected)).toEqual([false, false]);

    cards.forEach((card) => {
      card.selected = true;
    });
    refreshPreviewQuality(cards, "First fact. Second fact.", "notes");
    expect(cards.map((card) => card.selected)).toEqual([true, true]);
  });

  it("warns about long cards without automatically excluding them", () => {
    const question = "Q".repeat(301);
    const cards = createPreviewFlashcards(
      [generated(question, "Answer", "Supported statement")],
      "Supported statement",
      "notes"
    );

    expect(cards[0]?.issues).toContain("too-long");
    expect(cards[0]?.selected).toBe(true);
  });

  it("tracks edits and exports only selected non-empty fronts and backs", () => {
    const oversized = createPreviewFlashcards(
      [generated("Q", "A", "fact")], "fact", "notes"
    );
    oversized[0]!.answer = "a".repeat(2001);
    refreshPreviewQuality(oversized, "fact", "notes");
    expect(oversized[0]?.issues).toContain("invalid");
    expect(selectedCardsToFlashcards(oversized)).toEqual([]);
    const cards = createPreviewFlashcards(
      [
        generated("Original?", "Answer", "Original fact"),
        generated("Second?", "Answer", "Second fact")
      ],
      "Original fact. Second fact.",
      "notes"
    );

    if (cards[0]) {
      cards[0].question = "Edited?";
    }
    if (cards[1]) {
      cards[1].answer = "";
    }
    refreshPreviewQuality(cards, "Original fact. Second fact.", "notes");

    expect(cards[0] && isCardEdited(cards[0])).toBe(true);
    expect(cards[1]?.issues).toContain("invalid");
    expect(cards[1]?.selected).toBe(false);
    expect(selectedCardsToFlashcards(cards)).toEqual([
      { question: "Edited?", answer: "Answer" }
    ]);
  });
});

