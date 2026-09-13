import { App, normalizePath, TFile, TFolder } from "obsidian";
import type { Flashcard } from "../models/flashcard";
import {
  normalizeDeckTag,
  normalizeOutputFileName,
  normalizeOutputFolder,
  renderDeckMarkdown,
  validateDeckTagSeparator
} from "./deck-format";
import { normalizeBasicSeparator } from "./flashcard-generator";
import { validateCardFieldLength } from "./generation-limits";

export interface CreateDeckOptions {
  sourceFile: TFile;
  cards: Flashcard[];
  outputFolder: string;
  outputFileName: string;
  deckTag: string;
  cardSeparator: string;
  reservedSeparators?: readonly string[];
  signal?: AbortSignal;
}

export interface DeckDestination {
  folder: string;
  baseName: string;
  path: string;
}

export class DeckWriteCancelledError extends Error {
  constructor() {
    super("Flashcard deck creation was cancelled.");
    this.name = "DeckWriteCancelledError";
  }
}

export async function createFlashcardDeck(
  app: App,
  options: CreateDeckOptions
): Promise<TFile> {
  throwIfCancelled(options.signal);
  if (options.cards.length === 0) {
    throw new Error("Cannot create an empty flashcard deck.");
  }
  for (const card of options.cards) {
    validateCardFieldLength("question", card.question);
    validateCardFieldLength("answer", card.answer);
    if (!card.question.trim() || !card.answer.trim()) {
      throw new Error("Card questions and answers cannot be empty.");
    }
  }

  const requestedFolder = normalizeOutputFolder(options.outputFolder);
  validateDestinationFolder(app, requestedFolder);
  const requestedBaseName = normalizeOutputFileName(options.outputFileName);
  const deckTag = normalizeDeckTag(options.deckTag);
  const cardSeparator = normalizeBasicSeparator(options.cardSeparator);
  const reservedSeparators = (options.reservedSeparators ?? []).map(
    normalizeBasicSeparator
  );
  validateDeckTagSeparator(deckTag, cardSeparator);
  for (const separator of reservedSeparators) {
    validateDeckTagSeparator(deckTag, separator);
  }
  // Validate all content before any folder or file creation.
  renderDeckMarkdown({ title: requestedBaseName, deckTag, sourceLink: "",
    cards: options.cards, cardSeparator, reservedSeparators });
  let folder = resolveFolderPath(app, requestedFolder);
  folder = await ensureFolderExists(app, folder, options.signal);

  let startIndex = 1;
  while (startIndex <= 9999) {
    throwIfCancelled(options.signal);
    const destination = findAvailableDestination(
      app,
      folder,
      requestedBaseName,
      startIndex
    );
    const sourceLink = app.fileManager.generateMarkdownLink(
      options.sourceFile,
      destination.path
    );
    const content = renderDeckMarkdown({
      title: destination.baseName,
      deckTag,
      sourceLink,
      cards: options.cards,
      cardSeparator,
      reservedSeparators
    });

    try {
      throwIfCancelled(options.signal);
      return await app.vault.create(destination.path, content);
    } catch (error) {
      throwIfCancelled(options.signal);
      if (!pathExists(app, destination.path)) {
        throw error;
      }
      startIndex = destination.index + 1;
    }
  }

  throw new Error("Could not find an available filename for the flashcard deck.");
}

export function previewFlashcardDeckPath(
  app: App,
  options: Pick<CreateDeckOptions, "outputFolder" | "outputFileName">
): DeckDestination {
  validateDestinationFolder(app, normalizeOutputFolder(options.outputFolder));
  const folder = resolveFolderPath(
    app,
    normalizeOutputFolder(options.outputFolder)
  );
  const baseName = normalizeOutputFileName(options.outputFileName);
  const destination = findAvailableDestination(app, folder, baseName, 1);
  return {
    folder: destination.folder,
    baseName: destination.baseName,
    path: destination.path
  };
}

function validateDestinationFolder(app: App, folder: string): void {
  const configDir = normalizePath(app.vault.configDir ?? ".obsidian").toLowerCase();
  const destination = normalizePath(folder).toLowerCase();
  if (destination === configDir || destination.startsWith(`${configDir}/`)) {
    throw new Error("Choose a notes folder outside the Obsidian configuration directory.");
  }
}

async function ensureFolderExists(
  app: App,
  folder: string,
  signal?: AbortSignal
): Promise<string> {
  if (!folder) {
    return "";
  }

  let current = "";
  for (const segment of folder.split("/")) {
    throwIfCancelled(signal);
    const requestedPath = current ? `${current}/${segment}` : segment;
    const existing = getAbstractFileCaseInsensitive(app, requestedPath);

    if (existing instanceof TFile) {
      throw new Error(`Cannot create folder because ${requestedPath} is a file.`);
    }

    if (existing instanceof TFolder) {
      current = existing.path;
    } else {
      try {
        await app.vault.createFolder(requestedPath);
      } catch (error) {
        const racedFolder = getAbstractFileCaseInsensitive(app, requestedPath);
        if (!(racedFolder instanceof TFolder)) {
          throw error;
        }
        current = racedFolder.path;
        continue;
      }
      const createdFolder = getAbstractFileCaseInsensitive(app, requestedPath);
      current =
        createdFolder instanceof TFolder ? createdFolder.path : requestedPath;
    }
  }

  return current;
}

function resolveFolderPath(app: App, folder: string): string {
  if (!folder) {
    return "";
  }

  let current = "";
  for (const segment of folder.split("/")) {
    const requestedPath = current ? `${current}/${segment}` : segment;
    const existing = getAbstractFileCaseInsensitive(app, requestedPath);
    if (existing instanceof TFile) {
      throw new Error(`Cannot create folder because ${requestedPath} is a file.`);
    }
    current = existing instanceof TFolder ? existing.path : requestedPath;
  }

  return current;
}

function findAvailableDestination(
  app: App,
  folder: string,
  requestedBaseName: string,
  startIndex: number
): DeckDestination & { index: number } {
  for (let index = startIndex; index <= 9999; index += 1) {
    const suffix = index === 1 ? "" : ` (${index})`;
    const baseName = `${requestedBaseName}${suffix}`;
    const fileName = `${baseName}.md`;
    const path = normalizePath(folder ? `${folder}/${fileName}` : fileName);

    if (!pathExists(app, path)) {
      return { folder, baseName, path, index };
    }
  }

  throw new Error("Could not find an available filename for the flashcard deck.");
}

function pathExists(app: App, path: string): boolean {
  return getAbstractFileCaseInsensitive(app, path) !== null;
}

function getAbstractFileCaseInsensitive(
  app: App,
  path: string
): TFile | TFolder | null {
  const direct = app.vault.getAbstractFileByPath(path);
  if (direct instanceof TFile || direct instanceof TFolder) {
    return direct;
  }

  const normalized = normalizePath(path).toLowerCase();
  const match = app.vault
    .getAllLoadedFiles()
    .find((file) => file.path.toLowerCase() === normalized);
  return match instanceof TFile || match instanceof TFolder ? match : null;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DeckWriteCancelledError();
  }
}

