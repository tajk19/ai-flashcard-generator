import {
  App,
  ButtonComponent,
  Modal,
  Notice,
  Setting,
  type TFile
} from "obsidian";
import type { Flashcard, GeneratedFlashcard } from "../models/flashcard";
import {
  isBidirectionalPreset,
  resolveOutputSeparator
} from "../services/card-output";
import {
  createPreviewFlashcards,
  isCardEdited,
  refreshPreviewQuality,
  selectedCardsToFlashcards,
  selectRecommendedCards,
  type PreviewFlashcard
} from "../services/card-quality";
import {
  normalizeDeckTag,
  normalizeOutputFileName,
  normalizeOutputFolder,
  validateDeckTagSeparator
} from "../services/deck-format";
import { previewFlashcardDeckPath } from "../services/deck-writer";
import {
  clampCardCount,
  MAX_CARD_COUNT,
  MIN_CARD_COUNT,
  normalizeBasicSeparator
} from "../services/flashcard-generator";
import {
  countCharacters,
  MAX_CARD_FIELD_CHARACTERS,
  validateCustomPrompt,
  validateSourceText
} from "../services/generation-limits";
import {
  getPromptPreset,
  normalizePromptPresetId,
  PROMPT_PRESETS,
  type PromptPresetId
} from "../services/prompt-presets";

export type SourceScope = "selection" | "note";
type WorkflowPhase = "configure" | "generating" | "preview" | "saving";

export interface SourceSnapshot {
  fileName: string;
  text: string;
  scope: SourceScope;
}

export interface GenerationRequest {
  outputFileName: string;
  outputFolder: string;
  deckTag: string;
  basicSeparator: string;
  reversedSeparator: string;
  promptPresetId: PromptPresetId;
  targetLanguage: string;
  customPrompt: string;
  cardCount: number;
}

export interface GenerationWorkflowDefaults extends GenerationRequest {
  source: SourceSnapshot;
  separatorsLocked: boolean;
  separatorDescription: string;
}

export interface GenerationWorkflowResult {
  deckFile: TFile;
  cardCount: number;
  bidirectional: boolean;
}

export interface GenerationWorkflowCallbacks {
  generate(
    request: GenerationRequest,
    signal: AbortSignal
  ): Promise<GeneratedFlashcard[]>;
  save(
    request: GenerationRequest,
    cards: Flashcard[],
    signal: AbortSignal
  ): Promise<TFile>;
  isPluginUnloaded(): boolean;
}

interface PreviewElements {
  badges: HTMLElement;
  checkbox: HTMLInputElement;
}

export class GenerationWorkflowModal extends Modal {
  readonly result: Promise<GenerationWorkflowResult | null>;

  private readonly source: SourceSnapshot;
  private readonly callbacks: GenerationWorkflowCallbacks;
  private readonly separatorsLocked: boolean;
  private readonly separatorDescription: string;
  private readonly resolveResult: (
    result: GenerationWorkflowResult | null
  ) => void;
  private config: GenerationRequest;
  private phase: WorkflowPhase = "configure";
  private previewCards: PreviewFlashcard[] = [];
  private previewElements = new Map<string, PreviewElements>();
  private expectedPath = "";
  private errorMessage = "";
  private settled = false;
  private closed = false;
  private runId = 0;
  private abortController: AbortController | null = null;
  private readonly lifecycleController = new AbortController();
  private createButton: ButtonComponent | null = null;

  constructor(
    app: App,
    defaults: GenerationWorkflowDefaults,
    callbacks: GenerationWorkflowCallbacks
  ) {
    super(app);
    this.source = defaults.source;
    this.callbacks = callbacks;
    this.separatorsLocked = defaults.separatorsLocked;
    this.separatorDescription = defaults.separatorDescription;
    this.config = {
      outputFileName: defaults.outputFileName,
      outputFolder: defaults.outputFolder,
      deckTag: defaults.deckTag,
      basicSeparator: defaults.basicSeparator,
      reversedSeparator: defaults.reversedSeparator,
      promptPresetId: normalizePromptPresetId(defaults.promptPresetId),
      targetLanguage: defaults.targetLanguage,
      customPrompt: defaults.customPrompt,
      cardCount: clampCardCount(defaults.cardCount)
    };
    let resolveResult: (
      result: GenerationWorkflowResult | null
    ) => void = () => undefined;
    this.result = new Promise((resolve) => {
      resolveResult = resolve;
    });
    this.resolveResult = resolveResult;
  }

