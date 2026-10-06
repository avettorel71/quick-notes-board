import { App, Component, MarkdownRenderer, Modal, Setting, ButtonComponent, ColorComponent, ToggleComponent, setIcon, Notice } from "obsidian";
import { WIDGET_TYPES, widgetTemplate, widgetTypeName } from "./widgets";
import type { WidgetType } from "./widgets";
import { CHANGELOG } from "./changelog";
import { CATEGORY_ICON_OPTIONS } from "./settings";
import type { QnbCategory, QnbGroup, QnbLabel } from "./settings";
import { GRADIENT_DIRECTIONS, defaultGradientEndColor, isHexColor, normalizeGradientAnimationSeconds, resolveCategoryBackground } from "./gradient";
import type { QnbGradientDirection } from "./gradient";
import type QuickNotesBoardPlugin from "./main";
import type { QuickNote, QnbFontFamily } from "./main";
import { getContrastTextColor } from "./main";
import { t, QnbLang } from "./i18n";
import { SNOOZE_OPTIONS_MINUTES, formatClock, formatSnoozeLabel, normalizeSnoozeMinutes } from "./snooze";

/** Colora le <option> di un <select> categoria con lo stesso colore configurato per quella categoria. */
function colorizeCategoryOptions(selectEl: HTMLSelectElement, categories: QnbCategory[]) {
	for (const option of Array.from(selectEl.options)) {
		const cat = categories.find((c) => c.name === option.value);
		if (cat) {
			option.setCssStyles({ backgroundColor: cat.color });
			option.setCssStyles({ color: getContrastTextColor(cat.color) });
		}
	}
}

/** Appiattisce l'albero (ricorsivo) dei gruppi in un unico elenco, con un prefisso che
 * cresce ad ogni livello — così un solo menu a tendina può offrire qualunque profondità. */
function flattenGroups(groups: QnbGroup[], depth = 1): { id: string; label: string }[] {
	const result: { id: string; label: string }[] = [];
	for (const g of groups) {
		result.push({ id: g.id, label: `${"—".repeat(depth)} ${g.name}` });
		result.push(...flattenGroups(g.groups, depth + 1));
	}
	return result;
}

export class NewNoteModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private title = "";
	private category: string;
	private groupId = "";
	private onSubmit: (title: string, category: string, groupId: string, content: string) => void;
	private categories: QnbCategory[];
	private groupContainer: HTMLElement | null = null;
	/** Nota creata come widget: tipo scelto e contenitore del menu a tendina. */
	private widgetOn = false;
	private widgetType: WidgetType = "clock";
	private widgetContainer: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		categories: QnbCategory[],
		onSubmit: (title: string, category: string, groupId: string, content: string) => void
	) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.categories = categories.length > 0 ? categories : [{ name: "Generale", color: "#3f3f46", titleColor: "", icon: "", iconColor: "", groups: [] }];
		this.category = this.categories[0].name;
		this.onSubmit = onSubmit;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-new-note");
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(this.tr("modal.newNote.title")).setHeading();

		new Setting(contentEl).setName(this.tr("modal.newNote.titleLabel")).addText((text) => {
			text.setPlaceholder(this.tr("modal.newNote.titlePlaceholder")).onChange((value) => {
				this.title = value;
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					this.submit();
				}
			});
		});

		// Widget: la nota nasce con un blocco QNBWidget al posto del testo.
		new Setting(contentEl)
			.setName(this.tr("modal.newNote.widget.name"))
			.setDesc(this.tr("modal.newNote.widget.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.widgetOn).onChange((value) => {
					this.widgetOn = value;
					this.renderWidgetDropdown();
				})
			);
		this.widgetContainer = contentEl.createDiv();
		this.renderWidgetDropdown();

		new Setting(contentEl).setName(this.tr("modal.newNote.categoryLabel")).addDropdown((dd) => {
			for (const cat of this.categories) {
				dd.addOption(cat.name, cat.name);
			}
			dd.setValue(this.category);
			dd.onChange((value) => {
				this.category = value;
				this.groupId = "";
				this.renderGroupDropdown();
			});
			colorizeCategoryOptions(dd.selectEl, this.categories);
		});

		this.groupContainer = contentEl.createDiv();
		this.renderGroupDropdown();

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(this.tr("modal.newNote.create"))
				.setCta()
				.onClick(() => this.submit())
		);
	}

	/** Mostra il menu "Gruppo" (con tutti i sotto-livelli, rientrati) solo se la
	 * categoria scelta ne ha almeno uno definito. */
	private renderGroupDropdown() {
		if (!this.groupContainer) return;
		this.groupContainer.empty();

		const cat = this.categories.find((c) => c.name === this.category);
		const flatGroups = cat ? flattenGroups(cat.groups) : [];
		if (flatGroups.length === 0) {
			this.groupId = "";
			return;
		}

		new Setting(this.groupContainer).setName(this.tr("modal.newNote.groupLabel")).addDropdown((dd) => {
			dd.addOption("", this.tr("modal.newNote.noGroup"));
			for (const item of flatGroups) {
				dd.addOption(item.id, item.label);
			}
			dd.setValue(flatGroups.some((g) => g.id === this.groupId) ? this.groupId : "");
			dd.onChange((value) => {
				this.groupId = value;
			});
		});
	}

	/** Il menu del tipo di widget compare solo con il toggle "Widget" attivo. */
	private renderWidgetDropdown() {
		if (!this.widgetContainer) return;
		this.widgetContainer.empty();
		if (!this.widgetOn) return;
		new Setting(this.widgetContainer).setName(this.tr("modal.newNote.widget.type")).addDropdown((dd) => {
			for (const type of WIDGET_TYPES) dd.addOption(type, widgetTypeName(this.lang, type));
			dd.setValue(this.widgetType);
			dd.onChange((value) => {
				this.widgetType = value as WidgetType;
			});
		});
	}

	private submit() {
		this.plugin.playSound("dialog-new-note-confirm");
		const title = this.title.trim();
		if (this.widgetOn) {
			// Senza titolo scritto, la nota prende il nome del widget.
			this.onSubmit(title || widgetTypeName(this.lang, this.widgetType), this.category, this.groupId, widgetTemplate(this.widgetType, this.lang));
		} else {
			this.onSubmit(title, this.category, this.groupId, "");
		}
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class ChangeCategoryModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private category: string;
	private groupId: string;
	private onSubmit: (category: string, groupId: string) => void;
	private categories: QnbCategory[];
	private groupContainer: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		currentCategory: string,
		currentGroupId: string,
		categories: QnbCategory[],
		onSubmit: (category: string, groupId: string) => void
	) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.categories = categories.length > 0 ? categories : [{ name: "Generale", color: "#3f3f46", titleColor: "", icon: "", iconColor: "", groups: [] }];
		this.category = this.categories.some((c) => c.name === currentCategory)
			? currentCategory
			: this.categories[0].name;
		this.groupId = currentGroupId;
		this.onSubmit = onSubmit;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-change-category");
		const { contentEl } = this;
		contentEl.empty();
		// Barra con i colori della categoria attuale della nota (quella da cui si parte: il
		// menu sotto serve a sceglierne un'altra).
		if (!mountNoteWindowBar(this, this.plugin, this.category, this.tr("modal.changeCategory.title"))) {
			new Setting(contentEl).setName(this.tr("modal.changeCategory.title")).setHeading();
		}

		new Setting(contentEl).setName(this.tr("modal.changeCategory.categoryLabel")).addDropdown((dd) => {
			for (const cat of this.categories) {
				dd.addOption(cat.name, cat.name);
			}
			dd.setValue(this.category);
			dd.onChange((value) => {
				this.category = value;
				this.groupId = "";
				this.renderGroupDropdown();
			});
			colorizeCategoryOptions(dd.selectEl, this.categories);
		});

		this.groupContainer = contentEl.createDiv();
		this.renderGroupDropdown();

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(this.tr("modal.changeCategory.apply"))
				.setCta()
				.onClick(() => {
					this.plugin.playSound("dialog-change-category-confirm");
					this.onSubmit(this.category, this.groupId);
					this.close();
				})
		);
	}

	/** Mostra il menu "Gruppo" (con tutti i sotto-livelli, rientrati) solo se la
	 * categoria scelta ne ha almeno uno definito. */
	private renderGroupDropdown() {
		if (!this.groupContainer) return;
		this.groupContainer.empty();

		const cat = this.categories.find((c) => c.name === this.category);
		const flatGroups = cat ? flattenGroups(cat.groups) : [];
		if (flatGroups.length === 0) {
			this.groupId = "";
			return;
		}

		new Setting(this.groupContainer).setName(this.tr("modal.newNote.groupLabel")).addDropdown((dd) => {
			dd.addOption("", this.tr("modal.newNote.noGroup"));
			for (const item of flatGroups) {
				dd.addOption(item.id, item.label);
			}
			dd.setValue(flatGroups.some((g) => g.id === this.groupId) ? this.groupId : "");
			dd.onChange((value) => {
				this.groupId = value;
			});
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

const FONT_FAMILY_OPTIONS: { value: QnbFontFamily; labelKey: string }[] = [
	{ value: "default", labelKey: "modal.fontSize.font.default" },
	{ value: "sans", labelKey: "modal.fontSize.font.sans" },
	{ value: "serif", labelKey: "modal.fontSize.font.serif" },
	{ value: "mono", labelKey: "modal.fontSize.font.mono" },
	{ value: "cursive", labelKey: "modal.fontSize.font.cursive" },
	{ value: "fantasy", labelKey: "modal.fontSize.font.fantasy" },
	{ value: "arial", labelKey: "modal.fontSize.font.arial" },
	{ value: "georgia", labelKey: "modal.fontSize.font.georgia" },
	{ value: "times", labelKey: "modal.fontSize.font.times" },
	{ value: "courier", labelKey: "modal.fontSize.font.courier" },
	{ value: "verdana", labelKey: "modal.fontSize.font.verdana" },
	{ value: "trebuchet", labelKey: "modal.fontSize.font.trebuchet" },
	{ value: "palatino", labelKey: "modal.fontSize.font.palatino" },
	{ value: "garamond", labelKey: "modal.fontSize.font.garamond" },
	{ value: "comicsans", labelKey: "modal.fontSize.font.comicsans" },
	{ value: "impact", labelKey: "modal.fontSize.font.impact" },
];

export class FontSizeModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private size: number;
	private fontFamily: QnbFontFamily;
	private fontColor: string;
	private bgColor: string;
	private onChangeSize: (size: number) => void;
	private onChangeFontFamily: (fontFamily: QnbFontFamily) => void;
	private onChangeColor: (color: string) => void;
	private onChangeBgColor: (color: string) => void;
	private categoryName: string | undefined;

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		currentSize: number,
		currentFontFamily: QnbFontFamily,
		currentFontColor: string,
		currentBgColor: string,
		onChangeSize: (size: number) => void,
		onChangeFontFamily: (fontFamily: QnbFontFamily) => void,
		onChangeColor: (color: string) => void,
		onChangeBgColor: (color: string) => void,
		categoryName?: string
	) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.categoryName = categoryName;
		this.size = currentSize;
		this.fontFamily = currentFontFamily;
		this.fontColor = currentFontColor;
		this.bgColor = currentBgColor;
		this.onChangeSize = onChangeSize;
		this.onChangeFontFamily = onChangeFontFamily;
		this.onChangeColor = onChangeColor;
		this.onChangeBgColor = onChangeBgColor;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-font-size");
		const { contentEl } = this;
		contentEl.empty();
		if (!mountNoteWindowBar(this, this.plugin, this.categoryName, this.tr("modal.fontSize.title"))) {
			new Setting(contentEl).setName(this.tr("modal.fontSize.title")).setHeading();
		}
		contentEl.createEl("p", { cls: "setting-item-description", text: this.tr("modal.fontSize.desc") });

		new Setting(contentEl)
			.setName(this.tr("modal.fontSize.sizeLabel"))
			.addSlider((slider) =>
				slider
					.setLimits(10, 32, 1)
					.setValue(this.size)
					.onChange((value) => {
						this.size = value;
						this.onChangeSize(value);
					})
			);

		new Setting(contentEl).setName(this.tr("modal.fontSize.fontLabel")).addDropdown((dd) => {
			for (const opt of FONT_FAMILY_OPTIONS) {
				dd.addOption(opt.value, this.tr(opt.labelKey));
			}
			dd.setValue(this.fontFamily);
			dd.onChange((value) => {
				this.fontFamily = value as QnbFontFamily;
				this.onChangeFontFamily(this.fontFamily);
			});
		});

		const colorSetting = new Setting(contentEl).setName(this.tr("modal.fontSize.colorLabel"));
		colorSetting.addColorPicker((cp) => {
			cp.setValue(this.fontColor || "#2e2e2e");
			cp.onChange((value) => {
				this.fontColor = value;
				this.onChangeColor(this.fontColor);
			});
		});
		colorSetting.addButton((btn) =>
			btn.setButtonText(this.tr("modal.fontSize.colorReset")).onClick(() => {
				this.fontColor = "";
				this.onChangeColor(this.fontColor);
				this.onOpen(); // ridisegna il modal per aggiornare il colore mostrato nel picker
			})
		);

		const bgColorSetting = new Setting(contentEl).setName(this.tr("modal.fontSize.bgColorLabel"));
		bgColorSetting.addColorPicker((cp) => {
			cp.setValue(this.bgColor || "#ffffff");
			cp.onChange((value) => {
				this.bgColor = value;
				this.onChangeBgColor(this.bgColor);
			});
		});
		bgColorSetting.addButton((btn) =>
			btn.setButtonText(this.tr("modal.fontSize.colorReset")).onClick(() => {
				this.bgColor = "";
				this.onChangeBgColor(this.bgColor);
				this.onOpen(); // ridisegna il modal per aggiornare il colore mostrato nel picker
			})
		);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(this.tr("modal.fontSize.close"))
				.setCta()
				.onClick(() => {
					this.plugin.playSound("dialog-font-size-close");
					this.close();
				})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Titolo con l'icona della categoria della nota davanti, per le liste di Cestino e
 * Archivio (stessa icona già usata altrove per quella categoria; "file-text" di riserva
 * se la categoria non ne ha una impostata). */
function buildNoteTitleWithIcon(plugin: QuickNotesBoardPlugin, note: QuickNote): DocumentFragment {
	return createFragment((frag) => {
		const iconSpan = frag.createSpan({ cls: "qnb-list-item-icon" });
		setIcon(iconSpan, plugin.getCategoryIcon(note.category) || "file-text");
		frag.appendChild(document.createTextNode(note.title));
	});
}

/** Intestazione h3 con un'icona davanti al testo, per i titoli delle finestre. */
function createHeadingWithIcon(containerEl: HTMLElement, iconName: string, text: string) {
	const setting = new Setting(containerEl).setName(text).setHeading();
	const iconSpan = createSpan({ cls: "qnb-modal-heading-icon" });
	setIcon(iconSpan, iconName);
	setting.nameEl.prepend(iconSpan);
}

export class TrashModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private onChange: () => void;

	constructor(app: App, plugin: QuickNotesBoardPlugin, onChange: () => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.onChange = onChange;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-trash");
		this.render();
	}

	private getDeletedNotes(): QuickNote[] {
		return this.plugin.notes.filter((n) => n.deleted);
	}

	private async persistAndRefresh() {
		await this.plugin.saveNotes();
		this.onChange();
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		createHeadingWithIcon(contentEl, "trash-2", this.tr("trash.title"));

		const deletedNotes = this.getDeletedNotes();

		if (deletedNotes.length === 0) {
			contentEl.createEl("p", { cls: "setting-item-description", text: this.tr("trash.empty") });
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
			);
			return;
		}

		for (const note of deletedNotes) {
			const row = new Setting(contentEl)
				.setName(buildNoteTitleWithIcon(this.plugin, note))
				.setDesc(
					this.tr("trash.itemCategorySize", {
						cat: note.category,
						size: this.plugin.getNoteByteSize(note).toLocaleString(),
					})
				);

			row.addButton((btn) =>
				btn
					.setIcon("rotate-ccw")
					.setTooltip(this.tr("trash.restore"))
					.onClick(async () => {
						note.deleted = false;
						this.plugin.playSound("trash-restore");
						await this.persistAndRefresh();
					})
			);

			row.addButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip(this.tr("trash.deleteForever"))
					.setDestructive()
					.onClick(async () => {
						this.plugin.notes = this.plugin.notes.filter((n) => n.id !== note.id);
						this.plugin.playSound("trash-delete-forever");
						await this.persistAndRefresh();
					})
			);
		}

		const totalBytes = deletedNotes.reduce((sum, n) => sum + this.plugin.getNoteByteSize(n), 0);
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: this.tr("trash.totalReclaimable", { size: totalBytes.toLocaleString() }),
		});

		const footer = new Setting(contentEl);
		footer.addButton((btn) =>
			btn
				.setButtonText(this.tr("trash.emptyTrash"))
				.setDestructive()
				.onClick(async () => {
					this.plugin.notes = this.plugin.notes.filter((n) => !n.deleted);
					this.plugin.playSound("trash-empty");
					await this.persistAndRefresh();
				})
		);
		footer.addButton((btn) => btn.setButtonText(this.tr("trash.close")).onClick(() => this.close()));
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class ArchiveModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private onChange: () => void;

	constructor(app: App, plugin: QuickNotesBoardPlugin, onChange: () => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.onChange = onChange;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-archive");
		this.render();
	}

	private getArchivedNotes(): QuickNote[] {
		return this.plugin.notes.filter((n) => n.archived && !n.deleted);
	}

	private async persistAndRefresh() {
		await this.plugin.saveNotes();
		this.onChange();
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		createHeadingWithIcon(contentEl, "archive", this.tr("archive.title"));

		const archivedNotes = this.getArchivedNotes();

		if (archivedNotes.length === 0) {
			contentEl.createEl("p", { cls: "setting-item-description", text: this.tr("archive.empty") });
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
			);
			return;
		}

		for (const note of archivedNotes) {
			const row = new Setting(contentEl)
				.setName(buildNoteTitleWithIcon(this.plugin, note))
				.setDesc(this.tr("trash.itemCategory", { cat: note.category }));

			row.addButton((btn) =>
				btn
					.setIcon("rotate-ccw")
					.setTooltip(this.tr("trash.restore"))
					.onClick(async () => {
						note.archived = false;
						this.plugin.playSound("archive-restore");
						await this.persistAndRefresh();
					})
			);

			row.addButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip(this.tr("archive.sendToTrash"))
					.setDestructive()
					.onClick(async () => {
						note.deleted = true;
						note.archived = false;
						this.plugin.playSound("archive-send-to-trash");
						await this.persistAndRefresh();
					})
			);
		}

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export type QnbLockMode = "lock" | "unlock";

