import { describe, expect, it } from "vitest";
import {
  buildFlashcardPrompt,
  buildFlashcardSchema,
  cardsToMarkdown,
  clampCardCount,
  escapeSingleLineSeparator,
  normalizeBasicSeparator,
  normalizeCardText,
  toSafeInlineMarkdown,
  validateFlashcardResponse
} from "../services/flashcard-generator";

describe("flashcard generation helpers", () => {
  it("clamps requested card counts", () => {
    expect(clampCardCount(-5)).toBe(1);
    expect(clampCardCount(12.6)).toBe(13);
    expect(clampCardCount(500)).toBe(50);
    expect(clampCardCount(Number.NaN)).toBe(10);
  });

  it("builds a prompt that keeps the note and requested limit", () => {
    const prompt = buildFlashcardPrompt(
      "TCP is connection-oriented.",
      7,
      "Use the same language as the note."
    );

    expect(prompt).toContain("no more than 7");
    expect(prompt).toContain("<generation_instructions>");
    expect(prompt).toContain("Use the same language as the note.");
    expect(prompt).toContain("<source_note>");
    expect(prompt).toContain("TCP is connection-oriented.");
  });

  it("rejects empty generation instructions", () => {
    expect(() => buildFlashcardPrompt("Some note", 5, "  ")).toThrow(
      "instructions are empty"
    );
  });

  it("does not force the schema to invent at least one card", () => {
    const schema = buildFlashcardSchema(8);
    const cards = (schema.properties as Record<string, unknown>).cards as Record<
      string,
      unknown
    >;
    const item = cards.items as Record<string, unknown>;

    expect(cards.maxItems).toBe(8);
    expect(cards).not.toHaveProperty("minItems");
    expect(item.required).toEqual(["question", "answer", "evidence"]);
  });

  it("normalizes whitespace without changing technical syntax", () => {
    expect(normalizeCardText("  What is\n std::move?  ")).toBe(
      "What is std::move?"
    );
  });

  it("escapes internal separators while keeping the card delimiter unique", () => {
    expect(escapeSingleLineSeparator("std::unique_ptr"))
      .toBe("std&#58;&#58;unique_ptr");

    expect(
      cardsToMarkdown([
        {
          question: "What does std::unique_ptr provide?",
          answer: "Ownership via std::move."
        }
      ])
    ).toBe(
      "What does std&#58;&#58;unique_ptr provide?::Ownership via std&#58;&#58;move."
    );

    expect(escapeSingleLineSeparator("Use `std::move` here.")).toBe(
      "Use <code>std&#58;&#58;move</code> here."
    );
  });

  it("uses a literal custom separator without breaking C++ scope syntax", () => {
    expect(
      cardsToMarkdown(
        [
          {
            question: "What does std::unique_ptr => own?",
            answer: "One object via std::move."
          }
        ],
        "=>"
      )
    ).toBe(
      "What does std::unique_ptr &#61;&#62; own?=>One object via std::move."
    );

    expect(normalizeBasicSeparator(" ::: ")).toBe(":::");
    expect(normalizeBasicSeparator("=>")).toBe("=>");
    expect(normalizeBasicSeparator(";;")).toBe(";;");
    expect(() => normalizeBasicSeparator(" ")).toThrow("cannot be empty");
    expect(() => normalizeBasicSeparator("bad sep")).toThrow(
      "short visible literal"
    );
    expect(() => normalizeBasicSeparator("&")).toThrow("punctuation");
    expect(() => normalizeBasicSeparator("#")).toThrow("punctuation");
    expect(() => normalizeBasicSeparator(";")).toThrow("escaped safely");
  });

  it("serializes one English pair as one native bidirectional card", () => {
    const markdown = cardsToMarkdown(
      [
        {
          question: "break the ice",
          answer: "разрядить обстановку"
        }
      ],
      ":::"
    );

    expect(markdown).toBe("break the ice:::разрядить обстановку");
    expect(markdown).not.toContain("разрядить обстановку:::break the ice");
  });

  it("escapes both configured inline separators in bidirectional content", () => {
    expect(
      cardsToMarkdown(
        [
          {
            question: "What does std::move mean?",
            answer: "передать владение"
          }
        ],
        ":::",
        ["::", ":::"]
      )
    ).toBe("What does std&#58;&#58;move mean?:::передать владение");

    expect(
      cardsToMarkdown([{ question: "Question:", answer: ":Answer" }], ":::")
    ).toBe("Question:<wbr>:::<wbr>:Answer");
  });

  it("prevents content boundaries from creating a reversed-card delimiter", () => {
    const questionBoundary = cardsToMarkdown([
      { question: "Question:", answer: "Answer" }
    ]);
    const answerBoundary = cardsToMarkdown([
      { question: "Question", answer: ":Answer" }
    ]);

    expect(questionBoundary).toBe("Question:<wbr>::Answer");
    expect(answerBoundary).toBe("Question::<wbr>:Answer");
    expect(questionBoundary).not.toContain(":::");
    expect(answerBoundary).not.toContain(":::");
  });

  it("isolates competing custom separators at both card boundaries", () => {
    expect(cardsToMarkdown(
      [{ question: "What?", answer: "Answer" }], "::", ["::", "?::"]
    )).toBe("What?<wbr>::Answer");
    expect(cardsToMarkdown(
      [{ question: "What", answer: "?Answer" }], "::", ["::", "::?"]
    )).toBe("What::<wbr>?Answer");
    expect(cardsToMarkdown(
      [{ question: "What?", answer: "!Answer" }], "::", ["::", "?::!"]
    )).toBe("What?<wbr>::<wbr>!Answer");
    expect(cardsToMarkdown(
      [{ question: "English", answer: "Translation" }], ":::", ["::", ":::"]
    )).toBe("English:::Translation");
  });

  it("neutralizes active Markdown while preserving visible text", () => {
    const navigation = toSafeInlineMarkdown("[Run](obsidian://advanced-uri?vault=Private) [[Private note]] <script>alert(1)</script>");
    expect(navigation).not.toContain("[Run]");
    expect(navigation).not.toContain("[[Private");
    expect(navigation).not.toContain("<script>");
    expect(navigation).toContain("&#91;Run&#93;");
    expect(toSafeInlineMarkdown("#flashcards/other <img src=x> ![](https://x)"))
      .toBe("&num;flashcards/other &lt;img src=x&gt; &excl;&#91;&#93;(https://x)");
    expect(toSafeInlineMarkdown("## Heading")).toBe("\\## Heading");
    expect(toSafeInlineMarkdown("Use `#flashcards/x` literally")).toBe(
      "Use <code>&num;flashcards/x</code> literally"
    );
    expect(toSafeInlineMarkdown("`![](https://x)` `![[Secret]]`")).toBe(
      "<code>&excl;[](https://x)</code> <code>&excl;[[Secret]]</code>"
    );

    for (let slashes = 0; slashes <= 3; slashes += 1) {
      const prefix = "\\".repeat(slashes);
      expect(toSafeInlineMarkdown(`${prefix}![](https://x)`)).toBe(
        "&excl;&#91;&#93;(https://x)"
      );
      expect(toSafeInlineMarkdown(`${prefix}#flashcards/x`)).toBe(
        "&num;flashcards/x"
      );
    }
  });

  it("normalizes structurally valid cards while preserving duplicates for preview", () => {
    const result = validateFlashcardResponse(
      {
        cards: [
          { question: " Q1? ", answer: " A1 ", evidence: " Evidence 1 " },
          { question: "Q1?", answer: "A1", evidence: "Evidence 1" },
          {
            question: "",
            answer: "Empty question",
            evidence: "Evidence 2"
          },
          { question: "Q2?", answer: "A2", evidence: "Evidence 2" }
        ]
      },
      10
    );

    expect(result.cards).toEqual([
      { question: "Q1?", answer: "A1", evidence: "Evidence 1" },
      { question: "Q1?", answer: "A1", evidence: "Evidence 1" },
      { question: "", answer: "Empty question", evidence: "Evidence 2" },
      { question: "Q2?", answer: "A2", evidence: "Evidence 2" }
    ]);
  });

  it("rejects structurally malformed cards", () => {
    expect(() =>
      validateFlashcardResponse(
        {
          cards: [{ question: "Missing answer", evidence: "Evidence" }]
        },
        10
      )
    ).toThrow("invalid card at position 1");
  });

  it("allows a valid empty result and rejects oversized card arrays", () => {
    expect(validateFlashcardResponse({ cards: [] }, 10)).toEqual({ cards: [] });

    expect(() =>
      validateFlashcardResponse(
        {
          cards: [
            { question: "Q1", answer: "A1", evidence: "E1" },
            { question: "Q2", answer: "A2", evidence: "E2" }
          ]
        },
        1
      )
    ).toThrow("more than the requested maximum");
  });

  it("rejects a response without a cards array", () => {
    expect(() => validateFlashcardResponse({ result: [] }, 10)).toThrow(
      "cards array"
    );
  });

  it("rejects generated fields over the hard 2,000-character limit", () => {
    expect(() =>
      validateFlashcardResponse(
        {
          cards: [
            {
              question: "Q".repeat(2_001),
              answer: "A",
              evidence: "E"
            }
          ]
        },
        10
      )
    ).toThrow(/question longer than 2.000 characters/u);
  });
});

