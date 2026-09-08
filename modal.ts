import { App, Modal, Setting, ButtonComponent, setIcon, Notice } from "obsidian";
import type { QnbCategory, QnbGroup } from "./settings";
import type QuickNotesBoardPlugin from "./main";
import type { QuickNote, QnbFontFamily } from "./main";
import { getContrastTextColor } from "./main";
import { t, QnbLang } from "./i18n";

/** Colora le <option> di un <select> categoria con lo stesso colore configurato per quella categoria. */
function colorizeCategoryOptions(selectEl: HTMLSelectElement, categories: QnbCategory[]) {
	for (const option of Array.from(selectEl.options)) {
		const cat = categories.find((c) => c.name === option.value);
		if (cat) {
			option.style.backgroundColor = cat.color;
			option.style.color = getContrastTextColor(cat.color);
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
	private onSubmit: (title: string, category: string, groupId: string) => void;
	private categories: QnbCategory[];
	private groupContainer: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		categories: QnbCategory[],
		onSubmit: (title: string, category: string, groupId: string) => void
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
		contentEl.createEl("h3", { text: this.tr("modal.newNote.title") });

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

	private submit() {
		this.plugin.playSound("dialog-new-note-confirm");
		this.onSubmit(this.title.trim(), this.category, this.groupId);
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
		contentEl.createEl("h3", { text: this.tr("modal.changeCategory.title") });

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
		onChangeBgColor: (color: string) => void
	) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
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
		contentEl.createEl("h3", { text: this.tr("modal.fontSize.title") });
		contentEl.createEl("p", { cls: "setting-item-description", text: this.tr("modal.fontSize.desc") });

		new Setting(contentEl)
			.setName(this.tr("modal.fontSize.sizeLabel"))
			.addSlider((slider) =>
				slider
					.setLimits(10, 32, 1)
					.setValue(this.size)
					.setDynamicTooltip()
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
	const frag = document.createDocumentFragment();
	const iconSpan = document.createElement("span");
	iconSpan.className = "qnb-list-item-icon";
	setIcon(iconSpan, plugin.getCategoryIcon(note.category) || "file-text");
	frag.appendChild(iconSpan);
	frag.appendChild(document.createTextNode(note.title));
	return frag;
}

/** Intestazione h3 con un'icona davanti al testo, per i titoli delle finestre. */
function createHeadingWithIcon(containerEl: HTMLElement, iconName: string, text: string) {
	const heading = containerEl.createEl("h3", { cls: "qnb-modal-heading" });
	setIcon(heading.createSpan({ cls: "qnb-modal-heading-icon" }), iconName);
	heading.createSpan({ text });
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
					.setWarning()
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
				.setWarning()
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
					.setWarning()
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

	private password = "";
	private confirmPassword = "";
	private errorEl: HTMLElement | null = null;
	private submitBtnComponent: ButtonComponent | null = null;
	private submitting = false;

	constructor(
		app: App,
		plugin: QuickNotesBoardPlugin,
		mode: QnbLockMode,
		onSubmit: (password: string) => Promise<boolean>
	) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.mode = mode;
		this.onSubmit = onSubmit;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound(this.mode === "lock" ? "dialog-lock" : "dialog-unlock");
		const { contentEl } = this;
		contentEl.empty();

		const isLock = this.mode === "lock";
		contentEl.createEl("h3", { text: this.tr(isLock ? "modal.lock.title" : "modal.unlock.title") });
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: this.tr(isLock ? "modal.lock.desc" : "modal.unlock.desc"),
		});

		const passwordSetting = new Setting(contentEl).setName(
			this.tr(isLock ? "modal.lock.passwordLabel" : "modal.unlock.passwordLabel")
		);
		passwordSetting.addText((text) => {
			text.inputEl.type = "password";
			text.onChange((v) => (this.password = v));
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					void this.trySubmit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		if (isLock) {
			const confirmSetting = new Setting(contentEl).setName(this.tr("modal.lock.confirmLabel"));
			confirmSetting.addText((text) => {
				text.inputEl.type = "password";
				text.onChange((v) => (this.confirmPassword = v));
				text.inputEl.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						void this.trySubmit();
					}
				});
			});
		}

		this.errorEl = contentEl.createDiv({ cls: "qnb-modal-error" });
		this.errorEl.style.display = "none";

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
		this.errorEl.style.display = "block";
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
		this.contentEl.empty();
	}
}

/** Finestra informativa (sola lettura) sulla nota: date, lunghezza testo, categoria/gruppo. */
export class NoteInfoModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private note: QuickNote;
	private groupPath: string;

	constructor(app: App, plugin: QuickNotesBoardPlugin, note: QuickNote, groupPath: string) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.note = note;
		this.groupPath = groupPath;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-note-info");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.note.title || this.tr("view.note.untitled") });

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
				dot.style.background = label.color || "#888888";
				chip.createSpan({ text: label.name });
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
	row.style.paddingLeft = `${depth * 18}px`;
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