/**
 * Chiede la password per bloccare (con conferma) o sbloccare (password singola) una nota.
 * onSubmit esegue la cifratura/decifratura vera e propria e ritorna true in caso di successo:
 * il modal si chiude. Se ritorna false (es. password errata in sblocco), il modal resta aperto
 * e mostra un errore, senza toccare i dati della nota.
 */
export class LockPasswordModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private mode: QnbLockMode;
	private onSubmit: (password: string) => Promise<boolean>;
	private categoryName: string | undefined;
	/** Campi della password (uno, o due con la conferma) e se sono mostrati in chiaro. */
	private passwordInputs: HTMLInputElement[] = [];
	private showPassword = false;

	private password = "";
	private confirmPassword = "";
	private errorEl: HTMLElement | null = null;
	private submitBtnComponent: ButtonComponent | null = null;
	private submitting = false;

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		mode: QnbLockMode,
		onSubmit: (password: string) => Promise<boolean>,
		categoryName?: string
	) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.mode = mode;
		this.onSubmit = onSubmit;
		this.categoryName = categoryName;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound(this.mode === "lock" ? "dialog-lock" : "dialog-unlock");
		const { contentEl } = this;
		contentEl.empty();

		const isLock = this.mode === "lock";
		const lockTitle = this.tr(isLock ? "modal.lock.title" : "modal.unlock.title");
		if (!mountNoteWindowBar(this, this.plugin, this.categoryName, lockTitle)) {
			new Setting(contentEl).setName(lockTitle).setHeading();
		}
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: this.tr(isLock ? "modal.lock.desc" : "modal.unlock.desc"),
		});

		// Ogni volta la finestra si apre con la password nascosta.
		this.passwordInputs = [];
		this.showPassword = false;
		const passwordSetting = new Setting(contentEl).setName(
			this.tr(isLock ? "modal.lock.passwordLabel" : "modal.unlock.passwordLabel")
		);
		passwordSetting.addText((text) => {
			text.inputEl.type = "password";
			this.passwordInputs.push(text.inputEl);
			text.onChange((v) => (this.password = v));
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					void this.trySubmit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		// Occhio a destra del campo: mostra o nasconde la password (e la conferma), per
		// evitare errori di digitazione. Senza togliere il focus al campo in cui si scrive.
		passwordSetting.addExtraButton((btn) => {
			btn.setIcon("eye").setTooltip(this.tr("modal.password.show"));
			btn.extraSettingsEl.addEventListener("mousedown", (evt) => evt.preventDefault());
			btn.onClick(() => {
				this.showPassword = !this.showPassword;
				for (const input of this.passwordInputs) input.type = this.showPassword ? "text" : "password";
				btn.setIcon(this.showPassword ? "eye-off" : "eye");
				btn.setTooltip(this.tr(this.showPassword ? "modal.password.hide" : "modal.password.show"));
			});
		});

		if (isLock) {
			const confirmSetting = new Setting(contentEl).setName(this.tr("modal.lock.confirmLabel"));
			confirmSetting.addText((text) => {
				text.inputEl.type = "password";
				this.passwordInputs.push(text.inputEl);
				text.onChange((v) => (this.confirmPassword = v));
				text.inputEl.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						void this.trySubmit();
					}
				});
			});
			// Segnaposto invisibile, identico all'occhio della riga sopra: i due campi hanno
			// così gli stessi bordi, sinistro e destro, e restano allineati.
			confirmSetting.addExtraButton((btn) => {
				btn.setIcon("eye");
				btn.extraSettingsEl.addClass("qnb-password-eye-spacer");
				btn.extraSettingsEl.setAttr("aria-hidden", "true");
			});
		}

		this.errorEl = contentEl.createDiv({ cls: "qnb-modal-error" });
		this.errorEl.setCssStyles({ display: "none" });

		const footer = new Setting(contentEl);
		footer.addButton((btn) => btn.setButtonText(this.tr("modal.cancel")).onClick(() => this.close()));
		footer.addButton((btn) => {
			this.submitBtnComponent = btn;
			btn
				.setButtonText(this.tr(isLock ? "modal.lock.submit" : "modal.unlock.submit"))
				.setCta()
				.onClick(() => void this.trySubmit());
		});
	}

	private showError(message: string) {
		if (!this.errorEl) return;
		this.errorEl.setText(message);
		this.errorEl.setCssStyles({ display: "block" });
	}

	private async trySubmit() {
		if (this.submitting) return;
		const isLock = this.mode === "lock";

		if (!this.password) {
			this.showError(this.tr(isLock ? "modal.lock.errorEmpty" : "modal.unlock.errorEmpty"));
			return;
		}
		if (isLock && this.password !== this.confirmPassword) {
			this.showError(this.tr("modal.lock.errorMismatch"));
			return;
		}

		this.submitting = true;
		this.submitBtnComponent?.setDisabled(true);

		const ok = await this.onSubmit(this.password);

		this.submitting = false;
		this.submitBtnComponent?.setDisabled(false);

		if (ok) {
			this.close();
		} else {
			this.showError(this.tr("modal.unlock.errorWrong"));
		}
	}

	onClose() {
		this.password = "";
		this.confirmPassword = "";
		this.passwordInputs = [];
		this.contentEl.empty();
	}
}

