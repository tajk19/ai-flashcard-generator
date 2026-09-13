import {
  App,
  PluginSettingTab,
  SecretComponent,
  Setting
} from "obsidian";
import type AIFlashcardPlugin from "./main";
import {
  clampCardCount,
  MAX_CARD_COUNT,
  MIN_CARD_COUNT
} from "./services/flashcard-generator";
import {
  getPromptPreset,
  normalizePromptPresetId,
  PROMPT_PRESETS
} from "./services/prompt-presets";
import { DEFAULT_SETTINGS } from "./services/settings-data";
export { DEFAULT_SETTINGS, type AIFlashcardSettings } from "./services/settings-data";

export class AIFlashcardSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: AIFlashcardPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ai-flashcard-generator-settings");

    containerEl.createEl("p", {
      cls: "ai-flashcard-generator-privacy-note",
      text:
        "Generating cards sends the selected text or current note and the chosen prompt instructions to the Gemini API. Google may use Free Tier content to improve its products; do not send sensitive data."
    });

    new Setting(containerEl)
      .setName("Gemini API key")
      .setDesc(
        "Select or create an auth key in Obsidian Secret Storage. Only the secret ID is saved in this plugin's data."
      )
      .addComponent((element) =>
        new SecretComponent(this.app, element)
          .setValue(this.plugin.settings.geminiApiKeySecretId)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKeySecretId = value ?? "";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gemini model")
      .setDesc("Stable model ID used for generation.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.model)
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default prompt profile")
      .setDesc(
        getPromptPreset(this.plugin.settings.defaultPromptPreset).description
      )
      .addDropdown((dropdown) => {
        for (const preset of PROMPT_PRESETS) {
          dropdown.addOption(preset.id, preset.name);
        }

        dropdown
          .setValue(this.plugin.settings.defaultPromptPreset)
          .onChange(async (value) => {
            this.plugin.settings.defaultPromptPreset =
              normalizePromptPresetId(value);
            await this.plugin.saveSettings();
            this.display();
          });
      });

    const selectedPreset = getPromptPreset(
      this.plugin.settings.defaultPromptPreset
    );
    if (selectedPreset.id !== "custom") {
      const promptPreview = containerEl.createEl("details", {
        cls: "ai-flashcard-generator-prompt-preview"
      });
      promptPreview.createEl("summary", {
        text: "View built-in prompt"
      });
      promptPreview.createEl("pre", { text: selectedPreset.template });
    }

    new Setting(containerEl)
      .setName("Translation language")
      .setDesc(
        "Used by the English profile and the {{targetLanguage}} variable in custom prompts."
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.targetLanguage)
          .setValue(this.plugin.settings.targetLanguage)
          .onChange(async (value) => {
            this.plugin.settings.targetLanguage = value;
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.defaultPromptPreset === "custom") {
      new Setting(containerEl)
        .setName("Custom prompt")
        .setDesc(
          "The source note and Q&A JSON schema are added automatically. Available variables: {{count}} and {{targetLanguage}}."
        )
        .addTextArea((textArea) => {
          textArea
            .setPlaceholder(
              "Describe which facts to select and how to write each question and answer."
            )
            .setValue(this.plugin.settings.customPrompt)
            .onChange(async (value) => {
              this.plugin.settings.customPrompt = value;
              await this.plugin.saveSettings();
            });
          textArea.inputEl.rows = 12;
          textArea.inputEl.addClass("ai-flashcard-generator-custom-prompt");
        });
    }

    new Setting(containerEl)
      .setName("Maximum cards")
      .setDesc("Gemini may return fewer cards when the note contains less useful material.")
      .addSlider((slider) =>
        slider
          .setLimits(MIN_CARD_COUNT, MAX_CARD_COUNT, 1)
          .setDynamicTooltip()
          .setValue(clampCardCount(this.plugin.settings.defaultCardCount))
          .onChange(async (value) => {
            this.plugin.settings.defaultCardCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Vault-relative folder for generated Markdown decks. Leave blank for the vault root.")
      .addText((text) =>
        text
          .setPlaceholder("Flashcards")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Deck tag")
      .setDesc(
        "Exact Spaced Repetition deck tag without the leading #. Use the same root tag as in Spaced Repetition settings."
      )
      .addText((text) =>
        text
          .setPlaceholder("flashcards/generated")
          .setValue(this.plugin.settings.deckTag)
          .onChange(async (value) => {
            this.plugin.settings.deckTag = value;
            await this.plugin.saveSettings();
          })
      );

    const automaticSeparators = this.plugin.settings.separatorMode === "auto";
    new Setting(containerEl)
      .setName("Sync card separators")
      .setDesc(
        "Read the single-line basic and reversed separators directly from Spaced Repetition. Recommended unless that plugin is stored under a non-standard ID."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(automaticSeparators)
          .onChange(async (value) => {
            this.plugin.settings.separatorMode = value ? "auto" : "manual";
            await this.plugin.saveSettings();
            if (value) {
              await this.plugin.refreshSpacedRepetitionSeparators();
            }
            this.display();
          })
      );

    if (automaticSeparators) {
      const detected = this.plugin.spacedRepetitionSeparators;
      new Setting(containerEl)
        .setName("Detected basic separator")
        .setDesc(detected.message)
        .addText((text) =>
          text.setValue(detected.basic).setDisabled(true)
        );

      new Setting(containerEl)
        .setName("Detected bidirectional separator")
        .setDesc(
          "Used by the English profile so each English/translation pair is reviewed in both directions."
        )
        .addText((text) =>
          text.setValue(detected.reversed).setDisabled(true)
        )
        .addButton((button) =>
          button.setButtonText("Refresh").onClick(async () => {
            await this.plugin.refreshSpacedRepetitionSeparators();
            this.display();
          })
        );
    } else {
      new Setting(containerEl)
        .setName("Basic card separator")
        .setDesc(
          "Literal single-line basic separator configured in Spaced Repetition, normally ::."
        )
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_SETTINGS.basicSeparator)
            .setValue(this.plugin.settings.basicSeparator)
            .onChange(async (value) => {
              this.plugin.settings.basicSeparator = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Bidirectional card separator")
        .setDesc(
          "Literal single-line reversed separator configured in Spaced Repetition, normally :::. Used by the English profile."
        )
        .addText((text) =>
          text
            .setPlaceholder(DEFAULT_SETTINGS.reversedSeparator)
            .setValue(this.plugin.settings.reversedSeparator)
            .onChange(async (value) => {
              this.plugin.settings.reversedSeparator = value;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Open generated deck")
      .setDesc("Open the new Markdown file after generation.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openDeckAfterCreation)
          .onChange(async (value) => {
            this.plugin.settings.openDeckAfterCreation = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