  openAndWait(): Promise<GenerationWorkflowResult | null> {
    this.open();
    return this.result;
  }

  cancelAndClose(): void {
    if (this.phase === "saving") {
      this.close();
      return;
    }
    this.finish(null);
  }

  onOpen(): void {
    this.modalEl.addClass("ai-flashcard-generator-workflow");
    this.render();
  }

  onClose(): void {
    this.closed = true;
    this.lifecycleController.abort();
    this.contentEl.empty();
    this.cancelGeneration();

    if (!this.settled && this.phase !== "saving") {
      this.settled = true;
      this.resolveResult(null);
    }
  }

  private render(): void {
    this.contentEl.empty();
    this.previewElements.clear();
    this.createButton = null;

    if (this.phase === "configure") {
      this.renderConfigure();
    } else if (this.phase === "generating") {
      this.renderGenerating();
    } else if (this.phase === "preview") {
      this.renderPreview();
    } else {
      this.renderSaving();
    }
  }

  private renderConfigure(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Generate flashcards" });
    this.renderSourceSummary();
    contentEl.createEl("p", {
      cls: "ai-flashcard-generator-privacy-note",
      text:
        "Generate sends the source shown above and the chosen prompt instructions to Google Gemini. " +
        "Free Tier content may be used to improve Google products. Only send text you are comfortable sharing."
    });

    new Setting(contentEl)
      .setName("Output file name")
      .setDesc("The .md extension is optional. Existing files are never overwritten.")
      .addText((text) =>
        text
          .setPlaceholder("My flashcards")
          .setValue(this.config.outputFileName)
          .onChange((value) => {
            this.config.outputFileName = value;
            this.updateExpectedPath();
          })
      );

    new Setting(contentEl)
      .setName("Output folder")
      .setDesc("Vault-relative destination. Leave blank for the vault root.")
      .addText((text) =>
        text
          .setPlaceholder("Flashcards")
          .setValue(this.config.outputFolder)
          .onChange((value) => {
            this.config.outputFolder = value;
            this.updateExpectedPath();
          })
      );

    contentEl.createEl("p", {
      cls: "ai-flashcard-generator-path-preview",
      attr: { "data-path-preview": "true" }
    });
    this.updateExpectedPath();

    const activePreset = getPromptPreset(this.config.promptPresetId);
    new Setting(contentEl)
      .setName("Prompt profile")
      .setDesc(activePreset.description)
      .addDropdown((dropdown) => {
        for (const preset of PROMPT_PRESETS) {
          dropdown.addOption(preset.id, preset.name);
        }
        dropdown
          .setValue(this.config.promptPresetId)
          .onChange((value) => {
            this.config.promptPresetId = normalizePromptPresetId(value);
            this.errorMessage = "";
            this.render();
          });
      });

    new Setting(contentEl)
      .setName(
        isBidirectionalPreset(this.config.promptPresetId)
          ? "Maximum pairs"
          : "Maximum cards"
      )
      .setDesc("Gemini can return fewer cards when the source is sparse.")
      .addSlider((slider) =>
        slider
          .setLimits(MIN_CARD_COUNT, MAX_CARD_COUNT, 1)
          .setDynamicTooltip()
          .setValue(this.config.cardCount)
          .onChange((value) => {
            this.config.cardCount = clampCardCount(value);
          })
      );

    if (this.config.promptPresetId === "english-translation") {
      new Setting(contentEl)
        .setName("Translation language")
        .setDesc(
          "Each saved pair is bidirectional: English → translation and translation → English."
        )
        .addText((text) =>
          text
            .setPlaceholder("Russian")
            .setValue(this.config.targetLanguage)
            .onChange((value) => {
              this.config.targetLanguage = value;
            })
        );
    }

    if (this.config.promptPresetId === "custom") {
      new Setting(contentEl)
        .setName("Custom prompt")
        .setDesc(
          "The source and Q&A JSON schema are added automatically. Variables: {{count}} and {{targetLanguage}}."
        )
        .addTextArea((textArea) => {
          textArea
            .setPlaceholder("Describe how to select and formulate the cards.")
            .setValue(this.config.customPrompt)
            .onChange((value) => {
              this.config.customPrompt = value;
            });
          textArea.inputEl.rows = 9;
          textArea.inputEl.addClass("ai-flashcard-generator-custom-prompt");
        });

      new Setting(contentEl)
        .setName("Target language variable")
        .setDesc("Replaces {{targetLanguage}} if the custom prompt uses it.")
        .addText((text) =>
          text
            .setPlaceholder("Russian")
            .setValue(this.config.targetLanguage)
            .onChange((value) => {
              this.config.targetLanguage = value;
            })
        );
    }

    new Setting(contentEl)
      .setName("Deck tag")
      .setDesc("Exact Spaced Repetition deck tag without the leading #.")
      .addText((text) =>
        text
          .setPlaceholder("flashcards/generated")
          .setValue(this.config.deckTag)
          .onChange((value) => {
            this.config.deckTag = value;
          })
      );

    new Setting(contentEl)
      .setName("Basic card separator")
      .setDesc(
        `${this.separatorDescription} Used by Atomic notes and Custom prompt.`
      )
      .addText((text) =>
        text
          .setPlaceholder("::")
          .setValue(this.config.basicSeparator)
          .setDisabled(this.separatorsLocked)
          .onChange((value) => {
            this.config.basicSeparator = value;
          })
      );

    new Setting(contentEl)
      .setName("Bidirectional card separator")
      .setDesc(
        `${this.separatorDescription} Used by the English profile for both review directions.`
      )
      .addText((text) =>
        text
          .setPlaceholder(":::")
          .setValue(this.config.reversedSeparator)
          .setDisabled(this.separatorsLocked)
          .onChange((value) => {
            this.config.reversedSeparator = value;
          })
      );

    this.renderError();
    const actions = this.createActions();
    new ButtonComponent(actions)
      .setButtonText("Cancel")
      .onClick(() => this.finish(null));
    new ButtonComponent(actions)
      .setButtonText("Generate")
      .setCta()
      .onClick(() => void this.startGeneration(false));
  }