/** Finestra informativa (sola lettura) sulla nota: date, lunghezza testo, categoria/gruppo. */
export class NoteInfoModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private note: QuickNote;
	private groupPath: string;
	private onDuplicate: () => void;
	// ===== CESTINA/ARCHIVIA DAL PANNELLO INFORMATIVO (inizio) — per togliere la funzione,
	// cercare questo stesso marcatore in tutti i file e rimuovere quanto racchiude. =====
	private onArchive: () => void;
	private onTrash: () => void;
	// ===== CESTINA/ARCHIVIA DAL PANNELLO INFORMATIVO (fine) =====

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		note: QuickNote,
		groupPath: string,
		onDuplicate: () => void,
		// ===== CESTINA/ARCHIVIA DAL PANNELLO INFORMATIVO (inizio) =====
		onArchive: () => void,
		onTrash: () => void
		// ===== CESTINA/ARCHIVIA DAL PANNELLO INFORMATIVO (fine) =====
	) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.note = note;
		this.groupPath = groupPath;
		this.onDuplicate = onDuplicate;
		// ===== CESTINA/ARCHIVIA DAL PANNELLO INFORMATIVO (inizio) =====
		this.onArchive = onArchive;
		this.onTrash = onTrash;
		// ===== CESTINA/ARCHIVIA DAL PANNELLO INFORMATIVO (fine) =====
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-note-info");
		const { contentEl } = this;
		contentEl.empty();
		const infoTitle = this.note.title || this.tr("view.note.untitled");
		if (!mountNoteWindowBar(this, this.plugin, this.note.category, infoTitle)) {
			new Setting(contentEl).setName(infoTitle).setHeading();
		}

		const rows: { label: string; value: string }[] = [
			{ label: this.tr("modal.noteInfo.created"), value: new Date(this.note.createdAt).toLocaleString() },
			{ label: this.tr("modal.noteInfo.modified"), value: new Date(this.note.modifiedAt).toLocaleString() },
			{
				label: this.tr("modal.noteInfo.charCount"),
				value: this.note.encrypted
					? this.tr("modal.noteInfo.charCountLocked")
					: String(this.note.content.length),
			},
			{ label: this.tr("modal.noteInfo.category"), value: this.note.category || "—" },
			{ label: this.tr("modal.noteInfo.group"), value: this.groupPath || this.tr("modal.noteInfo.noGroup") },
		];

		const list = contentEl.createDiv({ cls: "qnb-note-info-list" });
		for (const row of rows) {
			const item = list.createDiv({ cls: "qnb-note-info-row" });
			item.createSpan({ cls: "qnb-note-info-label", text: row.label });
			item.createSpan({ cls: "qnb-note-info-value", text: row.value });
		}

		if (this.note.labelIds && this.note.labelIds.length > 0) {
			const labelItem = list.createDiv({ cls: "qnb-note-info-row" });
			labelItem.createSpan({ cls: "qnb-note-info-label", text: this.tr("modal.noteInfo.labels") });
			const valueEl = labelItem.createDiv({ cls: "qnb-note-info-value qnb-note-info-labels-value" });
			for (const id of this.note.labelIds) {
				const label = this.plugin.settings.labels.find((l) => l.id === id);
				if (!label) continue; // etichetta cancellata nel frattempo: la saltiamo senza errori
				const chip = valueEl.createSpan({ cls: "qnb-note-info-label-chip" });
				const dot = chip.createSpan({ cls: "qnb-label-dot" });
				dot.setCssStyles({ background: label.color || "#888888" });
				chip.createSpan({ text: label.name });
			}
		}

		// Riga finale: "Duplica nota" a sinistra, "Chiudi" a destra — stesso schema della
		// riga dei toggle in "Andamento della board".
		const footer = contentEl.createDiv({ cls: "qnb-note-info-footer" });
		new ButtonComponent(footer).setButtonText(this.tr("modal.noteInfo.duplicate")).onClick(() => {
			this.close();
			this.onDuplicate();
		});
		// ===== CESTINA/ARCHIVIA DAL PANNELLO INFORMATIVO (inizio) — stessa logica delle
		// icone sulla nota (nessuna richiesta di conferma: sono azioni reversibili, si
		// recuperano da Archivio/Cestino), applicata sempre a questa nota soltanto, a
		// prescindere da un'eventuale selezione multipla attiva altrove sulla board. =====
		new ButtonComponent(footer).setButtonText(this.tr("modal.noteInfo.archive")).onClick(() => {
			this.close();
			this.onArchive();
		});
		new ButtonComponent(footer).setButtonText(this.tr("modal.noteInfo.trash")).onClick(() => {
			this.close();
			this.onTrash();
		});
		// ===== CESTINA/ARCHIVIA DAL PANNELLO INFORMATIVO (fine) =====
		new ButtonComponent(footer).setButtonText(this.tr("trash.close")).onClick(() => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Finestra informativa (sola lettura): struttura ad albero di gruppi/sottogruppi di una
 * categoria, con il numero di note per ramo, e in fondo il totale note/caratteri della categoria. */
/** Raggruppa le note per id di gruppo ("" = nessun gruppo, direttamente nella categoria). */
function buildNotesByGroupId(notes: QuickNote[]): Map<string, QuickNote[]> {
	const map = new Map<string, QuickNote[]>();
	for (const n of notes) {
		const key = n.groupId || "";
		if (!map.has(key)) map.set(key, []);
		map.get(key)!.push(n);
	}
	return map;
}

function countGroupCumulative(grp: QnbGroup, notesByGroupId: Map<string, QuickNote[]>): number {
	let count = (notesByGroupId.get(grp.id) || []).length;
	for (const child of grp.groups) count += countGroupCumulative(child, notesByGroupId);
	return count;
}

/** Disegna un gruppo e i suoi sottogruppi, ognuno col conteggio "di ramo" (il gruppo stesso
 * più tutti i suoi discendenti), rientrati per profondità. */
function renderGroupNode(
	containerEl: HTMLElement,
	grp: QnbGroup,
	notesByGroupId: Map<string, QuickNote[]>,
	depth: number,
	tr: (key: string, vars?: Record<string, string>) => string
) {
	const count = countGroupCumulative(grp, notesByGroupId);
	const row = containerEl.createDiv({ cls: "qnb-cat-stats-row" });
	row.setCssStyles({ paddingLeft: `${depth * 18}px` });
	row.createSpan({ cls: "qnb-cat-stats-name", text: grp.name });
	row.createSpan({ cls: "qnb-cat-stats-count", text: tr("modal.categoryStats.noteCount", { count: String(count) }) });

	for (const child of grp.groups) {
		renderGroupNode(containerEl, child, notesByGroupId, depth + 1, tr);
	}
}

/** Disegna, dentro containerEl, la riga "senza gruppo" e l'intero albero di gruppi/sottogruppi
 * di una categoria, ognuno col conteggio di note "di ramo". */
function renderCategoryGroupTree(
	containerEl: HTMLElement,
	category: QnbCategory,
	categoryNotes: QuickNote[],
	tr: (key: string, vars?: Record<string, string>) => string
) {
	const notesByGroupId = buildNotesByGroupId(categoryNotes);

	const noGroupCount = (notesByGroupId.get("") || []).length;
	const noGroupRow = containerEl.createDiv({ cls: "qnb-cat-stats-row" });
	noGroupRow.createSpan({ cls: "qnb-cat-stats-name qnb-cat-stats-nogroup", text: tr("modal.categoryStats.noGroup") });
	noGroupRow.createSpan({
		cls: "qnb-cat-stats-count",
		text: tr("modal.categoryStats.noteCount", { count: String(noGroupCount) }),
	});

	for (const grp of category.groups) {
		renderGroupNode(containerEl, grp, notesByGroupId, 1, tr);
	}
}

/** Disegna dentro `el` la barra del titolo di una categoria, com'è il titolo di una nota di
 * quella categoria: sfondo (colore, oppure sfumatura, anche animata), icona con il suo colore
 * e testo con il colore del testo scelto per la categoria. Serve da titolo alle finestre
 * della categoria e da anteprima dal vivo in "Colori categoria". */
function renderCategoryBar(el: HTMLElement, cat: QnbCategory, label: string) {
	el.empty();
	const bg = resolveCategoryBackground(cat);
	el.setCssStyles({ backgroundColor: bg.color, backgroundImage: bg.image ?? "none" });
	el.setCssStyles({ color: getContrastTextColor(bg.contrastBase) });
	// ===== ANIMAZIONE SFUMATURA (inizio) =====
	el.toggleClass("qnb-gradient-animated", bg.animated && !bg.animateHoverOnly);
	el.toggleClass("qnb-gradient-animate-hover", bg.animated && bg.animateHoverOnly);
	if (bg.animated) el.setCssProps({ "--qnb-gradient-anim-seconds": `${bg.animationSeconds}s` });
	// ===== ANIMAZIONE SFUMATURA (fine) =====
	if (cat.icon) {
		const iconEl = el.createSpan({ cls: "qnb-category-preview-icon" });
		setIcon(iconEl, cat.icon);
		if (cat.iconColor) iconEl.setCssStyles({ color: cat.iconColor });
	}
	const titleEl = el.createSpan({ cls: "qnb-category-preview-title", text: label });
	if (cat.titleColor) titleEl.setCssStyles({ color: cat.titleColor });
}

/** Crea la barra del titolo di una finestra e la mette in cima alla finestra stessa, a filo del
 * bordo e a tutta larghezza (come l'intestazione di una nota). Lo spazio interno della finestra
 * e l'arrotondamento degli angoli si leggono da quelli reali, così la barra combacia con
 * qualunque tema. La X di chiusura di Obsidian, in alto a destra, ricade dentro la barra, sulla
 * stessa riga del titolo. */
function mountCategoryBar(modalEl: HTMLElement): HTMLElement {
	const bar = modalEl.createDiv({ cls: "qnb-category-preview qnb-category-title-bar" });
	modalEl.prepend(bar);
	const cs = window.getComputedStyle(modalEl);
	const px = (value: string, fallback: number) => {
		const n = parseFloat(value);
		return Number.isFinite(n) ? n : fallback;
	};
	bar.setCssProps({
		"--qnb-bleed-top": `${px(cs.paddingTop, 16)}px`,
		"--qnb-bleed-left": `${px(cs.paddingLeft, 16)}px`,
		"--qnb-bleed-right": `${px(cs.paddingRight, 16)}px`,
		"--qnb-bleed-radius": `${px(cs.borderTopLeftRadius, 12)}px`,
	});
	return bar;
}

/** Mette in cima a una finestra legata a una nota la stessa barra del titolo delle finestre
 * della categoria, con i colori della categoria a cui la nota appartiene: così la finestra
 * si riconosce come "di quella categoria". Torna true se ha messo la barra; false se la
 * categoria non esiste più (nota con categoria sconosciuta): il chiamante tiene allora il
 * titolo semplice di sempre. Si può richiamare più volte (finestre che si ridisegnano). */
function mountNoteWindowBar(modal: Modal, plugin: QuickNotesBoardPlugin, categoryName: string | undefined, title: string): boolean {
	const cat = categoryName ? plugin.settings.categories.find((c) => c.name === categoryName) : undefined;
	if (!cat) return false;
	modal.modalEl.addClass("qnb-category-modal");
	modal.modalEl.querySelector(":scope > .qnb-category-title-bar")?.remove();
	renderCategoryBar(mountCategoryBar(modal.modalEl), cat, title);
	return true;
}

export class CategoryStatsModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private category: QnbCategory;
	private barEl: HTMLElement | null = null;

	constructor(app: App, plugin: QuickNotesBoardPlugin, category: QnbCategory) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.category = category;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-category-stats");
		this.modalEl.addClass("qnb-category-modal");
		this.barEl = mountCategoryBar(this.modalEl);
		this.render();
	}

	/** Disegna il contenuto; si richiama anche dopo una rinomina, per mostrare il nuovo nome. */
	private render() {
		const { contentEl } = this;
		contentEl.empty();
		if (this.barEl) {
			renderCategoryBar(this.barEl, this.category, this.tr("modal.categoryStats.title", { category: this.category.name }));
		}

		const activeNotes = this.plugin.notes.filter(
			(n) => !n.deleted && !n.archived && n.category === this.category.name
		);

		const treeEl = contentEl.createDiv({ cls: "qnb-cat-stats-tree" });
		renderCategoryGroupTree(treeEl, this.category, activeNotes, (key, vars) => this.tr(key, vars));

		const totalNotes = activeNotes.length;
		const encryptedCount = activeNotes.filter((n) => n.encrypted).length;
		const totalChars = activeNotes
			.filter((n) => !n.encrypted)
			.reduce((sum, n) => sum + n.content.length, 0);

		const summary = contentEl.createDiv({ cls: "qnb-cat-stats-summary" });
		summary.createDiv({
			cls: "qnb-cat-stats-summary-row",
			text: this.tr("modal.categoryStats.totalNotes", { count: String(totalNotes) }),
		});
		summary.createDiv({
			cls: "qnb-cat-stats-summary-row",
			text: this.tr("modal.categoryStats.totalChars", { count: String(totalChars) }),
		});
		if (encryptedCount > 0) {
			summary.createDiv({
				cls: "setting-item-description",
				text: this.tr("modal.categoryStats.encryptedExcluded", { count: String(encryptedCount) }),
			});
		}

		// Riga finale: "Rinomina categoria" a sinistra, "Chiudi" a destra (stesso schema del
		// pannello informativo della nota).
		const footer = contentEl.createDiv({ cls: "qnb-note-info-footer" });
		const actions = footer.createDiv({ cls: "qnb-note-info-footer-start" });
		new ButtonComponent(actions).setButtonText(this.tr("modal.categoryStats.rename")).onClick(() => {
			new RenameCategoryModal(this.app, this.plugin, this.category, (newName) => {
				this.category = this.plugin.settings.categories.find((c) => c.name === newName) ?? this.category;
				this.render();
			}).open();
		});
		new ButtonComponent(actions).setButtonText(this.tr("modal.categoryStats.colors")).onClick(() => {
			new CategoryStyleModal(this.app, this.plugin, this.category).open();
		});
		new ButtonComponent(footer).setButtonText(this.tr("trash.close")).onClick(() => this.close());
	}

	onClose() {
		this.barEl?.remove();
		this.contentEl.empty();
	}
}

/** Piccola finestra per rinominare una categoria dalla finestra della sua struttura, senza
 * passare dalle impostazioni. Usa la stessa rinomina delle impostazioni
 * (`plugin.renameCategory`): aggiorna la categoria e tutte le sue note. */
export class RenameCategoryModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private category: QnbCategory;
	private onRenamed: (newName: string) => void;
	private value: string;
	private errorEl: HTMLElement | null = null;
	private barEl: HTMLElement | null = null;

	constructor(app: App, plugin: QuickNotesBoardPlugin, category: QnbCategory, onRenamed: (newName: string) => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.category = category;
		this.onRenamed = onRenamed;
		this.value = category.name;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("qnb-category-modal");
		this.barEl = mountCategoryBar(this.modalEl);
		renderCategoryBar(this.barEl, this.category, this.tr("modal.renameCategory.title"));

		new Setting(contentEl).setName(this.tr("modal.renameCategory.nameLabel")).addText((text) => {
			text.setValue(this.value).onChange((v) => {
				this.value = v;
				this.setError("");
			});
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					void this.submit();
				}
			});
			window.setTimeout(() => {
				text.inputEl.focus();
				text.inputEl.select();
			}, 0);
		});
		this.errorEl = contentEl.createDiv({ cls: "qnb-rename-category-error" });

		const footer = contentEl.createDiv({ cls: "qnb-note-info-footer" });
		new ButtonComponent(footer).setButtonText(this.tr("modal.cancel")).onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText(this.tr("modal.renameCategory.confirm"))
			.setCta()
			.onClick(() => void this.submit());
	}

	private setError(message: string) {
		this.errorEl?.setText(message);
	}

	private async submit() {
		const newName = this.value.trim();
		if (!newName) {
			this.setError(this.tr("modal.renameCategory.empty"));
			return;
		}
		if (newName === this.category.name) {
			this.close();
			return;
		}
		// Un nome già usato da un'altra categoria, senza badare alle maiuscole.
		const taken = this.plugin.settings.categories.some(
			(c) => c !== this.category && c.name.toLowerCase() === newName.toLowerCase()
		);
		if (taken || !(await this.plugin.renameCategory(this.category.name, newName))) {
			this.setError(this.tr("settings.categories.new.duplicate"));
			return;
		}
		this.close();
		this.onRenamed(newName);
	}

	onClose() {
		this.barEl?.remove();
		this.contentEl.empty();
	}
}

/** Finestra "Colori categoria": gli stessi controlli che le impostazioni offrono per una
 * categoria (colori, sfumatura, animazione, orientamento, icona e colore dell'icona), così
 * se ne cambia l'aspetto direttamente dalla board, senza aprire le impostazioni. Ogni scelta
 * si salva subito, con le stesse funzioni delle impostazioni. I selettori di colore salvano
 * quando li si rilascia: mentre li si trascina si muove solo l'anteprima della finestra,
 * per non ridisegnare la board a ogni sfumatura di colore. */
