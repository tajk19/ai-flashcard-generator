import { TFile, TFolder } from "obsidian";
import { GenerationWorkflowModal } from "../../ui/generation-modal";
import { createFlashcardDeck } from "../../services/deck-writer";

const sourceFile = new TFile("Study/English.md");
const files = new Map<string, TFile | TFolder>([
  [sourceFile.path, sourceFile], ["Study", new TFolder("Study")]
]);
let savedCount = 0;
let requestCount = 0;
let active = false;
const status = document.getElementById("status")!;
const savedContent = document.getElementById("saved-content")!;
const updateStatus = () => { status.textContent = `Saved decks: ${savedCount}. Requests: ${requestCount}.`; };
const app = {
  vault: {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    getAllLoadedFiles: () => [...files.values()],
    createFolder: async (path: string) => {
      const folder = new TFolder(path); files.set(path, folder); return folder;
    },
    create: async (path: string, content: string) => {
      if (files.has(path)) throw new Error("Simulated collision");
      const file = new TFile(path); files.set(path, file);
      savedCount += 1; savedContent.textContent = content; updateStatus(); return file;
    }
  },
  fileManager: { generateMarkdownLink: (file: TFile) => `[[${file.path}]]` }
};

document.getElementById("open-workflow")!.addEventListener("click", async () => {
  if (active) return;
  active = true;
  const count = Number((document.getElementById("card-count") as HTMLSelectElement).value);
  const delay = Number((document.getElementById("delay") as HTMLSelectElement).value);
  const fixtures = [
    { question: "break the ice", answer: "разрядить обстановку", evidence: "break the ice — разрядить обстановку" },
    { question: "keep in touch", answer: "поддерживать связь", evidence: "keep in touch — поддерживать связь" },
    { question: "on the same page", answer: "одинаково понимать ситуацию", evidence: "this quote is intentionally absent" }
  ];
  const generated = Array.from({ length: count }, (_, index) => index < 3 ? fixtures[index] : {
    question: `sample phrase ${index + 1}`, answer: `учебное выражение ${index + 1}`, evidence: `sample phrase ${index + 1}`
  });
  const source = "break the ice — разрядить обстановку\nkeep in touch — поддерживать связь\non the same page — одинаково понимать ситуацию\n" +
    generated.slice(3).map(card => card.question).join("\n");
  const workflow = new GenerationWorkflowModal(app as never, {
    source: { fileName: sourceFile.name, text: source, scope: "selection" },
    outputFileName: "English practice",
    outputFolder: "Flashcards",
    deckTag: "flashcards/english",
    basicSeparator: "::",
    reversedSeparator: ":::",
    separatorsLocked: true,
    separatorDescription: "Simulated Spaced Repetition settings.",
    promptPresetId: "english-translation",
    targetLanguage: "Russian",
    customPrompt: "",
    cardCount: count
  }, {
    generate: async () => {
      requestCount += 1; updateStatus();
      // Intentionally resolves even after close, to exercise late-response rejection.
      await new Promise(resolve => setTimeout(resolve, delay));
      return generated;
    },
    save: async (request, cards, signal) => createFlashcardDeck(app as never, {
      sourceFile: sourceFile as never, cards,
      outputFolder: request.outputFolder,
      outputFileName: request.outputFileName,
      deckTag: request.deckTag,
      cardSeparator: request.promptPresetId === "english-translation" ? request.reversedSeparator : request.basicSeparator,
      reservedSeparators: [request.basicSeparator, request.reversedSeparator], signal
    }),
    isPluginUnloaded: () => false
  });
  await workflow.openAndWait();
  active = false;
  updateStatus();
});