export class CategoryStatsModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private category: QnbCategory;

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
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.tr("modal.categoryStats.title", { category: this.category.name }) });

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

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
		);
	}

	onClose() {
		this.contentEl.empty();
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
		contentEl.createEl("h3", { text: this.tr("modal.boardInfo.title") });

		const activeNotes = this.plugin.notes.filter((n) => !n.deleted && !n.archived);

		for (const cat of this.plugin.settings.categories) {
			const catNotes = activeNotes.filter((n) => n.category === cat.name);

			const catSection = contentEl.createDiv({ cls: "qnb-board-info-category" });
			const catHeader = catSection.createDiv({ cls: "qnb-board-info-category-header" });
			catHeader.style.setProperty("--qnb-cat-color", cat.color);
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
		this.modalEl.style.width = `${this.plugin.settings.activityChartWindowWidth}px`;
		this.modalEl.style.height = `${this.plugin.settings.activityChartWindowHeight}px`;

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
				this.modalEl.style.width = `${Math.max(480, newWidth)}px`;
				this.modalEl.style.height = `${Math.max(400, newHeight)}px`;
			};

			const onUp = async () => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				await this.plugin.setActivityChartWindowSize(
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
		contentEl.createEl("h3", { text: this.tr("modal.boardActivity.title") });

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

		// Contenitore dei due grafici: si spartisce tutto lo spazio verticale rimasto
		// (titolo, navigazione, riepilogo e pulsante hanno un'altezza fissa) e lo divide
		// a metà tra i due grafici, sempre insieme e in proporzione, via flexbox — non a
		// calcolo manuale, così resta corretto a qualunque dimensione della finestra.
		const chartsContainer = contentEl.createDiv({ cls: "qnb-activity-charts" });
		this.notesChartWrapper = this.createChartSection(
			chartsContainer,
			this.tr("modal.boardActivity.notesChart")
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
			text: this.tr("modal.boardActivity.totalNotes", { count: String(totalNotes) }),
		});
		summary.createDiv({
			cls: "qnb-cat-stats-summary-row",
			text: this.tr("modal.boardActivity.totalChars", { count: String(totalChars) }),
		});

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(this.tr("trash.close")).onClick(() => this.close())
		);
	}

	/** Crea il titolo e il contenitore (osservato per il ridimensionamento) di un grafico,
	 * senza ancora disegnarci dentro nulla. */
	private createChartSection(containerEl: HTMLElement, title: string): HTMLElement {
		const section = containerEl.createDiv({ cls: "qnb-activity-chart-section" });
		section.createEl("h4", { text: title });
		return section.createDiv({ cls: "qnb-activity-chart-wrapper" });
	}

	/** Ridisegna entrambi i grafici usando la dimensione attuale (misurata) dei loro
	 * contenitori — richiamato all'apertura, al cambio mese, e a ogni ridimensionamento. */
	private redrawCharts() {
		if (this.notesChartWrapper) {
			this.drawBarChart(
				this.notesChartWrapper,
				this.notesPerDay,
				this.plugin.settings.activityChartNotesColor || "var(--interactive-accent)"
			);
		}
		if (this.charsChartWrapper) {
			this.drawBarChart(
				this.charsChartWrapper,
				this.charsPerDay,
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

		const topMargin = 22;
		const bottomMargin = 26;
		const maxValue = Math.max(1, ...data.map((d) => d.value));
		const barGap = 3;
		const barWidth = data.length > 0 ? width / data.length - barGap : 0;

		const svg = wrapper.createSvg("svg", {
			attr: { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none" },
			cls: "qnb-activity-svg",
		});
		svg.style.width = `${width}px`;
		svg.style.height = `${height}px`;

		data.forEach((d, idx) => {
			const barHeight = (d.value / maxValue) * (height - bottomMargin - topMargin);
			const x = idx * (barWidth + barGap);
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
function addRepeatInterval(
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
		contentEl.createEl("h3", { text: this.tr("modal.dueDate.title") });

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
						const next = addRepeatInterval(
							this.note.dueDate!,
							this.note.reminderStartDate || this.note.dueDate!,
							this.note.reminderRepeat!,
							this.note.reminderRepeatEvery || 1
						);
						this.note.dueDate = next.dueDate;
						this.note.reminderStartDate = next.reminderStartDate;
						this.plugin.stopDueAlarm(this.note.id);
						await this.plugin.saveNotes();
						this.dueDate = next.dueDate;
						this.remStartDate = next.reminderStartDate;
						this.onSaved();
						new Notice(this.tr("modal.dueDate.postponed", { date: next.dueDate }));
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
		contentEl.createEl("h3", { text: this.tr("modal.alarmList.title") });

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

		for (const note of notes) {
			const row = grid.createDiv({ cls: "qnb-alarm-grid-row qnb-alarm-grid-item" });
			row.addEventListener("click", () => {
				this.close();
				this.onOpenAlarm(note);
			});

			const catCell = row.createDiv({ cls: "qnb-alarm-cell-category" });
			const dot = catCell.createSpan({ cls: "qnb-alarm-cat-dot" });
			const catColor = this.plugin.getCategoryColor(note.category);
			if (catColor) dot.style.background = catColor;
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

			// Per le note con più orari, il tempo rimasto è calcolato sul primo orario
			// del giorno (già in ordine crescente al salvataggio) — un'indicazione
			// ragionevole di "quanto manca al prossimo allarme", non un conteggio
			// esatto per ognuno dei singoli orari successivi.
			const timeForCountdown =
				note.reminderStartTimes && note.reminderStartTimes.length > 0
					? note.reminderStartTimes[0]
					: note.reminderStartTime;
			row.createDiv({
				text: formatTimeRemaining(note.dueDate || "", timeForCountdown, (key, vars) => this.tr(key, vars)),
			});
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
		contentEl.createEl("h3", { text: this.tr("modal.noteExplorer.title") });

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
			if (category.color) dot.style.background = category.color;
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
		row.style.paddingLeft = `${depth * 18}px`;
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
		row.style.paddingLeft = `${depth * 18}px`;
		row.createSpan({ text: note.title || this.tr("modal.noteExplorer.untitled") });

		if (note.labelIds && note.labelIds.length > 0) {
			for (const id of note.labelIds) {
				const label = this.plugin.settings.labels.find((l) => l.id === id);
				if (!label) continue;
				const dot = row.createSpan({ cls: "qnb-label-dot qnb-explorer-note-label-dot" });
				dot.style.background = label.color || "#888888";
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

const SVG_NS = "http://www.w3.org/2000/svg";
const STRUCTURE_NODE_HEIGHT = 40;

function drawStructureNode(svg: SVGSVGElement, node: QnbStructureNode) {
	const x = node.x || 0;
	const y = node.y || 0;

	for (const child of node.children) {
		const line = document.createElementNS(SVG_NS, "line");
		line.setAttribute("x1", String(x + node.width / 2));
		line.setAttribute("y1", String(y + STRUCTURE_NODE_HEIGHT));
		line.setAttribute("x2", String((child.x || 0) + child.width / 2));
		line.setAttribute("y2", String(child.y || 0));
		line.style.stroke = "var(--background-modifier-border)";
		line.setAttribute("stroke-width", "1.5");
		svg.appendChild(line);
	}

	const rect = document.createElementNS(SVG_NS, "rect");
	rect.setAttribute("x", String(x));
	rect.setAttribute("y", String(y));
	rect.setAttribute("width", String(node.width));
	rect.setAttribute("height", String(STRUCTURE_NODE_HEIGHT));
	rect.setAttribute("rx", "6");
	rect.setAttribute("fill", node.color);
	rect.style.stroke = "var(--background-modifier-border)";
	svg.appendChild(rect);

	const text = document.createElementNS(SVG_NS, "text");
	text.setAttribute("x", String(x + node.width / 2));
	text.setAttribute("y", String(y + STRUCTURE_NODE_HEIGHT / 2 + 5));
	text.setAttribute("text-anchor", "middle");
	text.setAttribute("font-size", "13");
	text.setAttribute("fill", node.textColor);
	text.textContent = node.label;
	svg.appendChild(text);

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
		this.modalEl.style.width = `${this.plugin.settings.boardStructureWindowWidth}px`;
		this.modalEl.style.height = `${this.plugin.settings.boardStructureWindowHeight}px`;
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
				this.modalEl.style.width = `${Math.max(480, newWidth)}px`;
				this.modalEl.style.height = `${Math.max(400, newHeight)}px`;
			};
			const onUp = async () => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				await this.plugin.setBoardStructureWindowSize(this.modalEl.offsetWidth, this.modalEl.offsetHeight);
			};

			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		});
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("qnb-structure-modal");
		contentEl.createEl("h3", { text: this.tr("modal.boardStructure.title") });

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

			const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
			const pad = 20;
			svg.setAttribute("width", String(totalWidth + pad * 2));
			svg.setAttribute("height", String(totalHeight + pad * 2));
			svg.setAttribute("viewBox", `${-pad} ${-pad} ${totalWidth + pad * 2} ${totalHeight + pad * 2}`);

			for (const root of roots) drawStructureNode(svg, root);
			container.appendChild(svg);
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
		contentEl.createEl("h3", { text: this.tr("modal.labelAssign.title") });

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
						dot.style.background = label.color || "#888888";
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