export class CategoryStyleModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private category: QnbCategory;
	/** Valori dei selettori di colore mentre li si trascina: mostrati nell'anteprima, non ancora salvati. */
	private draft: Partial<QnbCategory> = {};
	private previewEl: HTMLElement | null = null;

	constructor(app: App, plugin: QuickNotesBoardPlugin, category: QnbCategory) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.category = category;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		const { contentEl } = this;
		this.modalEl.addClass("qnb-category-style-modal");
		this.modalEl.addClass("qnb-category-modal");
		contentEl.empty();
		this.draft = {};
		// La barra del titolo fa anche da anteprima: cambia mentre si modificano i colori.
		this.previewEl = mountCategoryBar(this.modalEl);
		this.renderPreview();
		this.buildColors(contentEl);
		this.buildGradient(contentEl);
		this.buildIconPicker(contentEl);
		new Setting(contentEl).addButton((btn) => btn.setButtonText(this.tr("trash.close")).onClick(() => this.close()));
	}

	onClose() {
		this.previewEl?.remove();
		this.contentEl.empty();
	}

	/** Collega un selettore di colore: mentre lo si trascina (`input`) muove solo l'anteprima,
	 * quando lo si rilascia (`change`) salva. */
	private bindColorPicker(
		cp: ColorComponent,
		label: string,
		onDraft: (value: string) => void,
		onCommit: (value: string) => Promise<void>
	) {
		const el = (cp as unknown as { colorPickerEl: HTMLInputElement }).colorPickerEl;
		el.setAttr("aria-label", label);
		el.addEventListener("input", () => onDraft(el.value));
		el.addEventListener("change", () => void onCommit(el.value));
	}

	/** Ridisegna la barra del titolo della finestra, che fa da anteprima: usa i valori in corso
	 * di modifica (colori trascinati e non ancora salvati), se ci sono. */
	private renderPreview() {
		if (!this.previewEl) return;
		const view: QnbCategory = { ...this.category, ...this.draft };
		renderCategoryBar(this.previewEl, view, this.tr("modal.categoryStyle.title", { category: view.name }));
	}

	/** Colore della categoria e colore del testo con "Predefinito". */
	private buildColors(containerEl: HTMLElement) {
		const cat = this.category;
		const colorsRow = new Setting(containerEl).setName(this.tr("settings.categories.colorsLabel"));
		colorsRow.addColorPicker((cp) => {
			cp.setValue(cat.color);
			this.bindColorPicker(
				cp,
				this.tr("settings.categories.bgColorTooltip"),
				(value) => {
					this.draft.color = value;
					this.renderPreview();
				},
				async (value) => {
					await this.plugin.updateCategoryColor(cat.name, value);
					delete this.draft.color;
					this.renderPreview();
				}
			);
		});

		let titleColorPicker: ColorComponent | null = null;
		colorsRow.addColorPicker((cp) => {
			titleColorPicker = cp;
			cp.setValue(cat.titleColor || "#ffffff");
			this.bindColorPicker(
				cp,
				this.tr("settings.categories.titleColorTooltip"),
				(value) => {
					this.draft.titleColor = value;
					this.renderPreview();
				},
				async (value) => {
					await this.plugin.updateCategoryTitleColor(cat.name, value);
					delete this.draft.titleColor;
					this.renderPreview();
				}
			);
		});
		colorsRow.addButton((btn) =>
			btn
				.setButtonText(this.tr("settings.categories.titleColorReset"))
				.setTooltip(this.tr("settings.categories.titleColorResetTooltip"))
				.onClick(async () => {
					await this.plugin.updateCategoryTitleColor(cat.name, "");
					delete this.draft.titleColor;
					titleColorPicker?.setValue("#ffffff");
					this.renderPreview();
				})
		);

	}

	/** Sfumatura di sfondo, colore finale, animazione (con durata e "solo al passaggio del
	 * mouse") e orientamento. I controlli si mostrano e si nascondono sul posto. */
	private buildGradient(containerEl: HTMLElement) {
		const cat = this.category;
		const gradientToggleRow = new Setting(containerEl)
			.setName(this.tr("settings.categories.gradient.label"))
			.setDesc(this.tr("settings.categories.gradient.desc"));
		const gradientControls = containerEl.createDiv({ cls: "qnb-gradient-controls" });
		const setGradientControlsVisible = (visible: boolean) => {
			gradientControls.setCssStyles({ display: visible ? "block" : "none" });
		};
		let gradientEndPicker: ColorComponent | null = null;
		gradientToggleRow.addToggle((toggle) => {
			toggle.setValue(cat.gradientEnabled === true);
			toggle.onChange(async (value) => {
				if (value && !isHexColor(cat.gradientEndColor)) {
					// Prima volta: propone un colore finale, così l'effetto si vede subito.
					const proposed = defaultGradientEndColor(cat.color);
					await this.plugin.updateCategoryGradient(cat.name, { enabled: true, endColor: proposed });
					gradientEndPicker?.setValue(proposed);
				} else {
					await this.plugin.updateCategoryGradient(cat.name, { enabled: value });
				}
				setGradientControlsVisible(value);
				this.renderPreview();
			});
		});
		setGradientControlsVisible(cat.gradientEnabled === true);

		new Setting(gradientControls)
			.setName(this.tr("settings.categories.gradient.endColor"))
			.addColorPicker((cp) => {
				gradientEndPicker = cp;
				// Se il colore finale non è mai stato scelto si parte dal colore di inizio.
				cp.setValue(isHexColor(cat.gradientEndColor) ? cat.gradientEndColor : cat.color);
				this.bindColorPicker(
					cp,
					this.tr("settings.categories.gradient.endColorTooltip"),
					(value) => {
						this.draft.gradientEndColor = value;
						this.renderPreview();
					},
					async (value) => {
						await this.plugin.updateCategoryGradient(cat.name, { endColor: value });
						delete this.draft.gradientEndColor;
						this.renderPreview();
					}
				);
			});

		// ===== ANIMAZIONE SFUMATURA (inizio) =====
		const animationToggleRow = new Setting(gradientControls).setName(
			this.tr("settings.categories.gradient.animation.label")
		);
		const animationDurationRow = new Setting(gradientControls)
			.setClass("qnb-gradient-animation-row")
			.setName(this.tr("settings.categories.gradient.animation.duration"));
		const animationHoverOnlyRow = new Setting(gradientControls)
			.setClass("qnb-gradient-animation-row")
			.setName(this.tr("settings.categories.gradient.animation.hoverOnly"));
		const setAnimationSubOptionsVisible = (visible: boolean) => {
			const display = visible ? "flex" : "none";
			animationDurationRow.settingEl.setCssStyles({ display });
			animationHoverOnlyRow.settingEl.setCssStyles({ display });
		};
		animationToggleRow.addToggle((toggle) => {
			toggle.setValue(cat.gradientAnimated === true);
			toggle.onChange(async (value) => {
				await this.plugin.updateCategoryGradient(cat.name, { animated: value });
				setAnimationSubOptionsVisible(value);
				this.renderPreview();
			});
		});
		animationDurationRow.addSlider((slider) => {
			slider
				.setLimits(1, 10, 1)
				.setValue(normalizeGradientAnimationSeconds(cat.gradientAnimationSeconds))
				.onChange(async (value) => {
					await this.plugin.updateCategoryGradient(cat.name, { animationSeconds: value });
					this.renderPreview();
				});
		});
		animationHoverOnlyRow.addToggle((toggle) => {
			toggle.setValue(cat.gradientAnimateHoverOnly === true);
			toggle.onChange(async (value) => {
				await this.plugin.updateCategoryGradient(cat.name, { hoverOnly: value });
				this.renderPreview();
			});
		});
		setAnimationSubOptionsVisible(cat.gradientAnimated === true);
		// ===== ANIMAZIONE SFUMATURA (fine) =====

		new Setting(gradientControls)
			.setName(this.tr("settings.categories.gradient.direction"))
			.addDropdown((dd) => {
				for (const opt of GRADIENT_DIRECTIONS) dd.addOption(opt.value, this.tr(opt.labelKey));
				dd.setValue(cat.gradientDirection ?? "to-right");
				dd.onChange(async (value) => {
					await this.plugin.updateCategoryGradient(cat.name, { direction: value as QnbGradientDirection });
					this.renderPreview();
				});
			});
	}

	/** Icona prima del titolo delle note: galleria delle icone rapide, campo libero per
	 * qualsiasi icona Lucide, colore dell'icona e collegamento alla libreria. */
	private buildIconPicker(containerEl: HTMLElement) {
		const cat = this.category;
		const wrapper = containerEl.createDiv({ cls: "qnb-icon-picker" });
		wrapper.createSpan({ cls: "qnb-icon-picker-label", text: this.tr("settings.categories.iconTooltip") });

		const grid = wrapper.createDiv({ cls: "qnb-icon-picker-grid" });
		const quickButtons: HTMLElement[] = [];
		const highlightQuickMatch = (value: string) => {
			for (const b of quickButtons) b.removeClass("is-selected");
			const idx = CATEGORY_ICON_OPTIONS.findIndex((o) => o.value === value);
			if (idx !== -1) quickButtons[idx].addClass("is-selected");
		};

		const customRow = wrapper.createDiv({ cls: "qnb-icon-picker-custom" });
		const customPreview = customRow.createDiv({ cls: "qnb-icon-picker-custom-preview" });
		const updateCustomPreview = (value: string) => {
			customPreview.empty();
			const trimmed = value.trim();
			if (trimmed) setIcon(customPreview, trimmed);
		};
		const customInput = customRow.createEl("input", {
			cls: "qnb-icon-picker-custom-input",
			attr: { type: "text", placeholder: this.tr("settings.categories.iconCustomPlaceholder") },
		});

		for (const opt of CATEGORY_ICON_OPTIONS) {
			const btn = grid.createEl("button", { cls: "qnb-icon-picker-btn", attr: { type: "button" } });
			setIcon(btn, opt.value || "slash");
			btn.setAttr("aria-label", this.tr(opt.labelKey));
			if ((cat.icon || "") === opt.value) btn.addClass("is-selected");
			quickButtons.push(btn);
			btn.addEventListener("click", () => {
				void (async () => {
					cat.icon = opt.value;
					await this.plugin.updateCategoryIcon(cat.name, opt.value);
					this.renderPreview();
					highlightQuickMatch(opt.value);
					customInput.value = "";
					updateCustomPreview("");
				})();
			});
		}

		const isQuickIcon = CATEGORY_ICON_OPTIONS.some((o) => o.value === (cat.icon || ""));
		if (!isQuickIcon && cat.icon) customInput.value = cat.icon;
		updateCustomPreview(customInput.value);
		customInput.addEventListener("input", () => updateCustomPreview(customInput.value));

		const applyCustom = async () => {
			const trimmed = customInput.value.trim();
			if (trimmed === (cat.icon || "")) return;
			cat.icon = trimmed;
			await this.plugin.updateCategoryIcon(cat.name, trimmed);
			this.renderPreview();
			highlightQuickMatch(trimmed);
		};
		customInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void applyCustom();
			}
		});
		customRow
			.createEl("button", {
				cls: "qnb-icon-picker-custom-apply",
				attr: { type: "button" },
				text: this.tr("settings.categories.iconCustomApply"),
			})
			.addEventListener("click", () => void applyCustom());

		// Colore dell'icona: vale sia per le icone rapide sia per quella libera.
		customPreview.setCssStyles({ color: cat.iconColor || "" });
		const colorRow = wrapper.createDiv({ cls: "qnb-icon-picker-color-row" });
		colorRow.createSpan({ cls: "qnb-icon-picker-color-label", text: this.tr("settings.categories.iconColorLabel") });
		const colorInput = colorRow.createEl("input", { cls: "qnb-icon-picker-color-input", attr: { type: "color" } });
		colorInput.value = cat.iconColor || "#ffffff";
		colorInput.addEventListener("input", () => {
			customPreview.setCssStyles({ color: colorInput.value });
			this.draft.iconColor = colorInput.value;
			this.renderPreview();
		});
		colorInput.addEventListener("change", () => {
			void (async () => {
				await this.plugin.updateCategoryIconColor(cat.name, colorInput.value);
				delete this.draft.iconColor;
				this.renderPreview();
			})();
		});
		colorRow
			.createEl("button", {
				cls: "qnb-icon-picker-custom-apply",
				attr: { type: "button" },
				text: this.tr("settings.categories.titleColorReset"),
			})
			.addEventListener("click", () => {
				void (async () => {
					await this.plugin.updateCategoryIconColor(cat.name, "");
					delete this.draft.iconColor;
					colorInput.value = "#ffffff";
					customPreview.setCssStyles({ color: "" });
					this.renderPreview();
				})();
			});

		const hintRow = wrapper.createDiv({ cls: "qnb-icon-picker-hint-row" });
		hintRow.createDiv({ cls: "qnb-icon-picker-hint", text: this.tr("settings.categories.iconCustomHint") });
		const libraryLinkBtn = hintRow.createEl("button", { cls: "qnb-icon-picker-link-btn", attr: { type: "button" } });
		setIcon(libraryLinkBtn.createSpan({ cls: "qnb-btn-icon" }), "external-link");
		libraryLinkBtn.createSpan({ text: this.tr("settings.categories.iconLibraryLink") });
		libraryLinkBtn.addEventListener("click", () => {
			window.open("https://lucide.dev/icons/", "_blank");
		});
	}
}

/** Finestra "Etichette": le stesse funzioni dell'elenco etichette delle impostazioni (creare,
 * rinominare, cambiare colore, riordinare trascinando, eliminare), così si gestiscono
 * direttamente dalla board. Si salva con la stessa funzione delle impostazioni
 * (`plugin.setLabels`). Nome e colore salvano quando si conferma (Invio, uscita dal campo,
 * rilascio del selettore), non a ogni tasto o sfumatura: ogni salvataggio ridisegna la board. */
export class LabelsManagerModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private listEl: HTMLElement | null = null;
	private draggedId: string | null = null;

	constructor(app: App, plugin: QuickNotesBoardPlugin) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-label-assign");
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(this.tr("settings.labels.heading")).setHeading();
		contentEl.createEl("p", { cls: "setting-item-description", text: this.tr("settings.labels.intro") });
		this.listEl = contentEl.createDiv({ cls: "qnb-groups-list" });
		this.renderList();
		new Setting(contentEl).addButton((btn) => btn.setButtonText(this.tr("trash.close")).onClick(() => this.close()));
	}

	onClose() {
		this.contentEl.empty();
	}

	/** Ridisegna l'elenco; `focusId` è l'etichetta il cui nome va selezionato (appena creata). */
	private renderList(focusId?: string) {
		const listEl = this.listEl;
		if (!listEl) return;
		listEl.empty();

		for (const label of this.plugin.settings.labels) {
			const row = new Setting(listEl).setClass("qnb-group-row");

			// Maniglia: si trascina la riga per riordinare, come nelle impostazioni.
			const handle = createSpan({ cls: "qnb-drag-handle qnb-group-drag-handle" });
			setIcon(handle, "grip-vertical");
			row.settingEl.prepend(handle);
			row.settingEl.addClass("qnb-group-row-draggable");
			handle.addEventListener("mousedown", () => row.settingEl.setAttribute("draggable", "true"));
			row.settingEl.addEventListener("dragend", () => {
				row.settingEl.removeAttribute("draggable");
				row.settingEl.removeClass("qnb-drag-over");
			});
			row.settingEl.addEventListener("dragstart", () => {
				this.draggedId = label.id;
			});
			row.settingEl.addEventListener("dragover", (evt) => {
				if (this.draggedId === null) return;
				evt.preventDefault();
				row.settingEl.addClass("qnb-drag-over");
			});
			row.settingEl.addEventListener("dragleave", () => row.settingEl.removeClass("qnb-drag-over"));
			row.settingEl.addEventListener("drop", (evt) => {
				void (async () => {
					evt.preventDefault();
					row.settingEl.removeClass("qnb-drag-over");
					const fromId = this.draggedId;
					this.draggedId = null;
					if (!fromId || fromId === label.id) return;
					const current = [...this.plugin.settings.labels];
					const fromIdx = current.findIndex((l) => l.id === fromId);
					if (fromIdx === -1) return;
					const [moved] = current.splice(fromIdx, 1);
					const toIdx = current.findIndex((l) => l.id === label.id);
					current.splice(toIdx === -1 ? current.length : toIdx, 0, moved);
					await this.plugin.setLabels(current);
					this.renderList();
				})();
			});

			// Colore: salva al rilascio del selettore.
			row.addColorPicker((cp) => {
				cp.setValue(label.color || "#888888");
				const el = (cp as unknown as { colorPickerEl: HTMLInputElement }).colorPickerEl;
				el.addEventListener("change", () => {
					void this.updateLabel(label.id, { color: el.value });
				});
			});

			// Nome: salva quando si conferma. Un nome vuoto torna a quello di prima.
			let savedName = label.name;
			row.addText((text) => {
				text.setValue(label.name);
				text.inputEl.addEventListener("change", () => {
					const name = text.inputEl.value.trim();
					if (!name) {
						text.inputEl.value = savedName;
						return;
					}
					savedName = name;
					text.inputEl.value = name;
					void this.updateLabel(label.id, { name });
				});
				if (label.id === focusId) {
					window.setTimeout(() => {
						text.inputEl.focus();
						text.inputEl.select();
					}, 0);
				}
			});

			row.addExtraButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip(this.tr("settings.labels.delete"))
					.onClick(() => {
						void (async () => {
							await this.plugin.setLabels(this.plugin.settings.labels.filter((l) => l.id !== label.id));
							this.renderList();
						})();
					})
			);
		}

		new Setting(listEl).addButton((btn) =>
			btn.setButtonText(this.tr("settings.labels.add")).onClick(() => {
				void (async () => {
					const newLabel: QnbLabel = {
						id: "lbl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
						name: this.tr("settings.labels.newName"),
						color: "#888888",
					};
					await this.plugin.setLabels([...this.plugin.settings.labels, newLabel]);
					this.renderList(newLabel.id);
				})();
			})
		);
	}

	private async updateLabel(id: string, patch: Partial<QnbLabel>) {
		await this.plugin.setLabels(this.plugin.settings.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	}
}

/** Finestra informativa (sola lettura) sull'intera board: tutte le categorie con la loro
 * struttura di gruppi/sottogruppi (conteggio note per ramo), totale note, e data/dimensione
 * del file dati su disco. */
