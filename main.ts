import {
  MarkdownView,
  Notice,
  Plugin,
  type Editor,
  type MarkdownFileInfo
} from "obsidian";
import { createFlashcardDeck } from "./services/deck-writer";
import { suggestOutputFileName } from "./services/deck-format";
import { resolveOutputSeparator } from "./services/card-output";
import {
  GeminiRequestCancelledError,
  generateFlashcards
} from "./services/gemini";
import { normalizeBasicSeparator } from "./services/flashcard-generator";
import { resolvePromptInstructions } from "./services/prompt-presets";
import { parseSettings } from "./services/settings-data";
import { selectSourceText } from "./services/source-text";
import {
  DEFAULT_SPACED_REPETITION_SEPARATORS,
  resolveSpacedRepetitionSeparators,
  type SpacedRepetitionSeparators
} from "./services/spaced-repetition-compat";
import {
  AIFlashcardSettingTab,
  DEFAULT_SETTINGS,
  type AIFlashcardSettings
} from "./settings";
import {
  GenerationWorkflowModal,
  type GenerationRequest,
  type SourceSnapshot
} from "./ui/generation-modal";

export default class AIFlashcardPlugin extends Plugin {
  settings: AIFlashcardSettings = { ...DEFAULT_SETTINGS };
  spacedRepetitionSeparators: SpacedRepetitionSeparators = {
    ...DEFAULT_SPACED_REPETITION_SEPARATORS
  };
  private activeWorkflow: GenerationWorkflowModal | null = null;
  private launchingWorkflow = false;
  private unloaded = false;

  async onload(): Promise<void> {
    this.unloaded = false;
    await this.loadSettings();
    await this.refreshSpacedRepetitionSeparators();
    this.addSettingTab(new AIFlashcardSettingTab(this.app, this));

    this.addCommand({
      id: "generate-flashcards-from-current-note",
      name: "Generate flashcards from current note",
      callback: async () => {
        await this.generateFromActiveEditor();
      }
    });
    this.addRibbonIcon("layers", "Generate flashcards from current note", () => {
      void this.generateFromActiveEditor();
    });
  }