  private renderGenerating(): void {
    this.contentEl.createEl("h2", {
      text: this.previewCards.length > 0 ? "Regenerating flashcards" : "Generating flashcards"
    });
    this.renderSourceSummary();
    this.contentEl.createEl("p", {
      cls: "ai-flashcard-generator-loading",
      text: "Waiting for Gemini. You can cancel this workflow; the late response will be ignored."
    });
    const actions = this.createActions();
    new ButtonComponent(actions)
      .setButtonText("Cancel")
      .onClick(() => this.finish(null));
  }

  private renderPreview(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Review generated flashcards" });
    contentEl.createEl("p", {
      cls: "ai-flashcard-generator-source",
      text: `Expected path: ${this.expectedPath}`
    });
    if (this.config.promptPresetId === "english-translation") {
      contentEl.createEl("p", {
        cls: "ai-flashcard-generator-source",
        text:
          `Bidirectional mode: every English/translation pair will be saved with “${this.config.reversedSeparator}” ` +
          "and reviewed by Spaced Repetition in both directions."
      });
    }

    const toolbar = contentEl.createDiv({
      cls: "ai-flashcard-generator-preview-toolbar"
    });
    new ButtonComponent(toolbar)
      .setButtonText("Select valid")
      .onClick(() => {
        selectRecommendedCards(this.previewCards);
        this.refreshPreviewControls();
      });
    new ButtonComponent(toolbar)
      .setButtonText("Clear selection")
      .onClick(() => {
        for (const card of this.previewCards) {
          card.selected = false;
        }
        this.refreshPreviewControls();
      });

    const list = contentEl.createDiv({ cls: "ai-flashcard-generator-card-list" });
    this.previewCards.forEach((card, index) =>
      this.renderPreviewCard(list, card, index)
    );

    this.renderError();
    const actions = this.createActions();
    new ButtonComponent(actions)
      .setButtonText("Cancel")
      .onClick(() => this.finish(null));
    new ButtonComponent(actions)
      .setButtonText("Back")
      .onClick(() => {
        this.phase = "configure";
        this.errorMessage = "";
        this.render();
      });
    new ButtonComponent(actions)
      .setButtonText("Regenerate")
      .onClick(() => void this.startGeneration(true));
    this.createButton = new ButtonComponent(actions)
      .setCta()
      .onClick(() => void this.saveSelectedCards());
    this.refreshPreviewControls();
  }

