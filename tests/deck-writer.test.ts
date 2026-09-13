import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

const { MockTFile, MockTFolder } = vi.hoisted(() => {
  class File {
    path: string;
    name: string;
    basename: string;
    extension: string;

    constructor(path: string) {
      this.path = path;
      const pathSegments = path.split("/");
      this.name = pathSegments[pathSegments.length - 1] ?? path;
      this.extension = this.name.includes(".")
        ? (this.name.split(".").pop() ?? "")
        : "";
      this.basename = this.extension
        ? this.name.slice(0, -(this.extension.length + 1))
        : this.name;
    }
  }

  class Folder {
    path: string;
    name: string;

    constructor(path: string) {
      this.path = path;
      const pathSegments = path.split("/");
      this.name = pathSegments[pathSegments.length - 1] ?? path;
    }
  }

  return { MockTFile: File, MockTFolder: Folder };
});

vi.mock("obsidian", () => ({
  TFile: MockTFile,
  TFolder: MockTFolder,
  normalizePath: (value: string) =>
    value.replace(/\\/g, "/").replace(/\/{2,}/g, "/")
}));

import {
  createFlashcardDeck,
  DeckWriteCancelledError,
  previewFlashcardDeckPath
} from "../services/deck-writer";

type MockAbstractFile =
  | InstanceType<typeof MockTFile>
  | InstanceType<typeof MockTFolder>;

function createMockApp(initialFiles: MockAbstractFile[]): {
  app: App;
  files: MockAbstractFile[];
  writes: Array<{ path: string; content: string }>;
} {
  const files = [...initialFiles];
  const writes: Array<{ path: string; content: string }> = [];
  const vault = {
    getAbstractFileByPath: vi.fn(
      (path: string) => files.find((file) => file.path === path) ?? null
    ),
    getAllLoadedFiles: vi.fn(() => files),
    createFolder: vi.fn(async (path: string) => {
      const folder = new MockTFolder(path);
      files.push(folder);
      return folder;
    }),
    create: vi.fn(async (path: string, content: string) => {
      const file = new MockTFile(path);
      files.push(file);
      writes.push({ path, content });
      return file;
    })
  };
  const app = {
    vault,
    fileManager: {
      generateMarkdownLink: vi.fn(
        (source: InstanceType<typeof MockTFile>) =>
          `[[${source.path.replace(/\.md$/i, "")}]]`
      )
    }
  };

  return { app: app as unknown as App, files, writes };
}

describe("deck destination and race-safe writing", () => {
  it("rejects config-directory output and oversized edited cards before any write", async () => {
    const { app } = createMockApp([]);
    Object.assign(app.vault, { configDir: "config" });
    expect(() => previewFlashcardDeckPath(app, {
      outputFolder: "config/plugins", outputFileName: "Deck"
    })).toThrow("configuration directory");
    await expect(createFlashcardDeck(app, {
      sourceFile: new MockTFile("Source.md") as never,
      cards: [{ question: "Q", answer: "a".repeat(2001) }],
      outputFolder: "Cards", outputFileName: "Deck", deckTag: "flashcards", cardSeparator: "::"
    })).rejects.toThrow("answer longer than");
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
  });
  it("previews the next suffix using case-insensitive vault collisions", () => {
    const { app } = createMockApp([
      new MockTFolder("Flashcards"),
      new MockTFile("Flashcards/Deck.md"),
      new MockTFile("flashcards/deck (2).MD")
    ]);

    expect(
      previewFlashcardDeckPath(app, {
        outputFolder: "Flashcards",
        outputFileName: "Deck"
      })
    ).toEqual({
      folder: "Flashcards",
      baseName: "Deck (3)",
      path: "Flashcards/Deck (3).md"
    });
  });

  it("uses the real casing of an existing destination folder", () => {
    const { app } = createMockApp([new MockTFolder("flashcards")]);

    expect(
      previewFlashcardDeckPath(app, {
        outputFolder: "Flashcards",
        outputFileName: "Deck"
      })
    ).toEqual({
      folder: "flashcards",
      baseName: "Deck",
      path: "flashcards/Deck.md"
    });
  });

  it("rejects invalid folders and filenames during preflight", () => {
    const { app } = createMockApp([]);

    expect(() =>
      previewFlashcardDeckPath(app, {
        outputFolder: "Flashcards/../Private",
        outputFileName: "Deck"
      })
    ).toThrow("invalid path segment");
    expect(() =>
      previewFlashcardDeckPath(app, {
        outputFolder: "Flashcards",
        outputFileName: "..."
      })
    ).toThrow("cannot end");
  });

  it("rejects a destination folder whose ancestor is a file", () => {
    const { app } = createMockApp([new MockTFile("Flashcards")]);

    expect(() =>
      previewFlashcardDeckPath(app, {
        outputFolder: "Flashcards/English",
        outputFileName: "Deck"
      })
    ).toThrow("Flashcards is a file");
  });

  it("retries a raced filename and keeps the Markdown title in sync", async () => {
    const fixture = createMockApp([new MockTFolder("Flashcards")]);
    const vault = fixture.app.vault;
    let firstCreate = true;
    vi.mocked(vault.create).mockImplementation(
      async (path: string, content: string) => {
        if (firstCreate) {
          firstCreate = false;
          fixture.files.push(new MockTFile(path));
          throw new Error("File already exists");
        }

        const file = new MockTFile(path);
        fixture.files.push(file);
        fixture.writes.push({ path, content });
        return file as never;
      }
    );

    const created = await createFlashcardDeck(fixture.app, {
      sourceFile: new MockTFile("Notes/Source.md") as never,
      cards: [
        {
          question: "What is std::unique_ptr => ownership?",
          answer: "Unique ownership."
        }
      ],
      outputFolder: "Flashcards",
      outputFileName: "Deck",
      deckTag: "study/cpp",
      cardSeparator: "=>"
    });

    expect(created.path).toBe("Flashcards/Deck (2).md");
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0]?.content).toContain("# Deck (2)\n");
    expect(fixture.writes[0]?.content).toContain("#study/cpp");
    expect(fixture.writes[0]?.content).toContain(
      "std::unique_ptr &#61;&#62; ownership?=>Unique ownership."
    );
  });

  it("writes English pairs with the reversed separator only once", async () => {
    const fixture = createMockApp([new MockTFolder("Flashcards")]);

    await createFlashcardDeck(fixture.app, {
      sourceFile: new MockTFile("Notes/English.md") as never,
      cards: [
        {
          question: "break the ice",
          answer: "разрядить обстановку"
        }
      ],
      outputFolder: "Flashcards",
      outputFileName: "English pairs",
      deckTag: "languages/english",
      cardSeparator: ":::",
      reservedSeparators: ["::", ":::"]
    });

    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0]?.content).toContain(
      "break the ice:::разрядить обстановку"
    );
    expect(fixture.writes[0]?.content).not.toContain(
      "разрядить обстановку:::break the ice"
    );
  });

  it("does not create folders or files when saving was cancelled", async () => {
    const fixture = createMockApp([]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      createFlashcardDeck(fixture.app, {
        sourceFile: new MockTFile("Notes/Source.md") as never,
        cards: [{ question: "Q?", answer: "A." }],
        outputFolder: "Flashcards",
        outputFileName: "Deck",
        deckTag: "study",
        cardSeparator: "::",
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(DeckWriteCancelledError);
    expect(fixture.app.vault.createFolder).not.toHaveBeenCalled();
    expect(fixture.app.vault.create).not.toHaveBeenCalled();
  });
});