export class BoardInfoModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;

	constructor(app: App, plugin: QuickNotesBoardPlugin) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-board-info");
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(this.tr("modal.boardInfo.title")).setHeading();

		const activeNotes = this.plugin.notes.filter((n) => !n.deleted && !n.archived);

		for (const cat of this.plugin.settings.categories) {
			const catNotes = activeNotes.filter((n) => n.category === cat.name);

			const catSection = contentEl.createDiv({ cls: "qnb-board-info-category" });
			const catHeader = catSection.createDiv({ cls: "qnb-board-info-category-header" });
			catHeader.setCssProps({ "--qnb-cat-color": cat.color });
			catHeader.createSpan({ cls: "qnb-board-info-category-dot" });
			catHeader.createSpan({ cls: "qnb-board-info-category-name", text: cat.name });
			catHeader.createSpan({
				cls: "qnb-cat-stats-count",
				text: this.tr("modal.categoryStats.noteCount", { count: String(catNotes.length) }),
			});
		}

		const summary = contentEl.createDiv({ cls: "qnb-cat-stats-summary" });
		summary.createDiv({
			cls: "qnb-cat-stats-summary-row",
			text: this.tr("modal.boardInfo.totalCategories", { count: String(this.plugin.settings.categories.length) }),
		});
		summary.createDiv({
			cls: "qnb-cat-stats-summary-row",
			text: this.tr("modal.boardInfo.totalNotes", { count: String(activeNotes.length) }),
		});

		const archivedCount = this.plugin.notes.filter((n) => !n.deleted && n.archived).length;
		const trashedCount = this.plugin.notes.filter((n) => n.deleted).length;
		const encryptedCount = this.plugin.notes.filter((n) => n.encrypted).length;
		summary.createDiv({
			text: this.tr("modal.boardInfo.archivedCount", { count: String(archivedCount) }),
		});
		summary.createDiv({
			text: this.tr("modal.boardInfo.trashedCount", { count: String(trashedCount) }),
		});
		summary.createDiv({
			text: this.tr("modal.boardInfo.encryptedCount", { count: String(encryptedCount) }),
		});

		// Lettura da disco: asincrona, il resto della finestra è già pronto; questa
		// sezione si completa da sola appena la stat del file è disponibile.
		const statHost = summary.createDiv({ text: this.tr("modal.boardInfo.loading") });
		void this.plugin.getNotesFileStat().then(async (stat) => {
			statHost.empty();
			if (stat) {
				statHost.createDiv({
					text: this.tr("modal.boardInfo.created", { date: new Date(stat.ctime).toLocaleString() }),
				});
				statHost.createDiv({
					text: this.tr("modal.boardInfo.modified", { date: new Date(stat.mtime).toLocaleString() }),
				});

				if (this.plugin.settings.compressionEnabled) {
					// Compressione attiva: mostro dimensione su disco, dimensione reale del
					// contenuto, e la percentuale di risparmio — invece della singola riga
					// di sempre, che qui basterebbe da sola a fare confusione.
					const sizeInfo = await this.plugin.getNotesFileSizeInfo();
					if (sizeInfo) {
						statHost.createDiv({
							text: this.tr("modal.boardInfo.compressedSize", {
								size: sizeInfo.onDisk.toLocaleString(),
							}),
						});
						statHost.createDiv({
							text: this.tr("modal.boardInfo.realSize", { size: sizeInfo.real.toLocaleString() }),
						});
						if (sizeInfo.real > 0) {
							const savingsPercent = Math.max(
								0,
								Math.round((1 - sizeInfo.onDisk / sizeInfo.real) * 100)
							);
							statHost.createDiv({
								text: this.tr("modal.boardInfo.savings", { percent: String(savingsPercent) }),
							});
						}
					} else {
						statHost.createDiv({
							cls: "setting-item-description",
							text: this.tr("modal.boardInfo.compressionError"),
						});
					}
				} else {
					statHost.createDiv({
						text: this.tr("modal.boardInfo.fileSize", { size: stat.size.toLocaleString() }),
					});
				}
			} else {
				statHost.createDiv({ cls: "setting-item-description", text: this.tr("modal.boardInfo.statError") });
			}
		});

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Finestra "Andamento della board": due grafici a barre (uno per note create, uno per
 * caratteri scritti) per ogni giorno del mese selezionato. Cestino e archivio esclusi. */
export class BoardActivityModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private year: number;
	private month: number; // 0-11
	/** Se true, i giorni senza note né caratteri vengono tolti da entrambi i grafici. */
	private hideEmptyDays: boolean;
	/** Se true, il primo grafico mostra le note modificate per giorno invece di quelle create.
	 * Vale solo per la finestra aperta: a ogni apertura si riparte dalle note create. */
	private showModified: boolean;

	private notesPerDay: { day: number; value: number }[] = [];
	private charsPerDay: { day: number; value: number }[] = [];
	private notesChartWrapper: HTMLElement | null = null;
	private charsChartWrapper: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;

	constructor(app: App, plugin: QuickNotesBoardPlugin) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		const now = new Date();
		this.year = now.getFullYear();
		this.month = now.getMonth();
		this.hideEmptyDays = plugin.settings.activityChartHideEmptyDays;
		this.showModified = plugin.settings.activityChartShowModified;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	private isCurrentMonth(): boolean {
		const now = new Date();
		return this.year === now.getFullYear() && this.month === now.getMonth();
	}

	onOpen() {
		this.plugin.playSound("dialog-board-activity");
		this.modalEl.addClass("qnb-activity-modal-resizable");
		this.modalEl.setCssStyles({ width: `${this.plugin.settings.activityChartWindowWidth}px` });
		this.modalEl.setCssStyles({ height: `${this.plugin.settings.activityChartWindowHeight}px` });

		// I due grafici si ridisegnano da soli, proporzionati allo spazio che hanno
		// davvero a disposizione, ogni volta che quello spazio cambia — sia trascinando
		// la maniglia, sia per qualunque altro motivo. Niente viene mai "stirato": un
		// vettoriale ridisegnato è sempre nitido. Creato PRIMA del render, che si occupa
		// di ri-agganciarlo ai contenitori giusti (anche dopo un cambio mese).
		this.resizeObserver = new ResizeObserver(() => this.redrawCharts());

		this.render();
		this.addResizeHandle();
	}

	/** Maniglia di ridimensionamento nell'angolo in basso a destra della finestra: la
	 * dimensione scelta viene ricordata (salvata nelle impostazioni) al rilascio. */
	private addResizeHandle() {
		const handle = this.modalEl.createDiv({ cls: "qnb-activity-resize-handle" });
		handle.addEventListener("mousedown", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();

			const startX = evt.clientX;
			const startY = evt.clientY;
			const startWidth = this.modalEl.offsetWidth;
			const startHeight = this.modalEl.offsetHeight;

			const onMove = (moveEvt: MouseEvent) => {
				const newWidth = startWidth + (moveEvt.clientX - startX);
				const newHeight = startHeight + (moveEvt.clientY - startY);
				this.modalEl.setCssStyles({ width: `${Math.max(480, newWidth)}px` });
				this.modalEl.setCssStyles({ height: `${Math.max(400, newHeight)}px` });
			};

			const onUp = () => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				void this.plugin.setActivityChartWindowSize(
					this.modalEl.offsetWidth,
					this.modalEl.offsetHeight
				);
			};

			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		});
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("qnb-activity-modal");
		new Setting(contentEl).setName(this.tr("modal.boardActivity.title")).setHeading();

		// Navigazione mese (frecce), senza poter andare oltre il mese corrente.
		const nav = contentEl.createDiv({ cls: "qnb-activity-nav" });
		const prevBtn = nav.createEl("button", { cls: "qnb-btn", attr: { type: "button" } });
		setIcon(prevBtn, "chevron-left");
		prevBtn.addEventListener("click", () => {
			this.month--;
			if (this.month < 0) {
				this.month = 11;
				this.year--;
			}
			this.render();
		});

		const monthLabel = new Date(this.year, this.month, 1).toLocaleDateString(
			this.lang === "it" ? "it-IT" : "en-US",
			{ month: "long", year: "numeric" }
		);
		nav.createSpan({ cls: "qnb-activity-month-label", text: monthLabel });

		const nextBtn = nav.createEl("button", { cls: "qnb-btn", attr: { type: "button" } });
		setIcon(nextBtn, "chevron-right");
		if (this.isCurrentMonth()) {
			nextBtn.setAttr("disabled", "true");
			nextBtn.addClass("qnb-btn-disabled");
		}
		nextBtn.addEventListener("click", () => {
			if (this.isCurrentMonth()) return;
			this.month++;
			if (this.month > 11) {
				this.month = 0;
				this.year++;
			}
			this.render();
		});

		// Un solo passaggio su tutte le note attive per raggrupparle per giorno di
		// creazione (invece di rifiltrare l'intero elenco una volta per ogni giorno del
		// mese): più efficiente su board con molte note.
		const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
		const notesByDay = new Map<number, QuickNote[]>();
		for (const note of this.plugin.notes) {
			if (note.deleted || note.archived) continue; // cestino e archivio esclusi
			const created = new Date(note.createdAt);
			if (created.getFullYear() !== this.year || created.getMonth() !== this.month) continue;
			const day = created.getDate();
			const bucket = notesByDay.get(day);
			if (bucket) bucket.push(note);
			else notesByDay.set(day, [note]);
		}

		this.notesPerDay = [];
		this.charsPerDay = [];
		let totalNotes = 0;
		let totalChars = 0;
		for (let day = 1; day <= daysInMonth; day++) {
			const notesOfDay = notesByDay.get(day) ?? [];
			this.notesPerDay.push({ day, value: notesOfDay.length });
			const chars = notesOfDay.reduce((sum, n) => sum + (n.encrypted ? 0 : n.content.length), 0);
			this.charsPerDay.push({ day, value: chars });
			totalNotes += notesOfDay.length;
			totalChars += chars;
		}

		// Modalità "note modificate": il primo grafico (e il suo totale) leggono il registro
		// attività invece delle date di creazione. Il grafico dei caratteri non cambia.
		if (this.showModified) {
			this.notesPerDay = [];
			totalNotes = 0;
			const mm = String(this.month + 1).padStart(2, "0");
			for (let day = 1; day <= daysInMonth; day++) {
				const ids = this.plugin.activityLog[`${this.year}-${mm}-${String(day).padStart(2, "0")}`];
				const value = ids ? ids.length : 0;
				this.notesPerDay.push({ day, value });
				totalNotes += value;
			}
		}

		// Contenitore dei due grafici: si spartisce tutto lo spazio verticale rimasto
		// (titolo, navigazione, riepilogo e pulsante hanno un'altezza fissa) e lo divide
		// a metà tra i due grafici, sempre insieme e in proporzione, via flexbox — non a
		// calcolo manuale, così resta corretto a qualunque dimensione della finestra.
		const chartsContainer = contentEl.createDiv({ cls: "qnb-activity-charts" });
		this.notesChartWrapper = this.createChartSection(
			chartsContainer,
			this.tr(this.showModified ? "modal.boardActivity.modifiedChart" : "modal.boardActivity.notesChart")
		);
		this.charsChartWrapper = this.createChartSection(
			chartsContainer,
			this.tr("modal.boardActivity.charsChart")
		);
		this.redrawCharts();

		// Ri-aggancia l'osservatore ai contenitori appena creati: quelli di prima (se
		// c'erano, es. dopo un cambio mese) sono già stati rimossi dal DOM qui sopra.
		this.resizeObserver?.disconnect();
		if (this.notesChartWrapper) this.resizeObserver?.observe(this.notesChartWrapper);
		if (this.charsChartWrapper) this.resizeObserver?.observe(this.charsChartWrapper);

		const summary = contentEl.createDiv({ cls: "qnb-cat-stats-summary" });
		summary.createDiv({
			cls: "qnb-cat-stats-summary-row",
			text: this.tr(this.showModified ? "modal.boardActivity.totalModified" : "modal.boardActivity.totalNotes", {
				count: String(totalNotes),
			}),
		});
		summary.createDiv({
			cls: "qnb-cat-stats-summary-row",
			text: this.tr("modal.boardActivity.totalChars", { count: String(totalChars) }),
		});

		// Riga inferiore: toggle a sinistra, "Chiudi" a destra.
		const footer = contentEl.createDiv({ cls: "qnb-activity-footer" });
		const toggles = footer.createDiv({ cls: "qnb-activity-toggles" });

		const modifiedWrap = toggles.createDiv({ cls: "qnb-activity-hide-empty" });
		new ToggleComponent(modifiedWrap).setValue(this.showModified).onChange((value) => {
			this.showModified = value;
			void this.plugin.setActivityChartShowModified(value);
			this.render();
		});
		modifiedWrap.createSpan({ text: this.tr("modal.boardActivity.showModified") });

		const toggleWrap = toggles.createDiv({ cls: "qnb-activity-hide-empty" });
		new ToggleComponent(toggleWrap).setValue(this.hideEmptyDays).onChange((value) => {
			this.hideEmptyDays = value;
			void this.plugin.setActivityChartHideEmptyDays(value);
			this.redrawCharts();
		});
		toggleWrap.createSpan({ text: this.tr("modal.boardActivity.hideEmptyDays") });
		new ButtonComponent(footer)
			.setButtonText(this.tr("trash.close"))
			.onClick(() => this.close());
	}

	/** Crea il titolo e il contenitore (osservato per il ridimensionamento) di un grafico,
	 * senza ancora disegnarci dentro nulla. */
	private createChartSection(containerEl: HTMLElement, title: string): HTMLElement {
		const section = containerEl.createDiv({ cls: "qnb-activity-chart-section" });
		new Setting(section).setName(title).setHeading();
		return section.createDiv({ cls: "qnb-activity-chart-wrapper" });
	}

	/** Ridisegna entrambi i grafici usando la dimensione attuale (misurata) dei loro
	 * contenitori — richiamato all'apertura, al cambio mese, e a ogni ridimensionamento. */
	private redrawCharts() {
		// Con il toggle attivo, un giorno resta solo se ha almeno una nota o un carattere.
		// Il filtro è unico per entrambi i grafici, così mostrano sempre gli stessi giorni.
		const keepDay = (day: number): boolean => {
			if (!this.hideEmptyDays) return true;
			const notes = this.notesPerDay.find((d) => d.day === day)?.value ?? 0;
			const chars = this.charsPerDay.find((d) => d.day === day)?.value ?? 0;
			return notes > 0 || chars > 0;
		};
		const notesData = this.notesPerDay.filter((d) => keepDay(d.day));
		const charsData = this.charsPerDay.filter((d) => keepDay(d.day));

		if (this.notesChartWrapper) {
			this.drawBarChart(
				this.notesChartWrapper,
				notesData,
				this.plugin.settings.activityChartNotesColor || "var(--interactive-accent)"
			);
		}
		if (this.charsChartWrapper) {
			this.drawBarChart(
				this.charsChartWrapper,
				charsData,
				this.plugin.settings.activityChartCharsColor || "var(--color-green, #4caf50)"
			);
		}
	}

	/** Disegna un grafico a barre SVG semplice, senza alcuna libreria esterna: una barra
	 * per ogni giorno, altezza proporzionale al valore massimo del mese, dimensionato
	 * esattamente sullo spazio reale disponibile in quel momento (mai stirato). */
	private drawBarChart(wrapper: HTMLElement, data: { day: number; value: number }[], barColor: string) {
		const width = wrapper.clientWidth;
		const height = wrapper.clientHeight;
		if (width <= 0 || height <= 0) return; // non ancora misurabile (es. primo istante di apertura)

		wrapper.empty();

		// Nessun giorno da mostrare (es. toggle attivo su un mese senza attività).
		if (data.length === 0) {
			wrapper.createDiv({ cls: "qnb-activity-empty", text: this.tr("modal.boardActivity.noActivity") });
			return;
		}

		const topMargin = 22;
		const bottomMargin = 26;
		const maxValue = Math.max(1, ...data.map((d) => d.value));
		const barGap = 3;
		// Con pochi giorni le barre non devono diventare enormi: larghezza massima, barra
		// centrata nel suo spazio. Con molti giorni (mese intero) il limite non interviene.
		const slotWidth = width / data.length;
		const barWidth = Math.min(slotWidth - barGap, 64);

		const svg = wrapper.createSvg("svg", {
			attr: { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" },
			cls: "qnb-activity-svg",
		});
		svg.setCssStyles({ width: `${width}px` });
		svg.setCssStyles({ height: `${height}px` });

		data.forEach((d, idx) => {
			const barHeight = (d.value / maxValue) * (height - bottomMargin - topMargin);
			const x = idx * slotWidth + (slotWidth - barGap - barWidth) / 2;
			const y = height - bottomMargin - barHeight;

			const rect = svg.createSvg("rect", {
				attr: {
					x: String(x),
					y: String(y),
					width: String(Math.max(0.5, barWidth)),
					height: String(Math.max(0, barHeight)),
					fill: barColor,
					rx: "1.5",
				},
			});
			const tooltip = rect.createSvg("title");
			tooltip.textContent = this.tr("modal.boardActivity.dayTooltip", {
				day: String(d.day),
				value: String(d.value),
			});

			// Etichetta di ogni singolo giorno: con il grafico allargato c'è spazio a
			// sufficienza per mostrarle tutte, senza doverne saltare alcuna.
			const label = svg.createSvg("text", {
				attr: {
					x: String(x + barWidth / 2),
					y: String(height - 6),
					"text-anchor": "middle",
				},
				cls: "qnb-activity-axis-label",
			});
			label.textContent = String(d.day);

			// Valore numerico sopra la punta della barra (non sovrapposto al colore),
			// solo se c'è davvero qualcosa da segnalare: uno zero su ogni giorno vuoto
			// sarebbe solo rumore visivo.
			if (d.value > 0) {
				const valueLabel = svg.createSvg("text", {
					attr: {
						x: String(x + barWidth / 2),
						y: String(y - 8),
						"text-anchor": "middle",
					},
					cls: "qnb-activity-value-label",
				});
				valueLabel.textContent = String(d.value);
			}
		});
	}

	onClose() {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.notesChartWrapper = null;
		this.charsChartWrapper = null;
		this.contentEl.empty();
	}
}