  private renderPreviewCard(
    parent: HTMLElement,
    card: PreviewFlashcard,
    index: number
  ): void {
    const article = parent.createEl("article", {
      cls: "ai-flashcard-generator-card"
    });
    const header = article.createDiv({ cls: "ai-flashcard-generator-card-header" });
    const selection = header.createEl("label", {
      cls: "ai-flashcard-generator-card-selection"
    });
    const checkbox = selection.createEl("input", { type: "checkbox" });
    checkbox.checked = card.selected;
    checkbox.disabled = card.issues.includes("invalid");
    checkbox.setAttr("aria-label", `Include card ${index + 1}`);
    checkbox.addEventListener("change", () => {
      card.selected = checkbox.checked;
      this.refreshCreateButton();
    });
    selection.createEl("strong", { text: `Card ${index + 1}` });
    const badges = header.createDiv({ cls: "ai-flashcard-generator-badges" });

    const questionId = `ai-flashcard-question-${card.id}`;
    article.createEl("label", {
      text:
        this.config.promptPresetId === "english-translation"
          ? "English expression"
          : "Question",
      attr: { for: questionId }
    });
    const question = article.createEl("textarea");
    question.id = questionId;
    question.rows = 2;
    question.value = card.question;
    question.maxLength = MAX_CARD_FIELD_CHARACTERS;
    question.addEventListener("input", () => {
      card.question = question.value;
      this.revalidatePreview();
    });

    const answerId = `ai-flashcard-answer-${card.id}`;
    article.createEl("label", {
      text:
        this.config.promptPresetId === "english-translation"
          ? "Translation"
          : "Answer",
      attr: { for: answerId }
    });
    const answer = article.createEl("textarea");
    answer.id = answerId;
    answer.rows = 3;
    answer.value = card.answer;
    answer.maxLength = MAX_CARD_FIELD_CHARACTERS;
    answer.addEventListener("input", () => {
      card.answer = answer.value;
      this.revalidatePreview();
    });

    const evidence = article.createEl("details", {
      cls: "ai-flashcard-generator-evidence"
    });
    evidence.createEl("summary", { text: "Evidence from source" });
    evidence.createEl("blockquote", {
      text: card.evidence || "No evidence was returned."
    });

    this.previewElements.set(card.id, { badges, checkbox });
    this.refreshCardControls(card);
  }

  private renderSaving(): void {
    this.contentEl.createEl("h2", { text: "Creating flashcard deck" });
    this.contentEl.createEl("p", {
      cls: "ai-flashcard-generator-loading",
      text: `Saving approved cards to ${this.expectedPath}...`
    });
  }

  private renderSourceSummary(): void {
    const scope = this.source.scope === "selection" ? "Selection" : "Full note";
    this.contentEl.createEl("p", {
      cls: "ai-flashcard-generator-source",
      text: `${scope} · ${countCharacters(this.source.text).toLocaleString()} characters · ${this.source.fileName}`
    });
  }

  private renderError(): void {
    if (this.errorMessage) {
      this.contentEl.createEl("p", {
        cls: "ai-flashcard-generator-error",
        text: this.errorMessage,
        attr: { role: "alert" }
      });
    }
  }

  private createActions(): HTMLDivElement {
    return this.contentEl.createDiv({
      cls:
        "ai-flashcard-generator-actions" +
        (this.phase === "preview" ? " is-preview" : ""),
      attr: { role: "group", "aria-label": "Flashcard actions" }
    });
  }

