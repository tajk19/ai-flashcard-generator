import { describe, expect, it } from "vitest";
import {
  normalizeDeckTag,
  normalizeOutputFileName,
  normalizeOutputFolder,
  renderDeckMarkdown,
  sanitizeFileName,
  suggestOutputFileName,
  validateDeckTagSeparator
} from "../services/deck-format";

describe("deck formatting helpers", () => {
  it("validates Unicode filename bytes before a request can be sent", () => {
    expect(normalizeOutputFileName("я".repeat(120))).toBe("я".repeat(120));
    expect(() => normalizeOutputFileName("я".repeat(121))).toThrow("240 UTF-8 bytes");
    expect(() => normalizeOutputFolder("学习".repeat(43))).toThrow("255 UTF-8 bytes");
    expect(() => normalizeOutputFolder(".obsidian/plugins")).toThrow("invalid path segment");
    expect(() => normalizeOutputFileName(".hidden")).toThrow("hidden");
  });
  it("normalizes vault folders and rejects traversal", () => {
    expect(normalizeOutputFolder(" /Flashcards\\C++/ ")).toBe("Flashcards/C++");
    expect(normalizeOutputFolder("Flashcards / C++")).toBe("Flashcards/C++");
    expect(normalizeOutputFolder("   ")).toBe("");
    expect(() => normalizeOutputFolder("Flashcards/../Private")).toThrow(
      "invalid path segment"
    );
    expect(() => normalizeOutputFolder("Flashcards/bad:name")).toThrow(
      "invalid path segment"
    );
  });

  it("preserves the user's exact valid root tag", () => {
    expect(normalizeDeckTag("#flashcards/programming/cpp")).toBe(
      "flashcards/programming/cpp"
    );
    expect(normalizeDeckTag(" programming / cpp ")).toBe("programming/cpp");
    expect(normalizeDeckTag("#languages/english")).toBe("languages/english");
    expect(() => normalizeDeckTag(" ")).toThrow("Enter a Spaced Repetition");
    expect(() => normalizeDeckTag("programming/C++")).toThrow(
      "only letters, numbers"
    );
    expect(() => normalizeDeckTag("123/456")).toThrow("non-numeric");
  });

  it("creates a Windows-safe filename", () => {
    expect(sanitizeFileName("std::unique_ptr")).toBe("std unique_ptr");
    expect(sanitizeFileName("  ...  ")).toBe("Untitled");
    expect(sanitizeFileName(`${"a".repeat(179)}.more`)).toBe("a".repeat(179));
    expect(sanitizeFileName(`${"a".repeat(179)}😀tail`)).toBe(
      `${"a".repeat(179)}😀`
    );
    expect(sanitizeFileName("CON")).toBe("CON - Flashcards");
  });

  it("normalizes a user-supplied deck filename", () => {
    expect(normalizeOutputFileName("  English phrases.md ")).toBe(
      "English phrases"
    );
    expect(() => normalizeOutputFileName("C++: basics")).toThrow(
      "not allowed"
    );
    expect(() => normalizeOutputFileName("CON")).toThrow("reserved");
    expect(suggestOutputFileName("Smart pointers")).toBe(
      "Smart pointers - Flashcards"
    );
    expect(() => normalizeOutputFileName(" ... ")).toThrow("cannot end");
    expect(() => normalizeOutputFolder("Flashcards/CON")).toThrow(
      "invalid path segment"
    );
  });

  it("renders a Spaced Repetition deck with source attribution", () => {
    const markdown = renderDeckMarkdown({
      title: "Smart pointers",
      deckTag: "flashcards/programming/cpp",
      sourceLink: "[[Notes/Smart pointers|Smart pointers]]",
      cards: [{ question: "Can it be copied?", answer: "No." }]
    });

    expect(markdown).toBe(
      "# Smart pointers\n\n" +
        "#flashcards/programming/cpp\n\n" +
        "<!-- AI Flashcard Generator source --> Source: [[Notes/Smart pointers|Smart pointers]]\n\n" +
        "## Flashcards\n\n" +
        "Can it be copied?::No.\n"
    );
  });

  it("does not turn a source title into another deck tag", () => {
    const markdown = renderDeckMarkdown({
      title: "Notes about #flashcards/private",
      deckTag: "flashcards/generated",
      sourceLink: "[[Source]]",
      cards: [{ question: "Q?", answer: "A." }]
    });

    expect(markdown).toContain("# Notes about &num;flashcards/private");
    expect(markdown.match(/#flashcards\//g)).toHaveLength(1);
  });

  it("renders a deck with a custom basic-card separator", () => {
    const markdown = renderDeckMarkdown({
      title: "C++",
      deckTag: "study/cpp",
      sourceLink: "[[C++]]",
      cards: [
        {
          question: "What is std::unique_ptr => ownership?",
          answer: "Unique ownership."
        }
      ],
      cardSeparator: "=>"
    });

    expect(markdown).toContain("#study/cpp");
    expect(markdown).toContain(
      "What is std::unique_ptr &#61;&#62; ownership?=>Unique ownership."
    );
    expect(markdown).not.toContain("#flashcards/study/cpp");
  });

  it("renders one native bidirectional line and escapes the basic separator", () => {
    const markdown = renderDeckMarkdown({
      title: "English pairs",
      deckTag: "languages/english",
      sourceLink: "[[Source]]",
      cards: [
        {
          question: "std::move",
          answer: "передать владение"
        }
      ],
      cardSeparator: ":::",
      reservedSeparators: ["::", ":::"]
    });

    expect(markdown).toContain(
      "std&#58;&#58;move:::передать владение"
    );
    expect(markdown).not.toContain("передать владение:::std");
  });

  it("escapes the selected separator in titles and rejects a tag collision", () => {
    const markdown = renderDeckMarkdown({
      title: "Deck => reviewed",
      deckTag: "study/cpp",
      sourceLink: "[[Source => note]]",
      cards: [{ question: "Q?", answer: "A." }],
      cardSeparator: "=>"
    });

    expect(markdown).toContain("# Deck &#61;&#62; reviewed");
    expect(markdown).toContain(
      "<!-- AI Flashcard Generator source --> Source: [[Source => note]]"
    );
    expect(() => validateDeckTagSeparator("study-cpp", "-")).toThrow(
      "cannot contain"
    );
  });
});