/** Finestra per impostare (o modificare) scadenza e avviso di una nota. */
/** Tempo rimasto fino alla fine del giorno di scadenza, in giorni/ore/minuti — o
 * l'indicazione che è già scaduto, se la data è già passata. */
/** Tempo rimasto fino al momento esatto dell'allarme (data + orario di inizio avviso,
 * la stessa coppia mostrata nelle colonne "Data" e "Orario") — o l'indicazione che è già
 * passato, se quel momento è già trascorso. Se l'orario non è impostato, usa la fine del
 * giorno come riferimento (unico caso in cui non c'è un orario preciso da rispettare). */
function formatTimeRemaining(
	dueDate: string,
	reminderStartTime: string | undefined,
	tr: (key: string, vars?: Record<string, string>) => string
): string {
	if (!dueDate) return "";
	const time = reminderStartTime || "23:59:59";
	const target = new Date(`${dueDate}T${time}`).getTime();
	const diffMs = target - Date.now();
	if (diffMs <= 0) return tr("modal.alarmList.overdue");

	const totalMinutes = Math.floor(diffMs / 60000);
	// Sotto il minuto, "0g 0h 0m" sembrerebbe un countdown rotto: distinguiamo
	// esplicitamente questo caso (capita con orari molto ravvicinati, es. test a 2
	// minuti di distanza, dove il tempo residuo scende sotto il minuto pur essendo
	// ancora valido e non scaduto).
	if (totalMinutes <= 0) return tr("modal.alarmList.lessThanAMinute");
	const days = Math.floor(totalMinutes / (24 * 60));
	const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
	const minutes = totalMinutes % 60;
	return tr("modal.alarmList.remaining", {
		days: String(days),
		hours: String(hours),
		minutes: String(minutes),
	});
}

function daysBetween(a: string, b: string): number {
	const d1 = new Date(`${a}T00:00:00`).getTime();
	const d2 = new Date(`${b}T00:00:00`).getTime();
	return Math.round((d2 - d1) / 86400000);
}

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Calcola la prossima scadenza e il relativo inizio avviso secondo la ripetizione
 * scelta, mantenendo la stessa distanza (in giorni) tra i due e lo stesso orario.
 * Gestisce correttamente i mesi più corti e gli anni bisestili (es. 31 gennaio + 1
 * mese non deve mai "sforare" a marzo: si ferma al 28/29 febbraio). */
export function addRepeatInterval(
	dueDate: string,
	reminderStartDate: string,
	repeat: "daily" | "weekly" | "monthly" | "yearly",
	every: number
): { dueDate: string; reminderStartDate: string } {
	const gapDays = daysBetween(reminderStartDate, dueDate);
	const due = new Date(`${dueDate}T00:00:00`);

	if (repeat === "daily") {
		due.setDate(due.getDate() + every);
	} else if (repeat === "weekly") {
		due.setDate(due.getDate() + 7 * every);
	} else if (repeat === "monthly") {
		const day = due.getDate();
		const totalMonths = due.getFullYear() * 12 + due.getMonth() + every;
		const newYear = Math.floor(totalMonths / 12);
		const newMonth = totalMonths % 12;
		const daysInNewMonth = new Date(newYear, newMonth + 1, 0).getDate();
		due.setFullYear(newYear, newMonth, Math.min(day, daysInNewMonth));
	} else {
		const day = due.getDate();
		const month = due.getMonth();
		const newYear = due.getFullYear() + 1;
		const daysInMonth = new Date(newYear, month + 1, 0).getDate();
		due.setFullYear(newYear, month, Math.min(day, daysInMonth));
	}

	const newStart = new Date(due);
	newStart.setDate(newStart.getDate() - gapDays);
	return { dueDate: formatDate(due), reminderStartDate: formatDate(newStart) };
}

/** Vero se la data (YYYY-MM-DD) cade di sabato o di domenica. */
export function isWeekendDate(dateStr: string): boolean {
	const dow = new Date(`${dateStr}T00:00:00`).getDay();
	return dow === 0 || dow === 6;
}

/** Prossima programmazione di un allarme che si ripete. Se "salta sabato e domenica" è
 * attivo e la data calcolata cade nel fine settimana, viene portata al lunedì
 * successivo, mantenendo la stessa distanza tra inizio avviso e scadenza. */
export function computeNextSchedule(
	dueDate: string,
	reminderStartDate: string,
	repeat: "daily" | "weekly" | "monthly" | "yearly",
	every: number,
	skipWeekends: boolean
): { dueDate: string; reminderStartDate: string } {
	let next = addRepeatInterval(dueDate, reminderStartDate, repeat, every);
	if (skipWeekends) {
		let guard = 0;
		while (guard++ < 2 && isWeekendDate(next.dueDate)) {
			next = addRepeatInterval(next.dueDate, next.reminderStartDate, "daily", 1);
		}
	}
	return next;
}