  private updateExpectedPath(): void {
    const element = this.contentEl.querySelector<HTMLElement>(
      "[data-path-preview='true']"
    );
    if (!element) {
      return;
    }

    try {
      const destination = previewFlashcardDeckPath(this.app, {
        outputFolder: this.config.outputFolder,
        outputFileName: this.config.outputFileName
      });
      this.expectedPath = destination.path;
      element.setText(`Expected path: ${destination.path}`);
      element.removeClass("is-error");
    } catch (error) {
      this.expectedPath = "";
      element.setText(
        error instanceof Error ? error.message : "The output path is invalid."
      );
      element.addClass("is-error");
    }
  }

  private validateAndNormalizeConfig(): GenerationRequest {
    validateSourceText(this.source.text);
    const promptPresetId = normalizePromptPresetId(this.config.promptPresetId);
    const customPrompt = this.config.customPrompt.trim();
    const targetLanguage = this.config.targetLanguage.trim();

    if (promptPresetId === "custom") {
      if (!customPrompt) {
        throw new Error("Enter a custom prompt before generating cards.");
      }
      validateCustomPrompt(customPrompt);
    }

    if (
      (promptPresetId === "english-translation" ||
        customPrompt.includes("{{targetLanguage}}")) &&
      !targetLanguage
    ) {
      throw new Error("Enter a target translation language.");
    }

    const deckTag = normalizeDeckTag(this.config.deckTag);
    const basicSeparator = normalizeBasicSeparator(this.config.basicSeparator);
    const reversedSeparator = normalizeBasicSeparator(
      this.config.reversedSeparator
    );
    if (basicSeparator === reversedSeparator) {
      throw new Error(
        "Basic and bidirectional card separators must be different."
      );
    }
    validateDeckTagSeparator(
      deckTag,
      resolveOutputSeparator(promptPresetId, basicSeparator, reversedSeparator)
    );
    validateDeckTagSeparator(deckTag, basicSeparator);
    validateDeckTagSeparator(deckTag, reversedSeparator);

    const normalized: GenerationRequest = {
      ...this.config,
      outputFileName: normalizeOutputFileName(this.config.outputFileName),
      outputFolder: normalizeOutputFolder(this.config.outputFolder),
      deckTag,
      basicSeparator,
      reversedSeparator,
      promptPresetId,
      targetLanguage,
      customPrompt,
      cardCount: clampCardCount(this.config.cardCount)
    };
    const destination = previewFlashcardDeckPath(this.app, normalized);
    this.expectedPath = destination.path;
    this.config = normalized;
    return normalized;
  }

  private async startGeneration(isRegeneration: boolean): Promise<void> {
    if (this.closed || this.settled || this.callbacks.isPluginUnloaded() ||
        (this.phase !== "configure" && this.phase !== "preview")) return;
    let request: GenerationRequest;
    try {
      request = this.validateAndNormalizeConfig();
    } catch (error) {
      this.errorMessage = toErrorMessage(error);
      this.phase = isRegeneration ? "preview" : "configure";
      this.render();
      return;
    }

    const fallbackPhase: WorkflowPhase = isRegeneration ? "preview" : "configure";
    this.errorMessage = "";
    this.phase = "generating";
    this.render();
    this.cancelGeneration();
    const controller = new AbortController();
    this.abortController = controller;
    const currentRunId = ++this.runId;

    try {
      const cards = await this.callbacks.generate(request, controller.signal);
      if (!this.canApplyRun(currentRunId, controller)) {
        return;
      }
      if (cards.length === 0) {
        throw new Error("Gemini found no suitable flashcards in this source.");
      }

      this.previewCards = createPreviewFlashcards(
        cards,
        this.source.text,
        request.promptPresetId
      );
      this.abortController = null;
      this.phase = "preview";
      this.render();
    } catch (error) {
      if (!this.canApplyRun(currentRunId, controller)) {
        return;
      }
      this.abortController = null;
      this.phase = fallbackPhase;
      this.errorMessage = toErrorMessage(error);
      this.render();
    }
  }