  onunload(): void {
    this.unloaded = true;
    this.activeWorkflow?.cancelAndClose();
    this.activeWorkflow = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async refreshSpacedRepetitionSeparators(): Promise<void> {
    this.spacedRepetitionSeparators =
      await resolveSpacedRepetitionSeparators(this.app);
  }

  private async loadSettings(): Promise<void> {
    this.settings = parseSettings(await this.loadData());
  }

  private async generateFromActiveEditor(): Promise<void> {
    if (this.unloaded) return;
    if (this.launchingWorkflow || this.activeWorkflow) {
      new Notice("Flashcard generation is already open.");
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      new Notice("Open a Markdown note first.");
      return;
    }

    this.launchingWorkflow = true;
    try {
      await this.generateFromEditor(view.editor, view);
    } catch {
      new Notice("Could not open flashcard generation. Check the plugin settings and try again.");
    } finally {
      this.launchingWorkflow = false;
    }
  }

  private async generateFromEditor(
    editor: Editor,
    context: MarkdownFileInfo
  ): Promise<void> {
    if (this.activeWorkflow) {
      new Notice("Flashcard generation is already open.");
      return;
    }

    const file = context.file;
    if (!file || file.extension.toLocaleLowerCase() !== "md") {
      new Notice("Open a Markdown note first.");
      return;
    }

    const apiKey = this.app.secretStorage.getSecret(
      this.settings.geminiApiKeySecretId
    );
    if (!apiKey) {
      new Notice("Select a Gemini API key in AI Flashcard Generator settings.");
      return;
    }

    const selectedSource = selectSourceText(
      editor.getSelection(),
      editor.getValue()
    );
    const source: SourceSnapshot = {
      fileName: file.name,
      text: selectedSource.text,
      scope: selectedSource.scope
    };

    let separators: {
      basic: string;
      reversed: string;
      locked: boolean;
      description: string;
    };
    try {
      separators = await this.resolveWorkflowSeparators();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Invalid card separators.");
      return;
    }
    if (this.unloaded) return;

    const workflow = new GenerationWorkflowModal(
      this.app,
      {
        source,
        outputFileName: suggestOutputFileName(file.basename),
        outputFolder: this.settings.outputFolder,
        deckTag: this.settings.deckTag,
        basicSeparator: separators.basic,
        reversedSeparator: separators.reversed,
        separatorsLocked: separators.locked,
        separatorDescription: separators.description,
        promptPresetId: this.settings.defaultPromptPreset,
        targetLanguage: this.settings.targetLanguage,
        customPrompt: this.settings.customPrompt,
        cardCount: this.settings.defaultCardCount
      },
      {
        generate: async (request, signal) => {
          this.throwIfWorkflowStopped(signal);
          const instructions = this.resolveInstructions(request);
          const result = await generateFlashcards({
            apiKey,
            model: this.settings.model,
            note: source.text,
            count: request.cardCount,
            instructions,
            signal
          });
          this.throwIfWorkflowStopped(signal);
          return result.cards;
        },
        save: async (request, cards, signal) => {
          this.throwIfWorkflowStopped(signal);
          return createFlashcardDeck(this.app, {
            sourceFile: file,
            cards,
            outputFolder: request.outputFolder,
            outputFileName: request.outputFileName,
            deckTag: request.deckTag,
            cardSeparator: resolveOutputSeparator(
              request.promptPresetId,
              request.basicSeparator,
              request.reversedSeparator
            ),
            reservedSeparators: [
              request.basicSeparator,
              request.reversedSeparator
            ],
            signal
          });
        },
        isPluginUnloaded: () => this.unloaded
      }
    );

    this.activeWorkflow = workflow;
    try {
      const result = await workflow.openAndWait();
      if (!result || this.unloaded) {
        return;
      }

      new Notice(
        result.bidirectional
          ? `Saved ${result.cardCount} bidirectional pairs (${result.cardCount * 2} review cards) in ${result.deckFile.path}.`
          : `Created ${result.cardCount} flashcards in ${result.deckFile.path}.`
      );

      if (this.settings.openDeckAfterCreation) {
        try {
          await this.app.workspace.getLeaf("tab").openFile(result.deckFile);
        } catch (error) {
          console.error(
            "[AI Flashcard Generator] Could not open the generated deck:",
            error
          );
          new Notice(
            `The deck was created but could not be opened: ${result.deckFile.path}.`
          );
        }
      }
    } finally {
      if (this.activeWorkflow === workflow) {
        this.activeWorkflow = null;
      }
    }
  }

  private resolveInstructions(request: GenerationRequest): string {
    return resolvePromptInstructions({
      presetId: request.promptPresetId,
      count: request.cardCount,
      targetLanguage: request.targetLanguage,
      customPrompt: request.customPrompt
    });
  }

  private async resolveWorkflowSeparators(): Promise<{
    basic: string;
    reversed: string;
    locked: boolean;
    description: string;
  }> {
    if (this.settings.separatorMode === "manual") {
      const basic = normalizeBasicSeparator(this.settings.basicSeparator);
      const reversed = normalizeBasicSeparator(this.settings.reversedSeparator);
      if (basic === reversed) {
        throw new Error(
          "Basic and bidirectional separators must be different. Check AI Flashcard Generator settings."
        );
      }
      return {
        basic,
        reversed,
        locked: false,
        description: "Manual override from AI Flashcard Generator settings."
      };
    }

    await this.refreshSpacedRepetitionSeparators();
    const detected = this.spacedRepetitionSeparators;
    if (!detected.compatible) {
      throw new Error(`${detected.message} Open the plugin settings to fix it.`);
    }

    return {
      basic: detected.basic,
      reversed: detected.reversed,
      locked: true,
      description: detected.message
    };
  }

  private throwIfWorkflowStopped(signal?: AbortSignal): void {
    if (this.unloaded || signal?.aborted) {
      throw new GeminiRequestCancelledError();
    }
  }
}