export class DueDateModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private note: QuickNote;
	private onSaved: () => void;

	private dueDate: string;
	private remStartDate: string;
	private remStartTime: string;
	private remInterval: number;
	private repeat: "none" | "daily" | "weekly" | "monthly" | "yearly";
	private repeatEvery: number;
	private skipWeekends: boolean;
	private multipleTimesEnabled: boolean;
	private multipleTimes: string[];

	constructor(app: App, plugin: QuickNotesBoardPlugin, note: QuickNote, onSaved: () => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.note = note;
		this.onSaved = onSaved;
		this.dueDate = note.dueDate || "";
		this.remStartDate = note.reminderStartDate || note.dueDate || "";
		this.remStartTime = note.reminderStartTime || "09:00";
		this.remInterval = note.reminderIntervalMinutes || 30;
		this.repeat = note.reminderRepeat || "none";
		this.repeatEvery = note.reminderRepeatEvery || 1;
		this.skipWeekends = note.skipWeekends || false;
		this.multipleTimesEnabled = !!(note.reminderStartTimes && note.reminderStartTimes.length > 0);
		this.multipleTimes =
			note.reminderStartTimes && note.reminderStartTimes.length > 0
				? [...note.reminderStartTimes]
				: [note.reminderStartTime || "09:00"];
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		if (!mountNoteWindowBar(this, this.plugin, this.note.category, this.tr("modal.dueDate.title"))) {
			new Setting(contentEl).setName(this.tr("modal.dueDate.title")).setHeading();
		}

		new Setting(contentEl).setName(this.tr("modal.dueDate.dueDateLabel")).addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.dueDate);
			text.onChange((v) => (this.dueDate = v));
		});

		new Setting(contentEl).setName(this.tr("modal.dueDate.remStartDateLabel")).addText((text) => {
			text.inputEl.type = "date";
			text.setValue(this.remStartDate);
			text.onChange((v) => (this.remStartDate = v));
		});

		new Setting(contentEl)
			.setName(this.tr("modal.dueDate.multipleTimesLabel"))
			.setDesc(this.tr("modal.dueDate.multipleTimesDesc"))
			.addToggle((toggle) =>
				toggle.setValue(this.multipleTimesEnabled).onChange((value) => {
					this.multipleTimesEnabled = value;
					this.render();
				})
			);

		if (this.multipleTimesEnabled) {
			for (let i = 0; i < this.multipleTimes.length; i++) {
				const idx = i;
				const row = new Setting(contentEl).setName(
					this.tr("modal.dueDate.timeSlotLabel", { n: String(idx + 1) })
				);
				row.addText((text) => {
					text.inputEl.type = "time";
					text.setValue(this.multipleTimes[idx]);
					text.onChange((v) => (this.multipleTimes[idx] = v));
				});
				if (this.multipleTimes.length > 1) {
					row.addExtraButton((btn) =>
						btn
							.setIcon("trash-2")
							.setTooltip(this.tr("modal.dueDate.removeTimeSlot"))
							.onClick(() => {
								this.multipleTimes.splice(idx, 1);
								this.render();
							})
					);
				}
			}
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText(this.tr("modal.dueDate.addTimeSlot")).onClick(() => {
					this.multipleTimes.push("09:00");
					this.render();
				})
			);
		} else {
			new Setting(contentEl).setName(this.tr("modal.dueDate.remStartTimeLabel")).addText((text) => {
				text.inputEl.type = "time";
				text.setValue(this.remStartTime);
				text.onChange((v) => (this.remStartTime = v));
			});
		}

		if (!this.multipleTimesEnabled) {
			new Setting(contentEl)
				.setName(this.tr("modal.dueDate.remIntervalLabel"))
				.setDesc(this.tr("modal.dueDate.remIntervalDesc"))
				.addText((text) => {
					text.inputEl.type = "number";
					text.setValue(String(this.remInterval));
					text.onChange((v) => {
						const parsed = parseInt(v, 10);
						if (Number.isFinite(parsed) && parsed > 0) this.remInterval = parsed;
					});
				});
		}

		new Setting(contentEl)
			.setName(this.tr("modal.dueDate.repeatLabel"))
			.addDropdown((dd) =>
				dd
					.addOption("none", this.tr("modal.dueDate.repeat.none"))
					.addOption("daily", this.tr("modal.dueDate.repeat.daily"))
					.addOption("weekly", this.tr("modal.dueDate.repeat.weekly"))
					.addOption("monthly", this.tr("modal.dueDate.repeat.monthly"))
					.addOption("yearly", this.tr("modal.dueDate.repeat.yearly"))
					.setValue(this.repeat)
					.onChange((value) => {
						this.repeat = value as typeof this.repeat;
						this.render();
					})
			);

		if (this.repeat === "daily" || this.repeat === "weekly" || this.repeat === "monthly") {
			new Setting(contentEl)
				.setName(
					this.repeat === "daily"
						? this.tr("modal.dueDate.everyDaysLabel")
						: this.repeat === "weekly"
							? this.tr("modal.dueDate.everyWeeksLabel")
							: this.tr("modal.dueDate.everyMonthsLabel")
				)
				.addText((text) => {
					text.inputEl.type = "number";
					text.setValue(String(this.repeatEvery));
					text.onChange((v) => {
						const parsed = parseInt(v, 10);
						if (Number.isFinite(parsed) && parsed > 0) this.repeatEvery = parsed;
					});
				});
		}

		new Setting(contentEl)
			.setName(this.tr("modal.dueDate.skipWeekendsLabel"))
			.setDesc(this.tr("modal.dueDate.skipWeekendsDesc"))
			.addToggle((toggle) =>
				toggle.setValue(this.skipWeekends).onChange((value) => {
					this.skipWeekends = value;
				})
			);

		// "Posticipa al prossimo allarme": solo se c'è una scadenza con ripetizione
		// attiva. Lo spostamento avviene solo qui, su richiesta esplicita — mai in
		// automatico — mantenendo la stessa distanza tra inizio avviso e scadenza, lo
		// stesso orario, e lo stesso intervallo di ripetizione.
		if (this.note.dueDate && this.note.reminderRepeat) {
			new Setting(contentEl)
				.setName(this.tr("modal.dueDate.postponeLabel"))
				.setDesc(this.tr("modal.dueDate.postponeDesc"))
				.addButton((btn) =>
					btn.setButtonText(this.tr("modal.dueDate.postponeButton")).onClick(async () => {
						// Stessa identica azione della finestra dell'allarme in corso: un solo
						// calcolo per entrambi, così rispettano allo stesso modo il fine settimana.
						await this.plugin.postponeAlarmToNextSchedule(this.note.id);
						this.dueDate = this.note.dueDate || "";
						this.remStartDate = this.note.reminderStartDate || this.dueDate;
						this.onSaved();
						this.render();
					})
				);
		}

		// Salva/Rimuovi restano in fondo alla finestra, dopo "Posticipa".
		const buttonsRow = new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(this.tr("modal.dueDate.save"))
				.setCta()
				.onClick(async () => {
					if (!this.dueDate) {
						new Notice(this.tr("modal.dueDate.missingDueDate"));
						return;
					}
					this.note.dueDate = this.dueDate;
					this.note.reminderStartDate = this.remStartDate || this.dueDate;
					if (this.multipleTimesEnabled) {
						const cleaned = [...new Set(this.multipleTimes.filter((t) => t))].sort();
						if (cleaned.length === 0) {
							new Notice(this.tr("modal.dueDate.missingTimeSlot"));
							return;
						}
						this.note.reminderStartTimes = cleaned;
						this.note.reminderStartTime = undefined;
					} else {
						this.note.reminderStartTime = this.remStartTime;
						this.note.reminderStartTimes = undefined;
					}
					this.note.reminderIntervalMinutes = this.remInterval;
					this.note.reminderRepeat = this.repeat === "none" ? undefined : this.repeat;
					this.note.reminderRepeatEvery = this.repeat === "none" ? undefined : this.repeatEvery;
					this.note.skipWeekends = this.skipWeekends || undefined;
					// Un allarme appena modificato riparte da zero: niente posticipo residuo.
					this.note.reminderSnoozeUntil = undefined;
					await this.plugin.saveNotes();
					this.onSaved();
					this.close();
				})
		);
		if (this.note.dueDate) {
			buttonsRow.addButton((btn) =>
				btn.setButtonText(this.tr("view.note.removeDueDate")).onClick(async () => {
					this.note.dueDate = undefined;
					this.note.reminderStartDate = undefined;
					this.note.reminderStartTime = undefined;
					this.note.reminderStartTimes = undefined;
					this.note.reminderIntervalMinutes = undefined;
					this.note.reminderRepeat = undefined;
					this.note.reminderRepeatEvery = undefined;
					this.note.skipWeekends = undefined;
					this.note.reminderFireCount = undefined;
					this.note.reminderLastFired = undefined;
					this.note.reminderSnoozeUntil = undefined;
					this.plugin.stopDueAlarm(this.note.id);
					await this.plugin.saveNotes();
					this.onSaved();
					this.close();
				})
			);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Elenco di tutte le quick note con un allarme impostato, ordinate per data più vicina.
 * Cliccando una riga si chiude e si apre direttamente il pannello allarme di quella nota. */
export class AlarmListModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private onOpenAlarm: (note: QuickNote) => void;

	constructor(app: App, plugin: QuickNotesBoardPlugin, onOpenAlarm: (note: QuickNote) => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.onOpenAlarm = onOpenAlarm;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-alarm-list");
		this.modalEl.addClass("qnb-alarm-list-modal-wide");
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(this.tr("modal.alarmList.title")).setHeading();

		const notes = this.plugin.notes
			.filter((n) => !n.deleted && !n.archived && n.dueDate)
			.sort((a, b) => {
				const keyA = `${a.dueDate}T${a.reminderStartTime || "00:00"}`;
				const keyB = `${b.dueDate}T${b.reminderStartTime || "00:00"}`;
				return keyA.localeCompare(keyB);
			});

		if (notes.length === 0) {
			contentEl.createEl("p", { cls: "setting-item-description", text: this.tr("modal.alarmList.empty") });
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
			);
			return;
		}

		const grid = contentEl.createDiv({ cls: "qnb-alarm-grid" });

		const headerRow = grid.createDiv({ cls: "qnb-alarm-grid-row qnb-alarm-grid-header" });
		headerRow.createDiv({ text: this.tr("modal.alarmList.colCategory") });
		headerRow.createDiv({ text: this.tr("modal.alarmList.colGroup") });
		headerRow.createDiv({ text: this.tr("modal.alarmList.colTitle") });
		headerRow.createDiv({ text: this.tr("modal.alarmList.colDate") });
		headerRow.createDiv({ text: this.tr("modal.alarmList.colTime") });
		headerRow.createDiv({ text: this.tr("modal.alarmList.colRemaining") });
		headerRow.createDiv({ text: this.tr("modal.alarmList.colRepetitions") });
		headerRow.createDiv({ text: this.tr("modal.alarmList.colLastFired") });

		for (const note of notes) {
			const row = grid.createDiv({ cls: "qnb-alarm-grid-row qnb-alarm-grid-item" });
			row.addEventListener("click", () => {
				this.close();
				this.onOpenAlarm(note);
			});

			const catCell = row.createDiv({ cls: "qnb-alarm-cell-category" });
			const dot = catCell.createSpan({ cls: "qnb-alarm-cat-dot" });
			const catColor = this.plugin.getCategoryColor(note.category);
			if (catColor) dot.setCssStyles({ background: catColor });
			catCell.createSpan({ text: note.category });

			const groupPath = note.groupId ? this.plugin.getGroupPath(note.category, note.groupId) : "";
			row.createDiv({ text: groupPath || "—" });
			row.createDiv({ text: note.title });
			row.createDiv({ text: note.dueDate || "" });

			const displayTime =
				note.reminderStartTimes && note.reminderStartTimes.length > 0
					? note.reminderStartTimes.join(", ")
					: note.reminderStartTime || "";
			row.createDiv({ text: displayTime });

			// Per le note con più orari, il tempo rimasto va calcolato sul prossimo orario
			// non ancora passato (l'array è già in ordine crescente al salvataggio) — non
			// sul primo in assoluto, altrimenti appena il primo allarme suona la colonna
			// resterebbe ancorata a quell'orario ormai trascorso e mostrerebbe "scaduto"
			// anche quando un allarme successivo dello stesso giorno deve ancora suonare.
			// Se sono già passati tutti, si usa l'ultimo (mostra correttamente "scaduto").
			const timeForCountdown =
				note.reminderStartTimes && note.reminderStartTimes.length > 0
					? (note.reminderStartTimes.find(
							(t) => new Date(`${note.dueDate}T${t}:00`).getTime() > Date.now()
						) ?? note.reminderStartTimes[note.reminderStartTimes.length - 1])
					: note.reminderStartTime;
			// Con un posticipo rapido in corso, al posto del conto alla rovescia (che
			// direbbe "scaduto") si mostra fino a quando l'allarme è in pausa.
			const snoozedUntil =
				note.reminderSnoozeUntil && note.reminderSnoozeUntil > Date.now() ? note.reminderSnoozeUntil : 0;
			row.createDiv({
				text: snoozedUntil
					? this.tr("modal.alarmList.snoozedUntil", { time: formatClock(snoozedUntil) })
					: formatTimeRemaining(note.dueDate || "", timeForCountdown, (key, vars) => this.tr(key, vars)),
			});
			row.createDiv({ text: String(note.reminderFireCount || 0) });

			// Data e ora dell'ultima volta che l'allarme è scattato ("—" se mai).
			let lastFiredText = "—";
			if (note.reminderLastFired) {
				const d = new Date(note.reminderLastFired);
				const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
				lastFiredText = `${day} ${formatClock(note.reminderLastFired)}`;
			}
			row.createDiv({ cls: "qnb-alarm-cell-nowrap", text: lastFiredText });
		}

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Vero se questo gruppo, o un suo qualunque discendente, contiene almeno una nota — per
 * saltare interi rami vuoti invece di mostrarli senza scopo. */
function groupHasNotesRecursive(grp: QnbGroup, notesByGroupId: Map<string, QuickNote[]>): boolean {
	if ((notesByGroupId.get(grp.id) || []).length > 0) return true;
	return grp.groups.some((child) => groupHasNotesRecursive(child, notesByGroupId));
}

/** Elenco complessivo di tutte le quick note (cestino e archivio esclusi), organizzato per
 * categoria, poi gruppo/sottogruppo — con un campo di ricerca per filtrare per titolo.
 * Cliccando una nota si chiude e la porta in primo piano sulla board. */
export class NoteExplorerModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private onSelectNote: (note: QuickNote) => void;
	private filterQuery = "";
	/** Nomi delle categorie attualmente aperte. Vuoto all'apertura della finestra: tutte
	 * collassate finché non le apri (a mano, o automaticamente cercando qualcosa al loro
	 * interno) — non c'è memoria tra un'apertura della finestra e la successiva. */
	private expandedCategories = new Set<string>();

	constructor(app: App, plugin: QuickNotesBoardPlugin, onSelectNote: (note: QuickNote) => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.onSelectNote = onSelectNote;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-note-explorer");
		this.modalEl.addClass("qnb-explorer-modal-wide");
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(this.tr("modal.noteExplorer.title")).setHeading();

		const filterInput = contentEl.createEl("input", {
			cls: "qnb-explorer-filter",
			attr: { type: "text", placeholder: this.tr("modal.noteExplorer.filterPlaceholder") },
		});
		filterInput.value = this.filterQuery;

		const treeEl = contentEl.createDiv({ cls: "qnb-explorer-tree" });

		filterInput.addEventListener("input", () => {
			this.filterQuery = filterInput.value;
			this.renderTree(treeEl);
		});

		this.renderTree(treeEl);

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
		);
	}

	private renderTree(treeEl: HTMLElement) {
		treeEl.empty();
		const query = this.filterQuery.trim().toLowerCase();
		const allNotes = this.plugin.notes.filter((n) => !n.deleted && !n.archived);
		let anyShown = false;

		for (const category of this.plugin.settings.categories) {
			const categoryNotes = allNotes.filter((n) => n.category === category.name);
			if (categoryNotes.length === 0) continue;

			const matchingNotes = query
				? categoryNotes.filter((n) => {
						if ((n.title || "").toLowerCase().includes(query)) return true;
						if (n.labelIds && n.labelIds.length > 0) {
							const labelNames = this.plugin.settings.labels
								.filter((l) => n.labelIds!.includes(l.id))
								.map((l) => l.name.toLowerCase());
							if (labelNames.some((name) => name.includes(query))) return true;
						}
						return false;
					})
				: categoryNotes;
			if (matchingNotes.length === 0) continue;

			anyShown = true;

			// Una ricerca che trova qualcosa qui dentro apre la categoria — e ce la lascia
			// anche dopo aver cancellato la ricerca (nessuna richiusura automatica).
			if (query) this.expandedCategories.add(category.name);
			const isExpanded = this.expandedCategories.has(category.name);

			const catIcon = this.plugin.getCategoryIcon(category.name) || "folder";
			const catHeader = treeEl.createDiv({ cls: "qnb-explorer-category-header" });
			setIcon(catHeader.createSpan({ cls: "qnb-explorer-chevron" }), isExpanded ? "chevron-down" : "chevron-right");
			const dot = catHeader.createSpan({ cls: "qnb-explorer-cat-dot" });
			if (category.color) dot.setCssStyles({ background: category.color });
			setIcon(catHeader.createSpan({ cls: "qnb-explorer-header-icon" }), catIcon);
			catHeader.createSpan({ text: category.name });
			catHeader.addEventListener("click", () => {
				if (this.expandedCategories.has(category.name)) {
					this.expandedCategories.delete(category.name);
				} else {
					this.expandedCategories.add(category.name);
				}
				this.renderTree(treeEl);
			});

			if (!isExpanded) continue; // collassata: nient'altro da disegnare qui sotto

			const notesByGroupId = buildNotesByGroupId(matchingNotes);

			for (const note of notesByGroupId.get("") || []) {
				this.renderNoteRow(treeEl, note, 1);
			}
			for (const grp of category.groups) {
				this.renderGroupBranch(treeEl, grp, notesByGroupId, 1, catIcon);
			}
		}

		if (!anyShown) {
			treeEl.createDiv({
				cls: "setting-item-description",
				text: this.tr(query ? "modal.noteExplorer.noMatch" : "modal.noteExplorer.empty"),
			});
		}
	}

	private renderGroupBranch(
		treeEl: HTMLElement,
		grp: QnbGroup,
		notesByGroupId: Map<string, QuickNote[]>,
		depth: number,
		categoryIcon: string
	) {
		if (!groupHasNotesRecursive(grp, notesByGroupId)) return; // ramo vuoto: salta del tutto

		const row = treeEl.createDiv({ cls: "qnb-explorer-group-header" });
		row.setCssStyles({ paddingLeft: `${depth * 18}px` });
		setIcon(row.createSpan({ cls: "qnb-explorer-header-icon" }), categoryIcon);
		row.createSpan({ text: grp.name });

		for (const note of notesByGroupId.get(grp.id) || []) {
			this.renderNoteRow(treeEl, note, depth + 1);
		}
		for (const child of grp.groups) {
			this.renderGroupBranch(treeEl, child, notesByGroupId, depth + 1, categoryIcon);
		}
	}

	private renderNoteRow(treeEl: HTMLElement, note: QuickNote, depth: number) {
		const row = treeEl.createDiv({ cls: "qnb-explorer-note-row" });
		row.setCssStyles({ paddingLeft: `${depth * 18}px` });
		row.createSpan({ text: note.title || this.tr("modal.noteExplorer.untitled") });

		if (note.labelIds && note.labelIds.length > 0) {
			for (const id of note.labelIds) {
				const label = this.plugin.settings.labels.find((l) => l.id === id);
				if (!label) continue;
				const dot = row.createSpan({ cls: "qnb-label-dot qnb-explorer-note-label-dot" });
				dot.setCssStyles({ background: label.color || "#888888" });
				dot.setAttr("title", label.name);
			}
		}

		row.addEventListener("click", () => {
			this.close();
			this.onSelectNote(note);
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ============================================================
// "Struttura board": diagramma gerarchico di categorie/gruppi/sottogruppi.
// ============================================================

interface QnbStructureNode {
	label: string;
	color: string; // colore CSS già calcolato (colore pieno per la categoria, via via più chiaro scendendo)
	textColor: string;
	children: QnbStructureNode[];
	width: number;
	x?: number;
	y?: number;
	subtreeWidth?: number;
}

function hexToRgbTriplet(hex: string): { r: number; g: number; b: number } {
	const clean = hex.replace("#", "");
	const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
	const num = parseInt(full, 16);
	if (!Number.isFinite(num) || full.length !== 6) return { r: 136, g: 136, b: 136 };
	return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbTripletToHex(r: number, g: number, b: number): string {
	return (
		"#" +
		[r, g, b]
			.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
			.join("")
	);
}

/** Schiarisce un colore verso il bianco: amount 0 = colore originale, 1 = bianco pieno. */
function lightenTowardsWhite(rgb: { r: number; g: number; b: number }, amount: number) {
	return {
		r: rgb.r + (255 - rgb.r) * amount,
		g: rgb.g + (255 - rgb.g) * amount,
		b: rgb.b + (255 - rgb.b) * amount,
	};
}

function estimateStructureNodeWidth(label: string): number {
	const minWidth = 90;
	const estimated = label.length * 7 + 28; // approssimazione per un font ~13px
	return Math.max(minWidth, estimated);
}

/** Costruisce l'albero categoria → gruppi → sottogruppi con colore già calcolato per ogni
 * livello: la categoria ha il colore pieno, ogni livello sotto è progressivamente più
 * chiaro (fino a un massimo, per restare comunque leggibile anche con molti livelli). */
function buildStructureNode(label: string, baseRgb: { r: number; g: number; b: number }, depth: number, groups: QnbGroup[]): QnbStructureNode {
	const amount = Math.min(0.16 * depth, 0.72);
	const rgb = lightenTowardsWhite(baseRgb, amount);
	const hex = rgbTripletToHex(rgb.r, rgb.g, rgb.b);
	return {
		label,
		color: hex,
		textColor: getContrastTextColor(hex),
		width: estimateStructureNodeWidth(label),
		children: groups.map((g) => buildStructureNode(g.name, baseRgb, depth + 1, g.groups)),
	};
}

/** Calcola quanto spazio orizzontale serve per l'intero sottoalbero di questo nodo (sé
 * stesso, se non ha figli; altrimenti la somma dei sottoalberi dei figli, o la propria
 * larghezza se maggiore) — condizione necessaria per non far mai sovrapporre due rami. */
function computeStructureSubtreeWidth(node: QnbStructureNode, hGap: number): number {
	if (node.children.length === 0) {
		node.subtreeWidth = node.width;
		return node.width;
	}
	let sum = 0;
	for (const child of node.children) sum += computeStructureSubtreeWidth(child, hGap);
	sum += hGap * (node.children.length - 1);
	node.subtreeWidth = Math.max(node.width, sum);
	return node.subtreeWidth;
}

/** Assegna la posizione (x,y) ad ogni nodo: i figli affiancati e centrati sotto il
 * genitore (o viceversa, se il genitore è più stretto della somma dei figli). */
function layoutStructureNode(
	node: QnbStructureNode,
	left: number,
	depth: number,
	hGap: number,
	vGap: number,
	nodeHeight: number
) {
	node.y = depth * (nodeHeight + vGap);
	if (node.children.length === 0) {
		node.x = left;
		return;
	}
	const childrenTotalWidth =
		node.children.reduce((s, c) => s + (c.subtreeWidth || 0), 0) + hGap * (node.children.length - 1);
	let childX = left + ((node.subtreeWidth || node.width) - childrenTotalWidth) / 2;
	for (const child of node.children) {
		layoutStructureNode(child, childX, depth + 1, hGap, vGap, nodeHeight);
		childX += (child.subtreeWidth || child.width) + hGap;
	}
	node.x = left + ((node.subtreeWidth || node.width) - node.width) / 2;
}

function structureMaxDepth(node: QnbStructureNode, depth = 0): number {
	if (node.children.length === 0) return depth;
	return Math.max(...node.children.map((c) => structureMaxDepth(c, depth + 1)));
}

const STRUCTURE_NODE_HEIGHT = 40;

function drawStructureNode(svg: SVGSVGElement, node: QnbStructureNode) {
	const x = node.x || 0;
	const y = node.y || 0;

	for (const child of node.children) {
		const line = svg.createSvg("line", {
			attr: {
				x1: String(x + node.width / 2),
				y1: String(y + STRUCTURE_NODE_HEIGHT),
				x2: String((child.x || 0) + child.width / 2),
				y2: String(child.y || 0),
				"stroke-width": "1.5",
			},
		});
		line.setCssStyles({ stroke: "var(--background-modifier-border)" });
	}

	const rect = svg.createSvg("rect", {
		attr: {
			x: String(x),
			y: String(y),
			width: String(node.width),
			height: String(STRUCTURE_NODE_HEIGHT),
			rx: "6",
			fill: node.color,
		},
	});
	rect.setCssStyles({ stroke: "var(--background-modifier-border)" });

	const text = svg.createSvg("text", {
		attr: {
			x: String(x + node.width / 2),
			y: String(y + STRUCTURE_NODE_HEIGHT / 2 + 5),
			"text-anchor": "middle",
			"font-size": "13",
			fill: node.textColor,
		},
	});
	text.textContent = node.label;

	for (const child of node.children) drawStructureNode(svg, child);
}

/** Diagramma gerarchico, solo informativo (niente clic sui riquadri): categorie, gruppi e
 * sottogruppi, senza le note — per farsi un'idea d'insieme della struttura della board. */
export class BoardStructureModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;

	constructor(app: App, plugin: QuickNotesBoardPlugin) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-board-structure");
		this.modalEl.addClass("qnb-structure-modal-resizable");
		this.modalEl.setCssStyles({ width: `${this.plugin.settings.boardStructureWindowWidth}px` });
		this.modalEl.setCssStyles({ height: `${this.plugin.settings.boardStructureWindowHeight}px` });
		this.render();
		this.addResizeHandle();
	}

	private addResizeHandle() {
		const handle = this.modalEl.createDiv({ cls: "qnb-structure-resize-handle" });
		handle.addEventListener("mousedown", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();

			const startX = evt.clientX;
			const startY = evt.clientY;
			const startWidth = this.modalEl.offsetWidth;
			const startHeight = this.modalEl.offsetHeight;

			const onMove = (moveEvt: MouseEvent) => {
				const newWidth = startWidth + (moveEvt.clientX - startX);
				const newHeight = startHeight + (moveEvt.clientY - startY);
				this.modalEl.setCssStyles({ width: `${Math.max(480, newWidth)}px` });
				this.modalEl.setCssStyles({ height: `${Math.max(400, newHeight)}px` });
			};
			const onUp = () => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				void this.plugin.setBoardStructureWindowSize(this.modalEl.offsetWidth, this.modalEl.offsetHeight);
			};

			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		});
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("qnb-structure-modal");
		new Setting(contentEl).setName(this.tr("modal.boardStructure.title")).setHeading();

		const container = contentEl.createDiv({ cls: "qnb-structure-svg-container" });
		const categories = this.plugin.settings.categories;

		if (categories.length === 0) {
			container.createDiv({ cls: "setting-item-description", text: this.tr("modal.boardStructure.empty") });
		} else {
			const HGAP = 24;
			const VGAP = 70;
			const CATEGORY_GAP = 48;

			const roots = categories.map((cat) =>
				buildStructureNode(cat.name, hexToRgbTriplet(cat.color || "#888888"), 0, cat.groups)
			);
			for (const root of roots) computeStructureSubtreeWidth(root, HGAP);

			let offsetX = 0;
			for (const root of roots) {
				layoutStructureNode(root, offsetX, 0, HGAP, VGAP, STRUCTURE_NODE_HEIGHT);
				offsetX += (root.subtreeWidth || root.width) + CATEGORY_GAP;
			}
			const totalWidth = Math.max(0, offsetX - CATEGORY_GAP);
			const maxDepth = Math.max(...roots.map((r) => structureMaxDepth(r)));
			const totalHeight = (maxDepth + 1) * STRUCTURE_NODE_HEIGHT + maxDepth * VGAP;

			const pad = 20;
			const svg = container.createSvg("svg", {
				attr: {
					width: String(totalWidth + pad * 2),
					height: String(totalHeight + pad * 2),
					viewBox: `${-pad} ${-pad} ${totalWidth + pad * 2} ${totalHeight + pad * 2}`,
				},
			});

			for (const root of roots) drawStructureNode(svg, root);
		}

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Pannello per assegnare/togliere etichette a una nota — caselle di spunta, una per
 * etichetta esistente in Impostazioni. Più di una insieme, liberamente. */
export class LabelAssignModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private note: QuickNote;
	private onSaved: () => void;

	constructor(app: App, plugin: QuickNotesBoardPlugin, note: QuickNote, onSaved: () => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.note = note;
		this.onSaved = onSaved;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-label-assign");
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		if (!mountNoteWindowBar(this, this.plugin, this.note.category, this.tr("modal.labelAssign.title"))) {
			new Setting(contentEl).setName(this.tr("modal.labelAssign.title")).setHeading();
		}

		const labels = this.plugin.settings.labels;
		if (labels.length === 0) {
			contentEl.createEl("p", {
				cls: "setting-item-description",
				text: this.tr("modal.labelAssign.noneDefined"),
			});
		} else {
			const current = new Set(this.note.labelIds || []);
			for (const label of labels) {
				new Setting(contentEl)
					.setName(label.name)
					.then((setting) => {
						const dot = createSpan({ cls: "qnb-label-dot" });
						dot.setCssStyles({ background: label.color || "#888888" });
						setting.nameEl.prepend(dot);
					})
					.addToggle((toggle) =>
						toggle.setValue(current.has(label.id)).onChange(async (value) => {
							if (value) current.add(label.id);
							else current.delete(label.id);
							this.note.labelIds = current.size > 0 ? Array.from(current) : undefined;
							await this.plugin.saveNotes();
							this.onSaved();
						})
					);
			}
		}

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Mostra l'elenco degli allarmi con orario già passato al momento dell'ultimo
 * riavvio/apertura di Obsidian, senza aver suonato: una finestra vera e propria
 * (non una notifica che sparisce da sola dopo pochi secondi) che l'utente chiude
 * quando ha finito di leggerla. */
export class MissedRemindersModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private items: { title: string; missedDays: { date: string; times: string[] }[]; newDate: string }[];

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		items: { title: string; missedDays: { date: string; times: string[] }[]; newDate: string }[]
	) {
		super(app);
		this.plugin = plugin;
		this.items = items;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.plugin.settings.language, key, vars);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(this.tr("modal.missedReminders.title")).setHeading();
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: this.tr("modal.missedReminders.description"),
		});

		for (const item of this.items) {
			const block = contentEl.createDiv({ cls: "qnb-missed-reminders-note" });
			block.createEl("p", { cls: "qnb-missed-reminders-note-title", text: item.title });
			const list = block.createEl("ul", { cls: "qnb-missed-reminders-list" });
			for (const day of item.missedDays) {
				list.createEl("li", {
					text: this.tr("modal.missedReminders.dayLine", {
						date: day.date,
						times: day.times.join(", "),
					}),
				});
			}
			// Senza nuova data l'allarme è rimasto su oggi: sono orari di oggi saltati perché
			// Obsidian non era in esecuzione.
			block.createEl("p", {
				cls: "qnb-missed-reminders-advanced",
				text: item.newDate
					? this.tr("modal.missedReminders.advancedTo", { date: item.newDate })
					: this.tr("modal.missedReminders.skippedToday"),
			});
		}

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(this.tr("trash.close"))
				.setCta()
				.onClick(() => this.close())
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Finestra "What's new": elenca le novità (testo Markdown, solo in inglese) di tutte le
 * versioni, dalla più recente. Quelle in `expanded` si vedono già aperte, le altre sono
 * richiuse e si aprono con un clic. Si apre da sola una volta dopo un aggiornamento,
 * oppure a richiesta. */