  private async saveSelectedCards(): Promise<void> {
    if (this.closed || this.settled || this.callbacks.isPluginUnloaded() ||
        this.phase !== "preview") return;
    this.revalidatePreview();
    const cards = selectedCardsToFlashcards(this.previewCards);
    if (cards.length === 0) {
      this.errorMessage = "Select at least one valid card before creating the deck.";
      this.render();
      return;
    }

    let request: GenerationRequest;
    try {
      request = this.validateAndNormalizeConfig();
    } catch (error) {
      this.errorMessage = toErrorMessage(error);
      this.render();
      return;
    }

    this.errorMessage = "";
    this.phase = "saving";
    this.render();

    try {
      if (this.callbacks.isPluginUnloaded()) {
        throw new Error("The plugin was unloaded before the deck could be saved.");
      }
      const deckFile = await this.callbacks.save(
        request,
        cards,
        this.lifecycleController.signal
      );
      if (this.closed || this.callbacks.isPluginUnloaded()) {
        this.settleWithoutClosing(null);
        return;
      }
      this.finish({
        deckFile,
        cardCount: cards.length,
        bidirectional: isBidirectionalPreset(request.promptPresetId)
      });
    } catch (error) {
      if (this.closed) {
        new Notice(toErrorMessage(error));
        this.settleWithoutClosing(null);
        return;
      }
      this.phase = "preview";
      this.errorMessage = toErrorMessage(error);
      this.render();
    }
  }

  private revalidatePreview(): void {
    refreshPreviewQuality(
      this.previewCards,
      this.source.text,
      this.config.promptPresetId
    );
    this.refreshPreviewControls();
  }

  private refreshPreviewControls(): void {
    for (const card of this.previewCards) {
      this.refreshCardControls(card);
    }
    this.refreshCreateButton();
  }

  private refreshCardControls(card: PreviewFlashcard): void {
    const elements = this.previewElements.get(card.id);
    if (!elements) {
      return;
    }

    elements.checkbox.disabled = card.issues.includes("invalid");
    elements.checkbox.checked = card.selected;
    elements.badges.empty();

    this.addBadge(
      elements.badges,
      card.issues.includes("not-grounded") ? "Not grounded" : "Supported",
      card.issues.includes("not-grounded") ? "warning" : "success"
    );
    if (card.issues.includes("duplicate")) {
      this.addBadge(elements.badges, "Duplicate", "warning");
    }
    if (card.issues.includes("conflict")) {
      this.addBadge(elements.badges, "Conflict", "error");
    }
    if (card.issues.includes("too-long")) {
      this.addBadge(elements.badges, "Too long", "warning");
    }
    if (card.issues.includes("invalid")) {
      this.addBadge(elements.badges, "Invalid", "error");
    }
    if (isCardEdited(card)) {
      this.addBadge(elements.badges, "Edited", "info");
    }
  }

  private addBadge(
    parent: HTMLElement,
    label: string,
    kind: "success" | "warning" | "error" | "info"
  ): void {
    parent.createSpan({
      cls: `ai-flashcard-generator-badge is-${kind}`,
      text: label
    });
  }

  private refreshCreateButton(): void {
    const count = selectedCardsToFlashcards(this.previewCards).length;
    const noun = isBidirectionalPreset(this.config.promptPresetId)
      ? "bidirectional pairs"
      : "cards";
    this.createButton
      ?.setButtonText(`Create ${count} ${noun}`)
      .setDisabled(count === 0);
  }

  private canApplyRun(
    runId: number,
    controller: AbortController
  ): boolean {
    return (
      !this.closed &&
      !this.settled &&
      !this.callbacks.isPluginUnloaded() &&
      runId === this.runId &&
      controller === this.abortController &&
      !controller.signal.aborted
    );
  }

  private cancelGeneration(): void {
    this.runId += 1;
    this.abortController?.abort();
    this.abortController = null;
  }

  private finish(result: GenerationWorkflowResult | null): void {
    this.cancelGeneration();
    this.settleWithoutClosing(result);
    if (!this.closed) {
      this.close();
    }
  }

  private settleWithoutClosing(result: GenerationWorkflowResult | null): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveResult(result);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The flashcard workflow failed.";
}

