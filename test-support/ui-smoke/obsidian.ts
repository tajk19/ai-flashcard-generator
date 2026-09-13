// Dev-only mock. It never loads Obsidian, a real vault, a key or a network client.
type ElementOptions = string | {
  cls?: string;
  text?: string;
  type?: string;
  attr?: Record<string, string>;
};

function createElement(this: HTMLElement, tag: string, options: ElementOptions = {}) {
  const element = document.createElement(tag);
  const opts = typeof options === "string" ? { cls: options } : options;
  if (opts.cls) element.className = opts.cls;
  if (opts.text) element.textContent = opts.text;
  if (opts.type) element.setAttribute("type", opts.type);
  for (const [key, value] of Object.entries(opts.attr ?? {})) element.setAttribute(key, value);
  this.append(element);
  return element;
}

Object.assign(HTMLElement.prototype, {
  createEl: createElement,
  createDiv(this: HTMLElement, options?: ElementOptions) { return createElement.call(this, "div", options); },
  createSpan(this: HTMLElement, options?: ElementOptions) { return createElement.call(this, "span", options); },
  empty(this: HTMLElement) { this.replaceChildren(); },
  addClass(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); },
  removeClass(this: HTMLElement, ...classes: string[]) { this.classList.remove(...classes); },
  setText(this: HTMLElement, value: string) { this.textContent = value; },
  setAttr(this: HTMLElement, name: string, value: string) { this.setAttribute(name, value); }
});

export class App {}
export class TFile {
  constructor(public path = "") {}
  get name() { return this.path.split("/").at(-1) ?? ""; }
  get basename() { return this.name.replace(/\.md$/, ""); }
  get extension() { return this.name.split(".").at(-1) ?? ""; }
}
export class TFolder { constructor(public path = "") {} }
export function normalizePath(value: string) { return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/"); }
export class Notice {
  constructor(message: string) {
    const status = document.getElementById("status");
    if (status) status.textContent = message;
  }
}

export class Modal {
  containerEl = document.createElement("div");
  modalEl = document.createElement("div");
  contentEl = document.createElement("div");
  private openState = false;
  private escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.close();
  };
  constructor(public app: App) {
    this.containerEl.className = "modal-container";
    this.modalEl.className = "modal";
    this.contentEl.className = "modal-content";
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.modalEl.setAttribute("aria-label", "Generate flashcards");
    const close = document.createElement("button");
    close.className = "modal-close-button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close dialog");
    close.addEventListener("click", () => this.close());
    this.modalEl.append(close, this.contentEl);
    this.containerEl.append(this.modalEl);
    this.containerEl.addEventListener("click", event => {
      if (event.target === this.containerEl) this.close();
    });
  }
  open() {
    if (this.openState) return;
    this.openState = true;
    document.body.append(this.containerEl);
    document.addEventListener("keydown", this.escape);
    this.onOpen();
  }
  close() {
    if (!this.openState) return;
    this.openState = false;
    this.onClose();
    this.containerEl.remove();
    document.removeEventListener("keydown", this.escape);
  }
  onOpen() {}
  onClose() {}
}

export class ButtonComponent {
  buttonEl = document.createElement("button");
  constructor(parent: HTMLElement) { parent.append(this.buttonEl); }
  setButtonText(text: string) { this.buttonEl.textContent = text; return this; }
  setDisabled(disabled: boolean) { this.buttonEl.disabled = disabled; return this; }
  setCta() { this.buttonEl.classList.add("mod-cta"); return this; }
  onClick(callback: () => unknown) { this.buttonEl.addEventListener("click", callback); return this; }
}

class TextComponent {
  constructor(public inputEl: HTMLInputElement | HTMLTextAreaElement) {}
  setPlaceholder(value: string) { this.inputEl.placeholder = value; return this; }
  setValue(value: string) { this.inputEl.value = value; return this; }
  setDisabled(value: boolean) { this.inputEl.disabled = value; return this; }
  onChange(callback: (value: string) => unknown) {
    this.inputEl.addEventListener("input", () => callback(this.inputEl.value));
    return this;
  }
}

class DropdownComponent {
  constructor(public selectEl: HTMLSelectElement) {}
  addOption(value: string, label: string) { this.selectEl.add(new Option(label, value)); return this; }
  setValue(value: string) { this.selectEl.value = value; return this; }
  onChange(callback: (value: string) => unknown) {
    this.selectEl.addEventListener("change", () => callback(this.selectEl.value));
    return this;
  }
}

class SliderComponent {
  constructor(public sliderEl: HTMLInputElement) { sliderEl.type = "range"; }
  setLimits(min: number, max: number, step: number) {
    this.sliderEl.min = String(min); this.sliderEl.max = String(max); this.sliderEl.step = String(step); return this;
  }
  setValue(value: number) { this.sliderEl.value = String(value); return this; }
  setDynamicTooltip() { return this; }
  onChange(callback: (value: number) => unknown) {
    this.sliderEl.addEventListener("input", () => callback(Number(this.sliderEl.value))); return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  private nameEl: HTMLElement;
  private descEl: HTMLElement;
  private controlEl: HTMLElement;
  constructor(parent: HTMLElement) {
    this.settingEl = createElement.call(parent, "div", "setting-item");
    const info = createElement.call(this.settingEl, "div", "setting-item-info");
    this.nameEl = createElement.call(info, "div", "setting-item-name");
    this.descEl = createElement.call(info, "div", "setting-item-description");
    this.controlEl = createElement.call(this.settingEl, "div", "setting-item-control");
  }
  setName(value: string) { this.nameEl.textContent = value; return this; }
  setDesc(value: string) { this.descEl.textContent = value; return this; }
  addText(callback: (component: TextComponent) => unknown) {
    const input = createElement.call(this.controlEl, "input", { type: "text" }) as HTMLInputElement;
    callback(new TextComponent(input)); return this;
  }
  addTextArea(callback: (component: TextComponent) => unknown) {
    callback(new TextComponent(createElement.call(this.controlEl, "textarea") as HTMLTextAreaElement)); return this;
  }
  addDropdown(callback: (component: DropdownComponent) => unknown) {
    callback(new DropdownComponent(createElement.call(this.controlEl, "select") as HTMLSelectElement)); return this;
  }
  addSlider(callback: (component: SliderComponent) => unknown) {
    callback(new SliderComponent(createElement.call(this.controlEl, "input") as HTMLInputElement)); return this;
  }
}

export function requestUrl(): never {
  throw new Error("Network calls are forbidden in this UI simulation.");
}