export class WhatsNewModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private expanded: Set<string>;
	private renderer = new Component();

	constructor(app: App, plugin: QuickNotesBoardPlugin, expanded: string[]) {
		super(app);
		this.plugin = plugin;
		this.expanded = new Set(expanded);
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.plugin.settings.language, key, vars);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.tr("modal.whatsNew.title"));
		this.renderer.load();

		for (const entry of CHANGELOG) {
			const block = contentEl.createEl("details");
			block.open = this.expanded.has(entry.version);
			block.createEl("summary").createEl("strong", { text: entry.version });
			void MarkdownRenderer.render(this.app, entry.markdown, block.createDiv(), "", this.renderer);
		}

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(this.tr("trash.close"))
				.setCta()
				.onClick(() => this.close())
		);
	}

	onClose() {
		this.renderer.unload();
		this.contentEl.empty();
	}
}

/** Finestra di dialogo dell'allarme in corso: nome della nota, scelta di quanto posticipare e
 * pulsanti "Posticipa" e "Ferma". Chiuderla in un altro modo (X, Esc, clic fuori) equivale a
 * "Ferma", come faceva un clic sulla vecchia notifica. Se invece è il plugin a chiuderla
 * (l'allarme è stato fermato o posticipato da un'altra parte) non scatta nulla di tutto
 * ciò: `closeQuietly` esiste per questo. */
export class AlarmRingModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private note: QuickNote;
	private handlers: { onSnooze: (minutes: number) => void; onStop: () => void; onPostponeToNext: () => void };
	private selectedMinutes: number;
	/** Vero appena l'utente ha scelto (o il plugin ha chiuso): evita di fermare due volte. */
	private settled = false;
	private closed = false;

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		note: QuickNote,
		handlers: { onSnooze: (minutes: number) => void; onStop: () => void; onPostponeToNext: () => void }
	) {
		super(app);
		this.plugin = plugin;
		this.note = note;
		this.handlers = handlers;
		this.selectedMinutes = normalizeSnoozeMinutes(plugin.settings.lastSnoozeMinutes);
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.plugin.settings.language, key, vars);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("qnb-alarm-dialog");
		// Barra con i colori della categoria della nota; senza categoria, il titolo standard.
		if (!mountNoteWindowBar(this, this.plugin, this.note.category, this.tr("snooze.dialog.title"))) {
			this.titleEl.setText(this.tr("snooze.dialog.title"));
		}

		contentEl.createEl("p", { cls: "qnb-alarm-dialog-note", text: this.note.title });

		new Setting(contentEl).setName(this.tr("snooze.label")).addDropdown((dd) => {
			for (const minutes of SNOOZE_OPTIONS_MINUTES) {
				dd.addOption(String(minutes), formatSnoozeLabel(minutes, (key, vars) => this.tr(key, vars)));
			}
			dd.setValue(String(this.selectedMinutes));
			dd.onChange((value) => {
				this.selectedMinutes = normalizeSnoozeMinutes(parseInt(value, 10));
			});
		});

		const buttonsRow = new Setting(contentEl);
		// Solo se questo allarme ha una ripetizione attiva: evita di dover aprire il
		// pannello principale della nota solo per posticipare al prossimo ciclo. A sinistra
		// degli altri due, essendo l'azione meno frequente delle due comuni.
		if (this.note.dueDate && this.note.reminderRepeat) {
			buttonsRow.addButton((btn) =>
				btn.setButtonText(this.tr("snooze.postponeToNext")).onClick(() => this.postponeToNext())
			);
		}
		buttonsRow
			.addButton((btn) =>
				btn
					.setButtonText(this.tr("snooze.button"))
					.setCta()
					.onClick(() => this.snooze())
			)
			.addButton((btn) => btn.setButtonText(this.tr("snooze.stop")).onClick(() => this.stop()));
	}

	/** Pulsante "Posticipa": chiude la finestra e posticipa della durata scelta. */
	snooze() {
		if (this.settled) return;
		this.settled = true;
		this.close();
		this.handlers.onSnooze(this.selectedMinutes);
	}

	/** Pulsante "Posticipa alla prossima programmazione": stessa azione del pulsante
	 * omonimo nel pannello principale della nota, senza doverlo aprire. */
	postponeToNext() {
		if (this.settled) return;
		this.settled = true;
		this.close();
		this.handlers.onPostponeToNext();
	}

	/** Pulsante "Ferma": chiude la finestra e ferma l'allarme. */
	stop() {
		if (this.settled) return;
		this.settled = true;
		this.close();
		this.handlers.onStop();
	}

	/** Chiusura decisa dal plugin: non innesca "Ferma". Ignorata se è già chiusa. */
	closeQuietly() {
		if (this.closed) return;
		this.settled = true;
		this.close();
	}

	onClose() {
		this.closed = true;
		this.contentEl.empty();
		// Chiusa con X, Esc o un clic fuori dalla finestra: vale come "Ferma".
		if (!this.settled) {
			this.settled = true;
			this.handlers.onStop();
		}
	}
}
