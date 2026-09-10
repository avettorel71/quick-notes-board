import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, Notice } from "obsidian";
import type QuickNotesBoardPlugin from "./main";
import type { QuickNote } from "./main";
import { DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY, DEFAULT_FONT_COLOR, DEFAULT_BG_COLOR, FONT_FAMILY_CSS, getContrastTextColor } from "./main";
import { NewNoteModal, ChangeCategoryModal, FontSizeModal, TrashModal, ArchiveModal, LockPasswordModal, NoteInfoModal, CategoryStatsModal, BoardInfoModal, BoardActivityModal, DueDateModal, AlarmListModal, NoteExplorerModal, BoardStructureModal, LabelAssignModal } from "./modal";
import { t } from "./i18n";
import type { QnbCategory, QnbGroup, QnbNoteIconId } from "./settings";
import { encryptText, decryptText, DecryptionError } from "./crypto";

export const VIEW_TYPE_QNB = "quick-notes-board-view";

export class QuickNotesBoardView extends ItemView {
	plugin: QuickNotesBoardPlugin;

	private boardEl!: HTMLElement;

	private dragState: {
		note: QuickNote;
		el: HTMLElement;
		startX: number;
		startY: number;
		origX: number;
		origY: number;
		/** Le ALTRE note selezionate insieme a questa (trascinamento di gruppo): si
		 * spostano tutte della stessa quantità, questa resta il "capofila" del gesto. */
		groupExtras: { note: QuickNote; el: HTMLElement; origX: number; origY: number }[];
	} | null = null;

	/** Id delle note attualmente selezionate (riquadro di selezione o Ctrl/Cmd+click). */
	private selectedNoteIds: Set<string> = new Set();
	private noteElements: Map<string, HTMLElement> = new Map();
	private marqueeEl: HTMLElement | null = null;
	private marqueeStart: { x: number; y: number; additive: boolean } | null = null;

	private activeResizeObservers: ResizeObserver[] = [];

	/** Pulsanti categoria della toolbar (nome -> elemento), per aggiornarne lo stato attivo/inattivo. */
	private categoryButtons: Map<string, HTMLElement> = new Map();
	private activeGroupPopup: HTMLElement | null = null;
	private searchQuery = "";
	/** Modalità corrente del pulsante "Riordina": avanza di una ad ogni click. */
	private tidyModeIndex = 0;
	/** Id della nota attualmente massimizzata, o null se nessuna lo è. */
	private maximizedNoteId: string | null = null;
	private toggleAllBtn: HTMLElement | null = null;
	private favoritesRowEl: HTMLElement | null = null;
	private labelsRowEl: HTMLElement | null = null;
	/** Etichette attualmente selezionate come filtro: una nota deve averle TUTTE per
	 * restare visibile (intersezione, non "una qualsiasi"). Vuoto = nessun filtro attivo. */
	private activeLabelFilterIds = new Set<string>();

	/** Stato dei pannelli laterali PRIMA di entrare in modalità schermo intero (null = non attiva). */
	private fullscreenPrevState: { left: boolean; right: boolean } | null = null;

	/** Id delle note in ordine di utilizzo: le meno recenti prima, l'ultima toccata in fondo. */
	private noteOrder: string[] = [];
	/** Contatore sempre crescente per portare in primo piano una nota senza toccare il DOM. */
	private zCounter = 1000;

	constructor(leaf: WorkspaceLeaf, plugin: QuickNotesBoardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_QNB;
	}

	getDisplayText(): string {
		return "Quick Notes Board";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.plugin.settings.language, key, vars);
	}

	async onOpen() {
		this.plugin.playSound("board-open");
		document.addEventListener("keydown", this.clearSelectionOnEscapeBound);
		await this.rebuild();
	}

	async onClose() {
		this.plugin.playSound("toolbar-close");
		for (const ro of this.activeResizeObservers) ro.disconnect();
		this.activeResizeObservers = [];
		this.restoreSidebars();
		this.closeGroupPopup();
		document.removeEventListener("keydown", this.clearSelectionOnEscapeBound);
	}

	private clearSelectionOnEscapeBound = (evt: KeyboardEvent) => {
		if (evt.key === "Escape" && this.selectedNoteIds.size > 0) this.clearSelection();
	};

	/** Ridisegna tutto da zero: toolbar (testi/lingua) + board. Usato anche quando cambiano le impostazioni. */
	refresh() {
		void this.rebuild();
	}

	private async rebuild() {
		this.closeGroupPopup();
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("qnb-container");

		this.syncFullscreenMode();

		this.buildToolbar(container);

		this.boardEl = container.createDiv({ cls: "qnb-board" });
		this.boardEl.toggleClass("qnb-icons-collapsed", this.plugin.settings.collapseNoteIcons);
		this.boardEl.toggleClass("qnb-hover-lift-enabled", this.plugin.settings.hoverLiftEffect);
		this.boardEl.toggleClass("qnb-always-shadow-enabled", this.plugin.settings.alwaysOnNoteShadow);
		this.boardEl.setCssProps({
			"--qnb-shadow-intensity": String(this.plugin.settings.noteShadowIntensity / 100),
		});
		this.boardEl.setCssProps({ "--qnb-due-color": this.plugin.settings.dueDateBorderColor });
		this.applyBackground();

		// Click sull'area vuota della board: chiude eventuali editor aperti e avvia il
		// riquadro di selezione multipla (se si trascina) o deseleziona tutto (se è solo
		// un click, senza trascinamento).
		this.boardEl.addEventListener("mousedown", (evt) => {
			if (evt.target !== this.boardEl) return;
			this.boardEl.querySelectorAll(".qnb-note.is-editing").forEach((el) => {
				el.dispatchEvent(new Event("qnb-force-blur"));
			});
			this.startMarqueeSelection(evt);
		});

		this.renderBoard();
	}

	/** Applica o annulla la modalità schermo intero in base all'impostazione corrente, senza mai
	 * forzare l'apertura di un pannello che l'utente aveva già chiuso di sua iniziativa. */
	private syncFullscreenMode() {
		const ws = this.app.workspace;
		const shouldBeFullscreen = this.plugin.settings.fullscreenMode;

		if (shouldBeFullscreen && !this.fullscreenPrevState) {
			this.fullscreenPrevState = {
				left: ws.leftSplit?.collapsed ?? false,
				right: ws.rightSplit?.collapsed ?? false,
			};
			ws.leftSplit?.collapse();
			ws.rightSplit?.collapse();
		} else if (!shouldBeFullscreen) {
			this.restoreSidebars();
		}
	}

	private restoreSidebars() {
		if (!this.fullscreenPrevState) return;
		const ws = this.app.workspace;
		if (!this.fullscreenPrevState.left) ws.leftSplit?.expand();
		if (!this.fullscreenPrevState.right) ws.rightSplit?.expand();
		this.fullscreenPrevState = null;
	}

	applyBackground() {
		if (!this.boardEl) return;
		const mode = this.plugin.settings.backgroundMode;

		// reset di base
		this.boardEl.removeClass("qnb-board-custom-bg");
		this.boardEl.setCssStyles({ backgroundImage: "" });
		this.boardEl.setCssStyles({ backgroundColor: "" });

		if (mode === "color") {
			this.boardEl.addClass("qnb-board-custom-bg");
			this.boardEl.setCssStyles({ backgroundColor: this.plugin.settings.backgroundColor });
			return;
		}

		if (mode === "image") {
			const resourcePath = this.plugin.getBackgroundResourcePath();
			if (!resourcePath) return; // nessuna immagine ancora scelta: resta lo sfondo predefinito

			this.boardEl.addClass("qnb-board-custom-bg");
			const size = this.plugin.settings.backgroundSize;

			// L'oscuramento è un secondo layer (gradiente uniforme) nella STESSA proprietà
			// background-image dell'immagine: essendo un vero "background" CSS, si estende
			// automaticamente su tutta l'area scorribile della board (non solo sulla parte
			// visibile), a differenza di un elemento overlay separato che invece manterrebbe
			// dimensioni fisse e lascerebbe "scoperte" le zone raggiunte scorrendo.
			const dim = (this.plugin.settings.backgroundDim || 0) / 100;
			const dimLayer = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim}))`;
			this.boardEl.setCssStyles({ backgroundImage: `${dimLayer}, url("${resourcePath}")` });

			if (size === "repeat") {
				this.boardEl.setCssStyles({ backgroundRepeat: "repeat, repeat" });
				this.boardEl.setCssStyles({ backgroundSize: "64px 64px, auto" });
			} else {
				this.boardEl.setCssStyles({ backgroundRepeat: "repeat, no-repeat" });
				this.boardEl.setCssStyles({ backgroundSize: `64px 64px, ${size}` });
			}
			this.boardEl.setCssStyles({ backgroundPosition: "0 0, center" });
			// "local": lo sfondo scorre insieme al contenuto interno, quindi copre l'intera
			// area scorribile invece di restare ancorato solo alla porzione inizialmente visibile.
			// Il layer di oscuramento è un piccolo tile ripetuto (non "cover"), così si estende
			// correttamente su qualunque estensione scorribile, indipendentemente da come è
			// impostata l'immagine.
			this.boardEl.setCssStyles({ backgroundAttachment: "local, local" });
		}

		// mode === "none": resta lo sfondo predefinito a puntini definito via CSS
	}

	private buildToolbar(container: HTMLElement) {
		const toolbar = container.createDiv({ cls: "qnb-toolbar" });

		const newBtn = toolbar.createEl("button", { cls: "qnb-btn qnb-btn-primary" });
		setIcon(newBtn.createSpan({ cls: "qnb-btn-icon" }), "plus");
		newBtn.createSpan({ text: this.tr("view.newNote") });
		newBtn.addEventListener("click", () => {
			this.plugin.playSound("toolbar-new-note");
			this.openNewNoteModal();
		});

		this.toggleAllBtn = toolbar.createEl("button", { cls: "qnb-btn qnb-category-btn", text: this.tr("view.toggleAll") });
		this.updateToggleAllButtonState();
		this.toggleAllBtn.addEventListener("click", () => {
			void (async () => {
				this.plugin.playSound("toolbar-toggle-all");
				const activeNotes = this.plugin.notes.filter((n) => !n.deleted && !n.archived && !n.pinned);
				const anyVisible = activeNotes.some((n) => !n.hidden);
				for (const n of activeNotes) n.hidden = anyVisible;
				await this.plugin.saveNotes();
				this.refreshVisibilityButtons();
				this.renderBoard();
			})();
		});

		const searchWrapper = toolbar.createDiv({ cls: "qnb-toolbar-search" });
		setIcon(searchWrapper.createSpan({ cls: "qnb-toolbar-search-icon" }), "search");
		const searchInput = searchWrapper.createEl("input", {
			cls: "qnb-toolbar-search-input",
			attr: { type: "text", placeholder: this.tr("view.search.placeholder") },
		});
		searchInput.value = this.searchQuery;
		const searchClearBtn = searchWrapper.createEl("button", {
			cls: "qnb-toolbar-search-clear",
			attr: { type: "button", "aria-label": this.tr("view.search.clear") },
		});
		setIcon(searchClearBtn, "x");
		searchClearBtn.setCssStyles({ display: this.searchQuery ? "flex" : "none" });

		searchInput.addEventListener("input", () => {
			this.searchQuery = searchInput.value;
			searchClearBtn.setCssStyles({ display: this.searchQuery ? "flex" : "none" });
			this.renderBoard();
		});
		searchClearBtn.addEventListener("click", () => {
			this.searchQuery = "";
			searchInput.value = "";
			searchClearBtn.setCssStyles({ display: "none" });
			this.renderBoard();
			searchInput.focus();
		});

		const tidyUpBtn = toolbar.createEl("button", { cls: "qnb-btn" });
		setIcon(tidyUpBtn.createSpan({ cls: "qnb-btn-icon" }), "layout-grid");
		tidyUpBtn.createSpan({ text: this.tr("view.tidyUp") });
		tidyUpBtn.addEventListener("click", () => void this.tidyUpNotes());

		const archiveBtn = toolbar.createEl("button", { cls: "qnb-btn" });
		setIcon(archiveBtn.createSpan({ cls: "qnb-btn-icon" }), "archive");
		archiveBtn.createSpan({ text: this.tr("view.archive") });
		archiveBtn.addEventListener("click", () => {
			this.plugin.playSound("toolbar-archive");
			new ArchiveModal(this.app, this.plugin, () => {
				this.refreshVisibilityButtons();
				this.renderBoard();
			}).open();
		});

		const trashBtn = toolbar.createEl("button", { cls: "qnb-btn" });
		setIcon(trashBtn.createSpan({ cls: "qnb-btn-icon" }), "trash-2");
		trashBtn.createSpan({ text: this.tr("view.trash") });
		trashBtn.addEventListener("click", () => {
			this.plugin.playSound("toolbar-trash");
			new TrashModal(this.app, this.plugin, () => {
				this.refreshVisibilityButtons();
				this.renderBoard();
			}).open();
		});

		const boardInfoBtn = toolbar.createEl("button", { cls: "qnb-btn" });
		setIcon(boardInfoBtn.createSpan({ cls: "qnb-btn-icon" }), "info");
		boardInfoBtn.createSpan({ text: this.tr("view.boardInfo") });
		boardInfoBtn.addEventListener("click", () => {
			this.plugin.playSound("toolbar-board-info");
			new BoardInfoModal(this.app, this.plugin).open();
		});

		const boardActivityBtn = toolbar.createEl("button", { cls: "qnb-btn" });
		setIcon(boardActivityBtn.createSpan({ cls: "qnb-btn-icon" }), "bar-chart-3");
		boardActivityBtn.createSpan({ text: this.tr("view.boardActivity") });
		boardActivityBtn.addEventListener("click", () => {
			this.plugin.playSound("toolbar-board-activity");
			new BoardActivityModal(this.app, this.plugin).open();
		});

		const alarmListBtn = toolbar.createEl("button", { cls: "qnb-btn" });
		setIcon(alarmListBtn.createSpan({ cls: "qnb-btn-icon" }), "alarm-clock");
		alarmListBtn.createSpan({ text: this.tr("view.alarmList") });
		alarmListBtn.addEventListener("click", () => {
			this.plugin.playSound("toolbar-alarm-list");
			new AlarmListModal(this.app, this.plugin, (note) => {
				new DueDateModal(this.app, this.plugin, note, () => this.renderBoard()).open();
			}).open();
		});

		const explorerBtn = toolbar.createEl("button", { cls: "qnb-btn" });
		setIcon(explorerBtn.createSpan({ cls: "qnb-btn-icon" }), "list-tree");
		explorerBtn.createSpan({ text: this.tr("view.noteExplorer") });
		explorerBtn.addEventListener("click", () => {
			this.plugin.playSound("toolbar-note-explorer");
			new NoteExplorerModal(this.app, this.plugin, (note) => this.focusNote(note.id)).open();
		});

		const structureBtn = toolbar.createEl("button", { cls: "qnb-btn" });
		setIcon(structureBtn.createSpan({ cls: "qnb-btn-icon" }), "network");
		structureBtn.createSpan({ text: this.tr("view.boardStructure") });
		structureBtn.addEventListener("click", () => {
			this.plugin.playSound("toolbar-board-structure");
			new BoardStructureModal(this.app, this.plugin).open();
		});

		const closeBtn = toolbar.createEl("button", { cls: "qnb-btn qnb-btn-close" });
		setIcon(closeBtn.createSpan({ cls: "qnb-btn-icon" }), "x");
		closeBtn.createSpan({ text: this.tr("view.close") });
		closeBtn.addEventListener("click", () => this.leaf.detach());

		// Riga dedicata ai preferiti, solo se la funzione è attivata nelle impostazioni:
		// se spenta, l'elemento non viene proprio creato (nessuno spazio riservato).
		if (this.plugin.settings.useFavorites) {
			this.favoritesRowEl = container.createDiv({ cls: "qnb-favorites-row" });
			this.updateFavoritesRow();
		} else {
			this.favoritesRowEl = null;
		}

		this.labelsRowEl = container.createDiv({ cls: "qnb-labels-row" });
		this.updateLabelsRow();

		// Riga separata, dedicata alle categorie: va a capo da sola quando ce ne sono
		// troppe per stare su una riga, così i pulsanti sopra restano sempre raggiungibili
		// e nessuna categoria resta mai nascosta fuori dallo schermo.
		const categoriesRow = container.createDiv({ cls: "qnb-categories-row" });

		this.categoryButtons.clear();
		for (const cat of this.plugin.settings.categories) {
			const catPair = categoriesRow.createDiv({ cls: "qnb-category-pair" });

			const catBtn = catPair.createEl("button", { cls: "qnb-btn qnb-category-btn", text: cat.name });
			catBtn.setCssProps({ "--qnb-cat-color": cat.color });
			catBtn.setCssProps({ "--qnb-cat-fg": getContrastTextColor(cat.color) });
			this.categoryButtons.set(cat.name, catBtn);
			this.updateCategoryButtonState(catBtn, cat.name);
			catBtn.addEventListener("click", () => {
				void (async () => {
					this.plugin.playSound("toolbar-category-toggle");
					const notesOfCat = this.plugin.notes.filter((n) => !n.deleted && !n.archived && !n.pinned && n.category === cat.name);
					const anyVisible = notesOfCat.some((n) => !n.hidden);
					for (const n of notesOfCat) n.hidden = anyVisible;
					await this.plugin.saveNotes();
					this.refreshVisibilityButtons();
					this.renderBoard();
				})();
			});
			catBtn.addEventListener("contextmenu", (evt) => {
				evt.preventDefault();
				new CategoryStatsModal(this.app, this.plugin, cat).open();
			});

			if (cat.groups.length > 0) {
				catBtn.addClass("qnb-has-group-menu");
				const groupMenuBtn = catPair.createEl("button", {
					cls: "qnb-btn qnb-group-menu-btn",
					attr: { type: "button", "aria-label": this.tr("view.groupsMenuLabel") },
				});
				groupMenuBtn.setCssProps({ "--qnb-cat-color": cat.color });
				setIcon(groupMenuBtn, "chevron-down");
				groupMenuBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.toggleGroupPopup(groupMenuBtn, cat);
				});
			}
		}
	}

	/** Il pulsante categoria appare "pieno" (colorato) se almeno una nota di quella categoria è visibile, "a contorno" se sono tutte nascoste. */
	private updateCategoryButtonState(btn: HTMLElement, categoryName: string) {
		const notesOfCat = this.plugin.notes.filter((n) => !n.deleted && !n.archived && !n.pinned && n.category === categoryName);
		const hasNotes = notesOfCat.length > 0;
		const anyVisible = hasNotes && notesOfCat.some((n) => !n.hidden);
		btn.toggleClass("is-active", anyVisible);
		btn.toggleClass("qnb-btn-disabled", !hasNotes);
		(btn as HTMLButtonElement).disabled = !hasNotes;
	}

	private updateToggleAllButtonState() {
		if (!this.toggleAllBtn) return;
		const activeNotes = this.plugin.notes.filter((n) => !n.deleted && !n.archived && !n.pinned);
		const hasNotes = activeNotes.length > 0;
		const anyVisible = hasNotes && activeNotes.some((n) => !n.hidden);
		this.toggleAllBtn.toggleClass("is-active", anyVisible);
		this.toggleAllBtn.toggleClass("qnb-btn-disabled", !hasNotes);
		(this.toggleAllBtn as HTMLButtonElement).disabled = !hasNotes;
	}

	private refreshVisibilityButtons() {
		this.updateToggleAllButtonState();
		for (const [name, btn] of this.categoryButtons) {
			this.updateCategoryButtonState(btn, name);
		}
		this.updateFavoritesRow();
		this.updateLabelsRow();
	}

	/** Ridisegna i "chip" della riga preferiti (o la nasconde se vuota/disattivata). */
	private updateFavoritesRow() {
		if (!this.favoritesRowEl) return;
		const row = this.favoritesRowEl;
		row.empty();

		const favorites = this.plugin.notes.filter((n) => !n.deleted && !n.archived && n.favorite);
		if (favorites.length === 0) {
			row.setCssStyles({ display: "none" });
			return;
		}
		row.setCssStyles({ display: "flex" });

		for (const note of favorites) {
			const chip = row.createEl("button", { cls: "qnb-favorite-chip", attr: { type: "button" } });
			chip.toggleClass("qnb-favorite-chip-full", this.plugin.settings.favoriteChipFullTitle);
			const catColor = this.plugin.getCategoryColor(note.category);
			if (catColor) chip.setCssProps({ "--qnb-cat-color": catColor });
			setIcon(chip.createSpan({ cls: "qnb-favorite-chip-icon" }), "star");
			chip.createSpan({ cls: "qnb-favorite-chip-title", text: note.title });
			chip.addEventListener("click", () => void this.recallFavorite(note));
		}
	}

	/** Ridisegna i "chip" della riga filtro etichette (o la nasconde se non ci sono
	 * etichette definite). Cliccando più di uno insieme, il filtro li incrocia: mostra
	 * solo le note che hanno TUTTE le etichette selezionate, non una qualsiasi. */
	private updateLabelsRow() {
		if (!this.labelsRowEl) return;
		const row = this.labelsRowEl;
		row.empty();

		const labels = this.plugin.settings.labels;
		if (labels.length === 0) {
			row.setCssStyles({ display: "none" });
			return;
		}
		row.setCssStyles({ display: "flex" });

		for (const label of labels) {
			const chip = row.createEl("button", { cls: "qnb-label-chip", attr: { type: "button" } });
			chip.setCssProps({ "--qnb-label-color": label.color || "#888888" });
			chip.toggleClass("is-active", this.activeLabelFilterIds.has(label.id));
			chip.createSpan({ cls: "qnb-label-chip-dot" });
			chip.createSpan({ cls: "qnb-label-chip-title", text: label.name });
			chip.addEventListener("click", () => {
				if (this.activeLabelFilterIds.has(label.id)) {
					this.activeLabelFilterIds.delete(label.id);
				} else {
					this.activeLabelFilterIds.add(label.id);
				}
				this.plugin.playSound("toolbar-label-filter-toggle");
				this.updateLabelsRow();
				this.renderBoard();
			});
		}
	}

	/** Richiama un preferito dalla toolbar: la rende visibile anche se la sua categoria è
	 * momentaneamente nascosta, la porta in primo piano, e ci scorre sopra evidenziandola. */
	private async recallFavorite(note: QuickNote) {
		this.plugin.playSound("toolbar-favorite-recall");

		// Le note fissate restano sempre visibili a prescindere (stesso criterio già
		// usato per "Tutte" e i pulsanti categoria): per loro il click porta comunque in
		// primo piano e scorre in vista, ma non le nasconde mai.
		if (!note.pinned && !note.hidden) {
			// Già visibile: il click la richiude, come ricliccare un pulsante categoria acceso.
			note.hidden = true;
			await this.plugin.saveNotes();
			this.refreshVisibilityButtons();
			this.renderBoard();
			return;
		}

		note.hidden = false;
		const idx = this.noteOrder.indexOf(note.id);
		if (idx !== -1) this.noteOrder.splice(idx, 1);
		this.noteOrder.push(note.id);
		await this.plugin.saveNotes();
		this.refreshVisibilityButtons();
		this.renderBoard();

		window.requestAnimationFrame(() => {
			const el = this.noteElements.get(note.id);
			if (!el) return;
			el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
			el.addClass("qnb-favorite-recalled");
			window.setTimeout(() => el.removeClass("qnb-favorite-recalled"), 1500);
		});
	}

	/** Raggiunge una quick note collegata da un link [Titolo](qnb://id): la rende
	 * visibile (anche se la sua categoria è nascosta), la porta in primo piano, e ci
	 * scorre sopra evidenziandola — stessa meccanica del richiamo di un preferito. */
	private navigateToQuickNote(id: string) {
		const target = this.plugin.notes.find((n) => n.id === id);
		if (!target || target.deleted) {
			new Notice(this.tr("view.qnbLink.notFound"));
			return;
		}
		if (target.archived) {
			new Notice(this.tr("view.qnbLink.archived"));
			return;
		}

		this.plugin.playSound("note-qnb-link-navigate");
		target.hidden = false;
		const idx = this.noteOrder.indexOf(target.id);
		if (idx !== -1) this.noteOrder.splice(idx, 1);
		this.noteOrder.push(target.id);
		void this.plugin.saveNotes();
		this.refreshVisibilityButtons();
		this.renderBoard();

		window.requestAnimationFrame(() => {
			const el = this.noteElements.get(target.id);
			if (!el) return;
			el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
			el.addClass("qnb-favorite-recalled");
			window.setTimeout(() => el.removeClass("qnb-favorite-recalled"), 1500);
		});
	}

	/** Chiamato dal plugin quando scatta un avviso di scadenza: porta la nota in primo
	 * piano ed evidenziata (la nota è già stata resa visibile dal plugin stesso, prima
	 * di chiamare questo metodo). */
	focusNote(id: string) {
		const target = this.plugin.notes.find((n) => n.id === id);
		if (!target || target.deleted || target.archived) return;

		let needsSave = false;
		if (target.hidden) {
			target.hidden = false;
			needsSave = true;
		}

		const idx = this.noteOrder.indexOf(target.id);
		if (idx !== -1) this.noteOrder.splice(idx, 1);
		this.noteOrder.push(target.id);
		this.refreshVisibilityButtons();
		this.renderBoard();
		if (needsSave) void this.plugin.saveNotes();

		window.requestAnimationFrame(() => {
			const el = this.noteElements.get(target.id);
			if (!el) return;
			el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
			el.addClass("qnb-favorite-recalled");
			window.setTimeout(() => el.removeClass("qnb-favorite-recalled"), 1500);
		});
	}

	/** Aggiorna solo la classe del bordo lampeggiante su ogni nota già a schermo, senza
	 * ricostruire nulla — chiamato dal plugin ad ogni controllo periodico, sulla stessa
	 * identica cadenza con cui vengono valutati notifica e suono, così bordo e allarme
	 * sonoro restano sempre sincronizzati. Non tocca in alcun modo una nota che si sta
	 * eventualmente modificando in quel momento (nessun ridisegno, solo una classe CSS). */
	refreshDueBorders() {
		for (const [id, el] of this.noteElements) {
			const note = this.plugin.notes.find((n) => n.id === id);
			if (!note) continue;
			el.toggleClass("qnb-note-due-alert", this.plugin.isNoteDueActive(note));
		}
	}

	private closeGroupPopup() {
		if (!this.activeGroupPopup) return;
		const doc = this.activeGroupPopup.ownerDocument;
		this.activeGroupPopup.remove();
		this.activeGroupPopup = null;
		doc.removeEventListener("mousedown", this.closeGroupPopupOnOutsideClickBound, true);
		doc.removeEventListener("keydown", this.closeGroupPopupOnEscapeBound);
	}

	private closeGroupPopupOnEscapeBound = (evt: KeyboardEvent) => {
		if (evt.key === "Escape") this.closeGroupPopup();
	};

	private closeGroupPopupOnOutsideClickBound = (evt: MouseEvent) => {
		if (!this.activeGroupPopup) return;
		const target = evt.target as HTMLElement;
		if (this.activeGroupPopup.contains(target)) return; // click dentro il popup: gestito dai suoi item
		if (target.closest(".qnb-group-menu-btn")) return; // click sul pulsante che apre/chiude: se ne occupa lui stesso
		this.closeGroupPopup();
	};

	/** Apre (o chiude, se già aperto) il menu a comparsa con i gruppi di una categoria. */
	private toggleGroupPopup(anchorEl: HTMLElement, cat: QnbCategory) {
		const wasOpenForThisAnchor = this.activeGroupPopup?.dataset.anchor === cat.name;
		this.closeGroupPopup();
		if (wasOpenForThisAnchor) return; // click sullo stesso pulsante: si limita a chiuderlo

		// Usa il documento del pulsante cliccato, non quello globale: se la board è
		// aperta in una finestra "staccata" da Obsidian, sono due documenti diversi, e
		// aggiungere il menu in quello sbagliato lo farebbe comparire mal posizionato
		// (o tagliato) rispetto a dove si vede davvero il pulsante.
		const doc = anchorEl.ownerDocument;
		const win = doc.defaultView ?? window;

		const popup = doc.body.createDiv({ cls: "qnb-group-popup" });
		popup.dataset.anchor = cat.name;
		// Invisibile finché non ne misuriamo le dimensioni reali, per poterlo
		// posizionare correttamente al primo tentativo senza un lampeggio visibile.
		popup.setCssStyles({ visibility: "hidden" });

		for (const grp of cat.groups) {
			this.renderGroupPopupItem(popup, cat, grp);
		}

		// Posiziona il popup restando sempre dentro i bordi visibili della finestra:
		// ribalta sopra il pulsante se non c'è spazio sotto, e lo rientra
		// orizzontalmente se sconfinerebbe a destra.
		const anchorRect = anchorEl.getBoundingClientRect();
		const popupRect = popup.getBoundingClientRect();
		const viewportWidth = win.innerWidth;
		const viewportHeight = win.innerHeight;
		const margin = 6;

		let left = anchorRect.left;
		if (left + popupRect.width > viewportWidth - margin) {
			left = Math.max(margin, viewportWidth - popupRect.width - margin);
		}
		if (left < margin) left = margin;

		let top = anchorRect.bottom + 4;
		if (top + popupRect.height > viewportHeight - margin) {
			const above = anchorRect.top - popupRect.height - 4;
			top = above >= margin ? above : Math.max(margin, viewportHeight - popupRect.height - margin);
		}

		popup.setCssStyles({ left: `${left}px` });
		popup.setCssStyles({ top: `${top}px` });
		popup.setCssStyles({ visibility: "visible" });

		this.activeGroupPopup = popup;
		doc.addEventListener("mousedown", this.closeGroupPopupOnOutsideClickBound, true);
		doc.addEventListener("keydown", this.closeGroupPopupOnEscapeBound);
	}

	/** Disegna una voce del menu gruppi (e, se il gruppo ha sottogruppi, una freccina
	 * che li espande/comprime nello stesso popup, richiamando questo metodo su sé stesso). */
	private renderGroupPopupItem(containerEl: HTMLElement, cat: QnbCategory, grp: QnbGroup) {
		// "A cascata": nascondere/mostrare un gruppo agisce anche su tutti i suoi
		// sottogruppi a qualunque profondità, come deciso.
		const relevantIds = this.plugin.getGroupAndDescendantIds(cat.name, grp.id);
		const notesOfGroup = this.plugin.notes.filter(
			(n) => !n.deleted && !n.archived && !n.pinned && n.category === cat.name && relevantIds.has(n.groupId)
		);
		const hasNotes = notesOfGroup.length > 0;
		const anyVisible = hasNotes && notesOfGroup.some((n) => !n.hidden);

		const row = containerEl.createDiv({ cls: "qnb-group-popup-row" });
		const item = row.createDiv({ cls: "qnb-group-popup-item" });
		item.setCssProps({ "--qnb-cat-color": cat.color });
		item.toggleClass("is-active", anyVisible);
		item.toggleClass("qnb-btn-disabled", !hasNotes);

		const hasChildren = grp.groups.length > 0;
		let childHost: HTMLElement | null = null;

		if (hasChildren) {
			const expandBtn = item.createEl("button", {
				cls: "qnb-group-popup-expand",
				attr: { type: "button" },
			});
			setIcon(expandBtn, "chevron-right");
			expandBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				if (!childHost) return;
				const isOpen = childHost.style.display !== "none";
				childHost.setCssStyles({ display: isOpen ? "none" : "block" });
				expandBtn.toggleClass("is-expanded", !isOpen);
			});
		} else {
			item.createDiv({ cls: "qnb-group-popup-expand-spacer" });
		}

		item.createDiv({ cls: "qnb-group-popup-dot" });
		item.createSpan({ text: grp.name });

		if (hasNotes) {
			item.addEventListener("click", (evt) => {
				void (async () => {
					evt.stopPropagation();
					// Riusa volutamente il suono del toggle categoria, come deciso.
					this.plugin.playSound("toolbar-category-toggle");
					for (const n of notesOfGroup) n.hidden = anyVisible;
					await this.plugin.saveNotes();
					this.closeGroupPopup();
					this.refreshVisibilityButtons();
					this.renderBoard();
				})();
			});
		}

		if (hasChildren) {
			childHost = row.createDiv({ cls: "qnb-group-popup-children" });
			childHost.setCssStyles({ display: "none" });
			for (const child of grp.groups) {
				this.renderGroupPopupItem(childHost, cat, child);
			}
		}
	}

	/** Ricompone le sole note attualmente visibili (rispetta filtri di categoria/gruppo
	 * e un'eventuale ricerca attiva) in righe ordinate, senza sovrapposizioni: rispetta
	 * la dimensione di ciascuna nota (non la ridimensiona), va a capo quando la riga
	 * supererebbe la larghezza visibile della board. Le note nascoste non vengono toccate. */
	private async tidyUpNotes() {
		const visibleNotes = this.plugin.notes.filter(
			(n) => !n.deleted && !n.archived && !n.pinned && this.isNoteVisible(n)
		);
		if (visibleNotes.length === 0) return;

		this.plugin.playSound("toolbar-tidy-up");

		// Cinque modalità, una dopo l'altra ad ogni click (poi si ricomincia dalla prima).
		// La prima è quella "storica": ordina per posizione attuale (alto poi sinistra),
		// non per grandezza — le altre quattro ordinano per superficie (largh. × alt.),
		// in orizzontale (per righe) o verticale (per colonne), crescente o decrescente.
		const modes: {
			labelKey: string;
			sort: (a: QuickNote, b: QuickNote) => number;
			direction: "rows" | "columns";
		}[] = [
			{ labelKey: "view.tidyUp.mode.current", sort: (a, b) => a.y - b.y || a.x - b.x, direction: "rows" },
			{
				labelKey: "view.tidyUp.mode.smallToLargeHorizontal",
				sort: (a, b) => a.w * a.h - b.w * b.h,
				direction: "rows",
			},
			{
				labelKey: "view.tidyUp.mode.largeToSmallHorizontal",
				sort: (a, b) => b.w * b.h - a.w * a.h,
				direction: "rows",
			},
			{
				labelKey: "view.tidyUp.mode.smallToLargeVertical",
				sort: (a, b) => a.w * a.h - b.w * b.h,
				direction: "columns",
			},
			{
				labelKey: "view.tidyUp.mode.largeToSmallVertical",
				sort: (a, b) => b.w * b.h - a.w * a.h,
				direction: "columns",
			},
		];

		const mode = modes[this.tidyModeIndex];
		const sorted = [...visibleNotes].sort(mode.sort);

		const gap = 20;
		const startX = 40;
		const startY = 40;

		if (mode.direction === "rows") {
			// Riempie per righe: va a capo su una nuova riga quando si supera la larghezza
			// disponibile (comportamento identico a quello di sempre).
			const maxWidth = Math.max(this.boardEl.clientWidth - startX - gap, 260);
			let cursorX = startX;
			let cursorY = startY;
			let rowHeight = 0;
			for (const note of sorted) {
				if (cursorX !== startX && cursorX + note.w > startX + maxWidth) {
					cursorX = startX;
					cursorY += rowHeight + gap;
					rowHeight = 0;
				}
				note.x = cursorX;
				note.y = cursorY;
				cursorX += note.w + gap;
				rowHeight = Math.max(rowHeight, note.h);
			}
		} else {
			// Riempie per colonne, ma restando sempre entro la larghezza visibile: quando
			// una nuova colonna non ci starebbe più in larghezza, si passa a una nuova
			// "fascia" di colonne sotto quella precedente — mai a un'altra a destra fuori
			// schermo. Serve sempre e solo scorrere in verticale, mai lateralmente.
			//
			// Due vincoli da controllare per OGNI nota (non solo al cambio colonna):
			// - larghezza della colonna (una nota più larga di quelle già in colonna la fa
			//   sforare a destra pur restando nella stessa colonna — bug corretto in
			//   precedenza);
			// - altezza usata ALL'INTERNO della fascia corrente, non la posizione assoluta
			//   sullo schermo: usare quest'ultima (come nella versione precedente) rendeva
			//   il confronto sempre vero per qualunque fascia dopo la prima, impacchettando
			//   una sola nota per colonna invece di più — sprecando spazio verticale e
			//   spingendo le note ben più in basso del necessario (bug corretto ora).
			const viewWidth = Math.max(this.boardEl.clientWidth, startX + 260);
			const bandHeightLimit = Math.max(this.boardEl.clientHeight - startY, 200);

			let bandStartY = startY;
			let cursorX = startX;
			let cursorY = startY;
			let colWidth = 0;
			let bandHeight = 0;

			for (const note of sorted) {
				const usedInColumn = cursorY - bandStartY;
				const overflowsColumnHeight = usedInColumn > 0 && usedInColumn + note.h > bandHeightLimit;
				const overflowsColumnWidth = colWidth > 0 && cursorX + note.w > viewWidth;

				if (overflowsColumnHeight || overflowsColumnWidth) {
					// Non ci sta più (in altezza o in larghezza) in questa colonna: prova
					// la prossima colonna.
					cursorX += colWidth + gap;
					cursorY = bandStartY;
					colWidth = 0;

					if (cursorX !== startX && cursorX + note.w > viewWidth) {
						// Nemmeno una nuova colonna ci sta più in larghezza: nuova fascia sotto.
						cursorX = startX;
						bandStartY += bandHeight + gap;
						cursorY = bandStartY;
						bandHeight = 0;
					}
				}
				note.x = cursorX;
				note.y = cursorY;
				cursorY += note.h + gap;
				colWidth = Math.max(colWidth, note.w);
				bandHeight = Math.max(bandHeight, cursorY - bandStartY - gap);
			}
		}

		await this.plugin.saveNotes();
		this.renderBoard();
		new Notice(
			this.tr("view.tidyUp.done", { count: String(visibleNotes.length), mode: this.tr(mode.labelKey) })
		);

		this.tidyModeIndex = (this.tidyModeIndex + 1) % modes.length;
	}

	private openNewNoteModal() {
		new NewNoteModal(this.app, this.plugin, this.plugin.settings.categories, (title, category, groupId) => {
			void (async () => {
			const offset = (this.plugin.notes.length % 8) * 24;
			const note: QuickNote = {
				id: cryptoRandomId(),
				title: title || this.tr("view.note.untitled"),
				category: category || "Generale",
				groupId: groupId || "",
				content: "",
				x: 40 + offset,
				y: 40 + offset,
				w: this.plugin.settings.defaultNoteWidth,
				h: this.plugin.settings.defaultNoteHeight,
				fontSize: DEFAULT_FONT_SIZE,
				fontFamily: DEFAULT_FONT_FAMILY,
				fontColor: DEFAULT_FONT_COLOR,
				bgColor: DEFAULT_BG_COLOR,
				deleted: false,
				hidden: false,
				archived: false,
				encrypted: false,
				pinned: false,
				createdAt: Date.now(),
				modifiedAt: Date.now(),
				favorite: false,
			};
			this.plugin.notes.push(note);
			await this.plugin.saveNotes();
			this.refreshVisibilityButtons();
			this.renderBoard();
			})();
		}).open();
	}

	/** Vero se il testo di ricerca corrente compare nel titolo (sempre) o nel contenuto
	 * (solo per note non cifrate: il contenuto di una nota cifrata è un blob illeggibile,
	 * cercarci dentro non avrebbe senso). Nessuna ricerca attiva = corrisponde sempre. */
	private noteMatchesSearch(note: QuickNote): boolean {
		const q = this.searchQuery.trim().toLowerCase();
		if (!q) return true;
		if (note.title.toLowerCase().includes(q)) return true;
		if (!note.encrypted && note.content.toLowerCase().includes(q)) return true;
		if (note.labelIds && note.labelIds.length > 0) {
			const labelNames = this.plugin.settings.labels
				.filter((l) => note.labelIds!.includes(l.id))
				.map((l) => l.name.toLowerCase());
			if (labelNames.some((name) => name.includes(q))) return true;
		}
		return false;
	}

	/** Con ricerca attiva, ignora completamente lo stato "nascosta" (salvato, legato a
	 * categorie/gruppi): mostra solo chi corrisponde, comprese le note normalmente
	 * nascoste, e nasconde tutto il resto. Senza ricerca, torna al comportamento normale. */
	private isNoteVisible(note: QuickNote): boolean {
		const hasLabelFilter = this.activeLabelFilterIds.size > 0;
		const hasSearch = !!this.searchQuery.trim();

		if (hasLabelFilter) {
			const noteLabels = new Set(note.labelIds || []);
			for (const id of this.activeLabelFilterIds) {
				if (!noteLabels.has(id)) return false;
			}
		}
		if (hasSearch && !this.noteMatchesSearch(note)) return false;

		// Un filtro etichette o una ricerca attivi vincono sullo stato nascosto/categoria
		// chiusa — è proprio il loro scopo (trovare le note a prescindere da dove sono
		// organizzate), esattamente come la ricerca da sola ha sempre già fatto. Non
		// tocca mai note.hidden: è solo una lente temporanea, sparisce quando il filtro
		// si svuota, senza lasciare in giro note "riaperte" per sbaglio.
		if (hasLabelFilter || hasSearch) return true;

		return note.pinned || !note.hidden;
	}

	private renderBoard() {
		// Disconnette i ResizeObserver delle note precedenti PRIMA di rimuoverle dal DOM,
		// altrimenti possono scattare su elementi staccati (rect 0x0) e corrompere w/h salvati.
		for (const ro of this.activeResizeObservers) ro.disconnect();
		this.activeResizeObservers = [];

		this.boardEl.empty();
		this.noteElements.clear();

		// Toglie dalla selezione le note nel frattempo sparite (cancellate/archiviate):
		// non avrebbe senso poterci ancora agire sopra.
		for (const id of [...this.selectedNoteIds]) {
			if (!this.plugin.notes.some((n) => n.id === id && !n.deleted && !n.archived)) {
				this.selectedNoteIds.delete(id);
			}
		}

		// Stessa cosa per la nota eventualmente massimizzata: se non esiste più, o non è
		// più visibile, non ha senso restare in quello stato.
		if (this.maximizedNoteId) {
			const stillValid = this.plugin.notes.some(
				(n) => n.id === this.maximizedNoteId && !n.deleted && !n.archived && this.isNoteVisible(n)
			);
			if (!stillValid) this.maximizedNoteId = null;
		}
		this.boardEl.toggleClass("qnb-has-maximized-note", this.maximizedNoteId !== null);

		const notes = this.plugin.notes.filter((n) => !n.deleted && !n.archived && this.isNoteVisible(n));

		if (notes.length === 0) {
			this.boardEl.createDiv({
				cls: "qnb-empty-state",
				text: this.searchQuery.trim() ? this.tr("view.search.noResults") : this.tr("view.emptyState"),
			});
			return;
		}

		// Le note nuove/non ancora viste entrano in fondo all'ordine (= in cima visivamente).
		for (const n of notes) {
			if (!this.noteOrder.includes(n.id)) this.noteOrder.push(n.id);
		}
		notes.sort((a, b) => this.noteOrder.indexOf(a.id) - this.noteOrder.indexOf(b.id));

		notes.forEach((note, index) => this.renderNote(note, note.pinned ? 10000 + index : 10 + index));
	}

	/** Avvia il riquadro di selezione trascinando dall'area vuota della board. Un click
	 * senza trascinamento (spostamento sotto una soglia minima) deseleziona tutto invece;
	 * tenendo premuto Ctrl/Cmd/Shift, il riquadro si aggiunge alla selezione attuale
	 * invece di sostituirla. */
	private startMarqueeSelection(evt: MouseEvent) {
		const boardRect = this.boardEl.getBoundingClientRect();
		const startX = evt.clientX - boardRect.left + this.boardEl.scrollLeft;
		const startY = evt.clientY - boardRect.top + this.boardEl.scrollTop;
		const additive = evt.ctrlKey || evt.metaKey || evt.shiftKey;
		this.marqueeStart = { x: startX, y: startY, additive };

		const marquee = this.boardEl.createDiv({ cls: "qnb-marquee" });
		marquee.setCssStyles({ left: `${startX}px` });
		marquee.setCssStyles({ top: `${startY}px` });
		marquee.setCssStyles({ width: "0px" });
		marquee.setCssStyles({ height: "0px" });
		this.marqueeEl = marquee;

		let moved = false;

		const onMove = (moveEvt: MouseEvent) => {
			if (!this.marqueeStart || !this.marqueeEl) return;
			const curX = moveEvt.clientX - boardRect.left + this.boardEl.scrollLeft;
			const curY = moveEvt.clientY - boardRect.top + this.boardEl.scrollTop;
			const left = Math.min(this.marqueeStart.x, curX);
			const top = Math.min(this.marqueeStart.y, curY);
			const width = Math.abs(curX - this.marqueeStart.x);
			const height = Math.abs(curY - this.marqueeStart.y);
			if (width > 3 || height > 3) moved = true;
			this.marqueeEl.setCssStyles({ left: `${left}px` });
			this.marqueeEl.setCssStyles({ top: `${top}px` });
			this.marqueeEl.setCssStyles({ width: `${width}px` });
			this.marqueeEl.setCssStyles({ height: `${height}px` });
		};

		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);

			if (this.marqueeEl) {
				const rect = {
					left: parseFloat(this.marqueeEl.style.left),
					top: parseFloat(this.marqueeEl.style.top),
					width: parseFloat(this.marqueeEl.style.width),
					height: parseFloat(this.marqueeEl.style.height),
				};
				this.marqueeEl.remove();
				this.marqueeEl = null;

				if (moved) {
					if (!(this.marqueeStart?.additive ?? false)) this.selectedNoteIds.clear();
					for (const id of this.noteElements.keys()) {
						const n = this.plugin.notes.find((nn) => nn.id === id);
						if (!n) continue;
						const intersects =
							n.x < rect.left + rect.width &&
							n.x + n.w > rect.left &&
							n.y < rect.top + rect.height &&
							n.y + n.h > rect.top;
						if (intersects) this.selectedNoteIds.add(id);
					}
				} else {
					this.selectedNoteIds.clear();
				}
			}

			this.marqueeStart = null;
			this.applySelectionVisuals();
		};

		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", () => void onUp());
	}

	/** Aggiorna solo la classe "selezionata" sulle note già a schermo, senza ridisegnare
	 * l'intera board (che interromperebbe eventuali modifiche in corso altrove). */
	private applySelectionVisuals() {
		for (const [id, el] of this.noteElements) {
			el.toggleClass("is-selected", this.selectedNoteIds.has(id));
		}
	}

	private clearSelection() {
		this.selectedNoteIds.clear();
		this.applySelectionVisuals();
	}

	private async bulkArchive() {
		if (this.selectedNoteIds.size === 0) return;
		this.plugin.playSound("note-archive");
		for (const note of this.plugin.notes) {
			if (this.selectedNoteIds.has(note.id)) {
				note.archived = true;
				const idx = this.noteOrder.indexOf(note.id);
				if (idx !== -1) this.noteOrder.splice(idx, 1);
			}
		}
		const count = this.selectedNoteIds.size;
		this.selectedNoteIds.clear();
		await this.plugin.saveNotes();
		this.refreshVisibilityButtons();
		this.renderBoard();
		new Notice(this.tr("view.selection.archivedDone", { count: String(count) }));
	}

	private async bulkMinimize() {
		if (this.selectedNoteIds.size === 0) return;
		this.plugin.playSound("note-minimize");
		for (const note of this.plugin.notes) {
			if (this.selectedNoteIds.has(note.id)) {
				note.hidden = true;
				this.plugin.stopDueAlarm(note.id);
			}
		}
		const count = this.selectedNoteIds.size;
		this.selectedNoteIds.clear();
		await this.plugin.saveNotes();
		this.refreshVisibilityButtons();
		this.renderBoard();
		new Notice(this.tr("view.selection.minimizedDone", { count: String(count) }));
	}

	/** Se sono già tutte fissate, le sblocca tutte; altrimenti le fissa tutte — evita
	 * l'ambiguità di un semplice toggle quando la selezione ha stati misti. */
	private async bulkTogglePin() {
		if (this.selectedNoteIds.size === 0) return;
		const selected = this.plugin.notes.filter((n) => this.selectedNoteIds.has(n.id));
		const allPinned = selected.length > 0 && selected.every((n) => n.pinned);
		const newValue = !allPinned;

		this.plugin.playSound("note-pin");
		for (const note of selected) {
			note.pinned = newValue;
		}
		const count = this.selectedNoteIds.size;
		this.selectedNoteIds.clear();
		await this.plugin.saveNotes();
		this.refreshVisibilityButtons();
		this.renderBoard();
		new Notice(
			newValue
				? this.tr("view.selection.pinnedDone", { count: String(count) })
				: this.tr("view.selection.unpinnedDone", { count: String(count) })
		);
	}

	private async bulkTrash() {
		if (this.selectedNoteIds.size === 0) return;
		this.plugin.playSound("note-delete");
		for (const note of this.plugin.notes) {
			if (this.selectedNoteIds.has(note.id)) {
				note.deleted = true;
				const idx = this.noteOrder.indexOf(note.id);
				if (idx !== -1) this.noteOrder.splice(idx, 1);
			}
		}
		const count = this.selectedNoteIds.size;
		this.selectedNoteIds.clear();
		await this.plugin.saveNotes();
		this.refreshVisibilityButtons();
		this.renderBoard();
		new Notice(this.tr("view.selection.trashedDone", { count: String(count) }));
	}

	private bulkChangeCategory() {
		if (this.selectedNoteIds.size === 0) return;
		const ids = [...this.selectedNoteIds];
		const firstNote = this.plugin.notes.find((n) => n.id === ids[0]);

		new ChangeCategoryModal(
			this.app,
			this.plugin,
			firstNote?.category || "Generale",
			firstNote?.groupId || "",
			this.plugin.settings.categories,
			(newCategory, newGroupId) => {
				void (async () => {
					for (const note of this.plugin.notes) {
						if (this.selectedNoteIds.has(note.id)) {
							note.category = newCategory;
							note.groupId = newGroupId;
						}
					}
					const count = this.selectedNoteIds.size;
					this.selectedNoteIds.clear();
					await this.plugin.saveNotes();
					this.refreshVisibilityButtons();
					this.renderBoard();
					new Notice(this.tr("view.selection.categoryDone", { count: String(count) }));
				})();
			}
		).open();
	}

	/** Crea un file .md vero nel vault a partire dal contenuto della nota, e sostituisce
	 * il contenuto della quick note con un link ad esso. Le note cifrate vengono
	 * rifiutate (il contenuto sarebbe il blob cifrato, non testo leggibile). Non salva
	 * né ridisegna da sola: lo fa chi la chiama, una volta sola anche per uso in blocco. */
	/** Trova un percorso .md libero a partire da basePath (senza estensione), aggiungendo
	 * " 1", " 2"... se un file con quel nome esiste già — stesso criterio che usa Obsidian. */
	private async getAvailableFilePath(basePath: string): Promise<string> {
		let path = `${basePath}.md`;
		let counter = 1;
		while (await this.app.vault.adapter.exists(path)) {
			path = `${basePath} ${counter}.md`;
			counter++;
		}
		return path;
	}

	private async convertNoteToFile(note: QuickNote, opts: { openAfter?: boolean } = {}): Promise<boolean> {
		if (note.encrypted) {
			new Notice(this.tr("view.note.convertLockedError"));
			return false;
		}

		const folder = this.plugin.settings.convertedNotesFolder.trim();
		const baseName = sanitizeFileName(note.title || this.tr("view.note.untitled"));
		const basePath = folder ? `${folder}/${baseName}` : baseName;

		try {
			const path = await this.getAvailableFilePath(basePath);
			const file = await this.app.vault.create(path, note.content);
			note.content = this.app.fileManager.generateMarkdownLink(file, "");
			this.plugin.playSound("note-convert");
			if (opts.openAfter) {
				await this.app.workspace.getLeaf("tab").openFile(file);
			}
			return true;
		} catch (e) {
			console.error("Quick Notes Board: errore nella conversione della nota in file", e);
			new Notice(this.tr("view.note.convertError", { title: note.title }));
			return false;
		}
	}

	private async bulkConvertToNotes() {
		if (this.selectedNoteIds.size === 0) return;
		const targets = this.plugin.notes.filter((n) => this.selectedNoteIds.has(n.id));

		let converted = 0;
		let skipped = 0;
		for (const note of targets) {
			const ok = await this.convertNoteToFile(note);
			if (ok) converted++;
			else skipped++;
		}

		this.selectedNoteIds.clear();
		await this.plugin.saveNotes();
		this.refreshVisibilityButtons();
		this.renderBoard();

		if (skipped > 0) {
			new Notice(
				this.tr("view.selection.convertPartialDone", {
					converted: String(converted),
					skipped: String(skipped),
				})
			);
		} else {
			new Notice(this.tr("view.selection.convertDone", { count: String(converted) }));
		}
	}

	private bringToFront(note: QuickNote, noteEl: HTMLElement) {
		const idx = this.noteOrder.indexOf(note.id);
		if (idx !== -1) this.noteOrder.splice(idx, 1);
		this.noteOrder.push(note.id);

		// Solo una proprietà CSS: nessuna mutazione dell'albero DOM, quindi non può
		// interferire con la consegna di click/mousedown ai pulsanti della nota.
		this.zCounter += 1;
		noteEl.setCssStyles({ zIndex: String(this.zCounter) });
	}

	private renderNote(note: QuickNote, initialZIndex: number) {
		const noteEl = this.boardEl.createDiv({ cls: "qnb-note" });
		if (this.searchQuery.trim()) noteEl.addClass("qnb-search-match");
		if (note.pinned) noteEl.addClass("is-pinned");
		if (this.plugin.isNoteDueActive(note)) noteEl.addClass("qnb-note-due-alert");
		if (this.maximizedNoteId === note.id) noteEl.addClass("qnb-note-maximized");
		this.noteElements.set(note.id, noteEl);
		if (this.selectedNoteIds.has(note.id)) noteEl.addClass("is-selected");

		// Sollevamento al passaggio del mouse: gestito in JS (non solo CSS :hover) perché
		// deve poter tornare normale da solo dopo un tempo configurabile, anche se il
		// mouse resta sopra — altrimenti, spostando leggermente la nota, il cursore può
		// uscire e rientrare dai suoi bordi ripetutamente (specialmente vicino alle
		// maniglie di ridimensionamento), facendola "sobbalzare" senza controllo.
		let hoverLiftTimeout: number | null = null;
		noteEl.addEventListener("mouseenter", () => {
			if (!this.plugin.settings.hoverLiftEffect) return;
			noteEl.addClass("qnb-hover-lifted");
			const durationSec = this.plugin.settings.hoverLiftDurationSeconds;
			if (durationSec > 0) {
				if (hoverLiftTimeout !== null) window.clearTimeout(hoverLiftTimeout);
				hoverLiftTimeout = window.setTimeout(() => {
					noteEl.removeClass("qnb-hover-lifted");
					hoverLiftTimeout = null;
				}, durationSec * 1000);
			}
		});
		noteEl.addEventListener("mouseleave", () => {
			if (hoverLiftTimeout !== null) {
				window.clearTimeout(hoverLiftTimeout);
				hoverLiftTimeout = null;
			}
			noteEl.removeClass("qnb-hover-lifted");
		});

		noteEl.setCssProps({ "--qnb-note-x": `${note.x}px` });
		noteEl.setCssProps({ "--qnb-note-y": `${note.y}px` });
		noteEl.setCssProps({ "--qnb-note-w": `${note.w}px` });
		noteEl.setCssProps({ "--qnb-note-h": `${note.h}px` });
		noteEl.setCssStyles({ zIndex: String(initialZIndex) });
		noteEl.setCssStyles({ backgroundColor: note.bgColor || "" });

		if (!this.noteOrder.includes(note.id)) this.noteOrder.push(note.id);

		// Porta la nota in primo piano ad ogni interazione (drag, click, pulsanti...).
		// Ascoltatore in fase di "capture" così scatta comunque anche se un elemento
		// figlio (pulsanti, textarea) ferma la propagazione del proprio mousedown.
		noteEl.addEventListener(
			"mousedown",
			() => this.bringToFront(note, noteEl),
			true
		);

		// Header: tutta l'area è trascinabile (nessun testo cliccabile/editabile qui)
		const header = noteEl.createDiv({ cls: "qnb-note-header" });

		const categoryColor = this.plugin.getCategoryColor(note.category);
		if (categoryColor) {
			header.addClass("qnb-note-header-colored");
			header.setCssStyles({ backgroundColor: categoryColor });
			header.setCssProps({ "--qnb-header-fg": getContrastTextColor(categoryColor) });
		}

		const categoryIconId = this.plugin.getCategoryIcon(note.category);
		if (categoryIconId) {
			const catIndicator = header.createSpan({ cls: "qnb-note-category-indicator" });
			setIcon(catIndicator, categoryIconId);
			catIndicator.setAttr("aria-label", note.category);
			const explicitIconColor = this.plugin.getCategoryIconColor(note.category);
			if (explicitIconColor) {
				catIndicator.setCssStyles({ color: explicitIconColor });
			}
		}

		const titleEl = header.createDiv({ cls: "qnb-note-title", text: note.title });
		if (this.searchQuery.trim()) highlightTextInElement(titleEl, this.searchQuery.trim());
		const explicitTitleColor = this.plugin.getCategoryTitleColor(note.category);
		if (explicitTitleColor) {
			titleEl.setCssStyles({ color: explicitTitleColor });
		}

		const actions = header.createDiv({ cls: "qnb-note-actions" });

		// Le 12 icone azione sono personalizzabili (ordine e visibilità) dall'utente in
		// Impostazioni — ognuna qui sotto è una funzione che la disegna, richiamata più in
		// basso nell'ordine scelto. La X di chiusura resta sempre fissa, fuori da questo
		// elenco (subito dopo, invariata).
		// Dichiarato qui fuori (non dentro la funzione "toggleView" sotto) perché serve
		// anche altrove nel metodo: per aggiornare l'icona occhio/matita quando si entra
		// in modifica in altri modi (es. cliccando il corpo della nota), non solo
		// cliccando questa icona specifica.
		let toggleModeBtn!: HTMLElement;

		const noteIconCreators: Record<QnbNoteIconId, () => void> = {
			rename: () => {
				const editTitleBtn = actions.createEl("button", { cls: "qnb-note-action-btn", attr: { "aria-label": this.tr("view.note.rename") } });
				setIcon(editTitleBtn, "pencil");
				editTitleBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				editTitleBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.plugin.playSound("note-rename");
					this.startTitleEdit(titleEl, note);
				});
			},

			category: () => {
				const changeCategoryBtn = actions.createEl("button", { cls: "qnb-note-action-btn", attr: { "aria-label": this.tr("view.note.changeCategory") } });
				setIcon(changeCategoryBtn, "tag");
				changeCategoryBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				changeCategoryBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.plugin.playSound("note-category");
					if (this.selectedNoteIds.has(note.id) && this.selectedNoteIds.size > 1) {
						this.bulkChangeCategory();
						return;
					}
					try {
						new ChangeCategoryModal(
							this.app,
							this.plugin,
							note.category,
							note.groupId,
							this.plugin.settings.categories,
							(newCategory, newGroupId) => {
								void (async () => {
									if (newCategory === note.category && newGroupId === note.groupId) return;
									note.category = newCategory;
									note.groupId = newGroupId;
									await this.plugin.saveNotes();
									this.refreshVisibilityButtons();
									this.renderBoard();
								})();
							}
						).open();
					} catch (e) {
						console.error("Quick Notes Board: errore nell'apertura del modal categoria", e);
						new Notice(this.tr("view.note.categoryModalError"));
					}
				});
			},

			fontSize: () => {
				const fontSizeBtn = actions.createEl("button", { cls: "qnb-note-action-btn", attr: { "aria-label": this.tr("view.note.fontSize") } });
				setIcon(fontSizeBtn, "type");
				fontSizeBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				let fontSizeSaveTimeout: number | undefined;
				const scheduleFontSave = () => {
					// Ritarda il salvataggio su disco mentre si trascina lo slider, per non
					// scrivere il file ad ogni singolo pixel di variazione.
					window.clearTimeout(fontSizeSaveTimeout);
					fontSizeSaveTimeout = window.setTimeout(() => {
						void this.plugin.saveNotes();
					}, 300);
				};
				fontSizeBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.plugin.playSound("note-fontsize");

					const isBulk = this.selectedNoteIds.has(note.id) && this.selectedNoteIds.size > 1;
					const targets: { note: QuickNote; bodyEl: HTMLElement; noteEl: HTMLElement }[] = isBulk
						? ([...this.selectedNoteIds]
								.map((id) => {
									const n = this.plugin.notes.find((nn) => nn.id === id);
									const el = this.noteElements.get(id);
									const body = el?.querySelector(".qnb-note-body") as HTMLElement | null;
									return n && el && body ? { note: n, bodyEl: body, noteEl: el } : null;
								})
								.filter(Boolean) as { note: QuickNote; bodyEl: HTMLElement; noteEl: HTMLElement }[])
						: [{ note, bodyEl, noteEl }];

					new FontSizeModal(
						this.app,
						this.plugin,
						note.fontSize || DEFAULT_FONT_SIZE,
						note.fontFamily || DEFAULT_FONT_FAMILY,
						note.fontColor || DEFAULT_FONT_COLOR,
						note.bgColor || DEFAULT_BG_COLOR,
						(size) => {
							for (const t of targets) {
								t.note.fontSize = size;
								t.bodyEl.setCssStyles({ fontSize: `${size}px` });
							}
							scheduleFontSave();
						},
						(fontFamily) => {
							for (const t of targets) {
								t.note.fontFamily = fontFamily;
								t.bodyEl.setCssStyles({ fontFamily: FONT_FAMILY_CSS[fontFamily] || "" });
							}
							scheduleFontSave();
						},
						(color) => {
							for (const t of targets) {
								t.note.fontColor = color;
								t.bodyEl.setCssStyles({ color: color || "" });
							}
							scheduleFontSave();
						},
						(bgColor) => {
							for (const t of targets) {
								t.note.bgColor = bgColor;
								t.noteEl.setCssStyles({ backgroundColor: bgColor || "" });
							}
							scheduleFontSave();
						}
					).open();
				});
			},

			toggleView: () => {
				toggleModeBtn = actions.createEl("button", { cls: "qnb-note-action-btn" });
				toggleModeBtn.addEventListener("mousedown", (evt) => {
					// preventDefault evita che il browser sposti subito il focus (e quindi faccia
					// scattare il blur/salvataggio della textarea) PRIMA che il nostro click la gestisca:
					// altrimenti, al click, la textarea risulterebbe già rimossa e si rientrerebbe
					// subito in modifica per errore.
					evt.preventDefault();
					evt.stopPropagation();
				});
				toggleModeBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();
					if (note.encrypted) return; // sbloccare richiede la password, non un toggle diretto
					this.plugin.playSound("note-toggle-view");
					const textarea = bodyEl.querySelector("textarea");
					if (textarea) {
						// Fa scattare il normale flusso di salvataggio/uscita già gestito sul blur.
						textarea.blur();
					} else {
						this.enterEditMode(noteEl, bodyEl, note, toggleModeBtn);
					}
				});
			},

			archive: () => {
				const archiveBtn = actions.createEl("button", { cls: "qnb-note-action-btn", attr: { "aria-label": this.tr("view.note.archive") } });
				setIcon(archiveBtn, "archive");
				archiveBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				archiveBtn.addEventListener("click", (evt) => {
					void (async () => {
						evt.stopPropagation();
						if (this.selectedNoteIds.has(note.id) && this.selectedNoteIds.size > 1) {
							await this.bulkArchive();
							return;
						}
						note.archived = true;
						const idx = this.noteOrder.indexOf(note.id);
						if (idx !== -1) this.noteOrder.splice(idx, 1);
						this.plugin.playSound("note-archive");
						await this.plugin.saveNotes();
						this.refreshVisibilityButtons();
						this.renderBoard();
					})();
				});
			},

			convert: () => {
				const convertBtn = actions.createEl("button", {
					cls: "qnb-note-action-btn",
					attr: { "aria-label": this.tr("view.note.convert") },
				});
				setIcon(convertBtn, "file-plus-2");
				convertBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				convertBtn.addEventListener("click", (evt) => {
					void (async () => {
						evt.stopPropagation();
						if (this.selectedNoteIds.has(note.id) && this.selectedNoteIds.size > 1) {
							await this.bulkConvertToNotes();
							return;
						}
						const ok = await this.convertNoteToFile(note, { openAfter: true });
						if (ok) {
							await this.plugin.saveNotes();
							this.renderBoard();
							new Notice(this.tr("view.note.convertDone", { title: note.title }));
						}
					})();
				});
			},

			lock: () => {
				const lockBtn = actions.createEl("button", { cls: "qnb-note-action-btn" });
				this.updateLockIcon(lockBtn, note.encrypted);
				lockBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				lockBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();

					if (note.encrypted) {
						new LockPasswordModal(this.app, this.plugin, "unlock", async (password) => {
							try {
								const plain = await decryptText(note.content, password);
								note.content = plain;
								note.encrypted = false;
								this.plugin.playSound("note-unlock");
								await this.plugin.saveNotes();
								this.updateLockIcon(lockBtn, note.encrypted);
								this.renderBoard();
								return true;
							} catch (e) {
								if (!(e instanceof DecryptionError)) {
									console.error("Quick Notes Board: errore nello sblocco della nota", e);
								}
								this.plugin.playSound("note-unlock-fail");
								return false;
							}
						}).open();
					} else {
						// Se la nota è in modifica, salva subito il testo digitato prima di cifrarlo:
						// altrimenti si perderebbero le modifiche non ancora confermate col blur.
						const textarea = bodyEl.querySelector("textarea");
						if (textarea) note.content = textarea.value;

						new LockPasswordModal(this.app, this.plugin, "lock", async (password) => {
							const cipher = await encryptText(note.content, password);
							note.content = cipher;
							note.encrypted = true;
							this.plugin.playSound("note-lock");
							await this.plugin.saveNotes();
							this.updateLockIcon(lockBtn, note.encrypted);
							this.renderBoard();
							return true;
						}).open();
					}
				});
			},

			delete: () => {
				const deleteBtn = actions.createEl("button", { cls: "qnb-note-action-btn qnb-note-delete", attr: { "aria-label": this.tr("view.note.delete") } });
				setIcon(deleteBtn, "trash-2");
				deleteBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				deleteBtn.addEventListener("click", (evt) => {
					void (async () => {
						evt.stopPropagation();
						if (this.selectedNoteIds.has(note.id) && this.selectedNoteIds.size > 1) {
							await this.bulkTrash();
							return;
						}
						note.deleted = true;
						const idx = this.noteOrder.indexOf(note.id);
						if (idx !== -1) this.noteOrder.splice(idx, 1);
						this.plugin.playSound("note-delete");
						await this.plugin.saveNotes();
						this.refreshVisibilityButtons();
						this.renderBoard();
					})();
				});
			},

			favorite: () => {
				if (!this.plugin.settings.useFavorites) return;
				const favoriteBtn = actions.createEl("button", { cls: "qnb-note-action-btn" });
				this.updateFavoriteIcon(favoriteBtn, note.favorite);
				favoriteBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				favoriteBtn.addEventListener("click", (evt) => {
					void (async () => {
						evt.stopPropagation();
						note.favorite = !note.favorite;
						this.plugin.playSound("note-favorite");
						await this.plugin.saveNotes();
						this.refreshVisibilityButtons();
						this.renderBoard();
					})();
				});
			},

			alarm: () => {
				const alarmBtn = actions.createEl("button", { cls: "qnb-note-action-btn" });
				this.updateAlarmIcon(alarmBtn, !!note.dueDate);
				alarmBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				alarmBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.plugin.stopDueAlarm(note.id);
					this.plugin.playSound("note-due-date-open");
					new DueDateModal(this.app, this.plugin, note, () => this.renderBoard()).open();
				});
			},

			maximize: () => {
				// Massimizza/ripristina: porta la nota a riempire tutta la board (o la
				// riporta alla sua posizione e dimensione originali, se già massimizzata).
				const maximizeBtn = actions.createEl("button", { cls: "qnb-note-action-btn qnb-maximize-btn" });
				this.updateMaximizeIcon(maximizeBtn, this.maximizedNoteId === note.id);
				maximizeBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				maximizeBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.toggleMaximizeNote(note, noteEl, maximizeBtn);
				});
			},

			pin: () => {
				const pinBtn = actions.createEl("button", { cls: "qnb-note-action-btn" });
				this.updatePinIcon(pinBtn, note.pinned);
				pinBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				pinBtn.addEventListener("click", (evt) => {
					void (async () => {
						evt.stopPropagation();
						if (this.selectedNoteIds.has(note.id) && this.selectedNoteIds.size > 1) {
							await this.bulkTogglePin();
							return;
						}
						note.pinned = !note.pinned;
						this.plugin.playSound("note-pin");
						await this.plugin.saveNotes();
						this.refreshVisibilityButtons();
						this.renderBoard();
					})();
				});
			},

			labels: () => {
				const labelsBtn = actions.createEl("button", {
					cls: "qnb-note-action-btn",
					attr: { "aria-label": this.tr("view.note.labels") },
				});
				setIcon(labelsBtn, "tags");
				labelsBtn.toggleClass("qnb-note-action-active", !!(note.labelIds && note.labelIds.length > 0));
				labelsBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
				labelsBtn.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.plugin.playSound("note-labels");
					new LabelAssignModal(this.app, this.plugin, note, () => this.renderBoard()).open();
				});
			},
		};

		for (const cfg of this.plugin.settings.noteIconOrder) {
			if (!cfg.visible) {
				if (cfg.id === "toggleView") {
					// Il pulsante serve comunque, anche se non deve comparire nella barra:
					// lo creo ma lo nascondo via CSS, invece di ometterlo del tutto.
					noteIconCreators.toggleView();
					toggleModeBtn.addClass("qnb-hidden-action-icon");
				}
				continue;
			}
			noteIconCreators[cfg.id]?.();
		}

		// Icona "X" in fondo a destra, come il pulsante di chiusura di una finestra
		// Windows: posizione familiare, così l'azione di minimizzare la nota (senza
		// cancellarla) è immediatamente riconoscibile. Sempre fissa qui, non fa parte
		// dell'elenco personalizzabile qui sopra.
		const minimizeBtn = actions.createEl("button", { cls: "qnb-note-action-btn", attr: { "aria-label": this.tr("view.note.minimize") } });
		setIcon(minimizeBtn, "x");
		minimizeBtn.addEventListener("mousedown", (evt) => evt.stopPropagation());
		minimizeBtn.addEventListener("click", (evt) => {
			void (async () => {
				evt.stopPropagation();
				if (this.selectedNoteIds.has(note.id) && this.selectedNoteIds.size > 1) {
					await this.bulkMinimize();
					return;
				}
				note.hidden = true;
				this.plugin.stopDueAlarm(note.id);
				this.plugin.playSound("note-minimize");
				await this.plugin.saveNotes();
				this.refreshVisibilityButtons();
				this.renderBoard();
			})();
		});

		// Corpo: markdown renderizzato, click per modificare
		const bodyEl = noteEl.createDiv({ cls: "qnb-note-body" });
		bodyEl.setCssStyles({ fontSize: `${note.fontSize || DEFAULT_FONT_SIZE}px` });
		bodyEl.setCssStyles({ fontFamily: FONT_FAMILY_CSS[note.fontFamily || DEFAULT_FONT_FAMILY] || "" });
		bodyEl.setCssStyles({ color: note.fontColor || "" });
		this.renderNoteBodyPreview(bodyEl, note, noteEl, toggleModeBtn);

		// Ctrl (o Cmd su Mac, dove il trackpad manda comunque ctrlKey per il pinch-to-
		// zoom) + rotellina: ingrandisce/rimpicciolisce solo il testo di questa nota, un
		// passo alla volta, stessi limiti dello slider nel pannello "Aspetto" (10-32px).
		// { passive: false } è indispensabile: senza, preventDefault() verrebbe ignorato
		// in silenzio e la rotellina finirebbe per ingrandire tutta Obsidian invece della
		// singola nota — verificato con attenzione prima di consegnarlo.
		let zoomSaveTimeout: number | undefined;
		bodyEl.addEventListener(
			"wheel",
			(evt: WheelEvent) => {
				if (!evt.ctrlKey) return;
				evt.preventDefault();
				evt.stopPropagation();

				const MIN_FONT_SIZE = 10;
				const MAX_FONT_SIZE = 32;
				const current = note.fontSize || DEFAULT_FONT_SIZE;
				const direction = evt.deltaY < 0 ? 1 : -1;
				const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current + direction));
				if (next === current) return;

				note.fontSize = next;
				bodyEl.setCssStyles({ fontSize: `${next}px` });

				window.clearTimeout(zoomSaveTimeout);
				zoomSaveTimeout = window.setTimeout(() => {
					void this.plugin.saveNotes();
				}, 300);
			},
			{ passive: false }
		);

		bodyEl.addEventListener("click", (evt) => {
			// Ctrl/Cmd+click: seleziona/deseleziona la nota invece di entrare in modifica,
			// da qualunque punto della nota si clicchi (non solo dall'intestazione).
			// Resta invariato indipendentemente dall'opzione "richiedi doppio click".
			if (evt.ctrlKey || evt.metaKey) {
				evt.preventDefault();
				evt.stopPropagation();
				if (this.selectedNoteIds.has(note.id)) this.selectedNoteIds.delete(note.id);
				else this.selectedNoteIds.add(note.id);
				this.applySelectionVisuals();
				return;
			}
			// Con l'opzione attiva, il singolo click non deve fare nulla: si entra in
			// modifica solo con il doppio click (gestito sotto) o con l'icona dedicata.
			if (this.plugin.settings.requireDoubleClickToEdit) return;
			// Non entrare in modifica se si è cliccato su un link (deve solo navigare),
			// sulla maniglia di ridimensionamento di un'immagine incorporata, o se la
			// nota è cifrata (serve la password, dal pulsante lucchetto).
			if ((evt.target as HTMLElement).closest("a")) return;
			if ((evt.target as HTMLElement).closest(".qnb-image-resize-handle")) return;
			if (note.encrypted) return;
			const clickOffset = this.getClickOffsetInRenderedBody(bodyEl, evt.clientX, evt.clientY);
			this.enterEditMode(noteEl, bodyEl, note, toggleModeBtn, clickOffset ?? undefined);
		});
		bodyEl.addEventListener("dblclick", (evt) => {
			if (!this.plugin.settings.requireDoubleClickToEdit) return; // già gestito dal click sopra
			if ((evt.target as HTMLElement).closest("a")) return;
			if ((evt.target as HTMLElement).closest(".qnb-image-resize-handle")) return;
			if ((evt.target as HTMLElement).closest('input[type="checkbox"]')) return;
			if (note.encrypted) return;
			const clickOffset = this.getClickOffsetInRenderedBody(bodyEl, evt.clientX, evt.clientY);
			this.enterEditMode(noteEl, bodyEl, note, toggleModeBtn, clickOffset ?? undefined);
		});
		noteEl.addEventListener("qnb-force-blur", () => {
			const textarea = bodyEl.querySelector("textarea");
			if (textarea) textarea.blur();
		});

		// Drag dalla testata
		header.addEventListener("mousedown", (evt: MouseEvent) => this.startDrag(evt, note, noteEl));
		header.addEventListener("contextmenu", (evt: MouseEvent) => {
			evt.preventDefault();
			const groupPath = note.groupId ? this.plugin.getGroupPath(note.category, note.groupId) : "";
			new NoteInfoModal(this.app, this.plugin, note, groupPath).open();
		});

		// Fascia sottile in fondo alla nota, sopra le maniglie di ridimensionamento: oggi
		// mostra solo i puntini delle etichette (allineati a sinistra), pensata per poter
		// ospitare in futuro altri piccoli elementi (es. mini messaggi) senza doverla
		// ridisegnare da capo. Creata solo se la nota ha almeno un'etichetta assegnata,
		// per non sottrarre spazio inutilmente alle note che non ne hanno.
		if (note.labelIds && note.labelIds.length > 0) {
			const footerEl = noteEl.createDiv({ cls: "qnb-note-footer" });
			const labelsRow = footerEl.createDiv({ cls: "qnb-note-labels-row" });
			for (const id of note.labelIds) {
				const label = this.plugin.settings.labels.find((l) => l.id === id);
				if (!label) continue; // etichetta cancellata nel frattempo: la saltiamo senza errori
				const dot = labelsRow.createSpan({ cls: "qnb-label-dot" });
				dot.setCssStyles({ background: label.color || "#888888" });
				dot.setAttr("aria-label", label.name);
				dot.setAttr("title", label.name);
			}
		}

		// Maniglie di ridimensionamento: destra, sinistra, basso, e i due angoli inferiori.
		this.addResizeHandle(noteEl, note, "e");
		this.addResizeHandle(noteEl, note, "w");
		this.addResizeHandle(noteEl, note, "s");
		this.addResizeHandle(noteEl, note, "se");
		this.addResizeHandle(noteEl, note, "sw");

		// Rete di sicurezza: se le dimensioni cambiano per qualunque motivo, salva comunque.
		let resizeObserverTimeout: number | undefined;
		const resizeObserver = new ResizeObserver(() => {
			window.clearTimeout(resizeObserverTimeout);
			resizeObserverTimeout = window.setTimeout(async () => {
				// L'elemento potrebbe essere stato rimosso nel frattempo (es. cambio filtro
				// o nota eliminata): in tal caso ignora, per non salvare una dimensione 0x0.
				if (!noteEl.isConnected) return;
				const rect = noteEl.getBoundingClientRect();
				if (rect.width < 10 || rect.height < 10) return;
				note.w = rect.width;
				note.h = rect.height;
				await this.plugin.saveNotes();
			}, 300);
		});
		resizeObserver.observe(noteEl);
		this.activeResizeObservers.push(resizeObserver);
	}

	private addResizeHandle(noteEl: HTMLElement, note: QuickNote, dir: "e" | "w" | "s" | "se" | "sw") {
		const handle = noteEl.createDiv({ cls: `qnb-resize-handle qnb-resize-${dir}` });
		// Porta la nota in primo piano già al passaggio del mouse sulla maniglia (non solo
		// al click): se due note si sovrappongono, l'ordine di sovrapposizione con cui il
		// browser assegna il click a un elemento è già deciso PRIMA che il gestore del
		// mousedown venga eseguito. Aggiornandolo solo al click si rischia quindi di
		// afferrare per errore la maniglia della nota sottostante invece di quella attiva.
		handle.addEventListener("mouseenter", () => this.bringToFront(note, noteEl));
		handle.addEventListener("mousedown", (evt: MouseEvent) => this.startResize(evt, note, noteEl, dir, handle));
	}

	private startResize(
		evt: MouseEvent,
		note: QuickNote,
		noteEl: HTMLElement,
		dir: "e" | "w" | "s" | "se" | "sw",
		handle: HTMLElement
	) {
		evt.preventDefault();
		evt.stopPropagation();
		// Da massimizzata, la dimensione è forzata via CSS: non ridimensionare, altrimenti
		// si modificherebbero w/h salvati senza che si veda alcun cambiamento reale.
		if (this.maximizedNoteId === note.id) return;

		const MIN_W = 180;
		const MIN_H = 120;
		const startX = evt.clientX;
		const startY = evt.clientY;
		const origX = note.x;
		const origW = note.w;
		const origH = note.h;

		const resizeRight = dir.includes("e");
		const resizeLeft = dir.includes("w");
		const resizeBottom = dir.includes("s");

		handle.addClass("is-resizing");
		noteEl.addClass("is-dragging");

		const onMove = (moveEvt: MouseEvent) => {
			const dx = moveEvt.clientX - startX;
			const dy = moveEvt.clientY - startY;

			if (resizeRight) {
				note.w = Math.max(MIN_W, origW + dx);
			}
			if (resizeLeft) {
				const newW = Math.max(MIN_W, origW - dx);
				note.w = newW;
				note.x = Math.max(0, origX + (origW - newW));
			}
			if (resizeBottom) {
				note.h = Math.max(MIN_H, origH + dy);
			}

			noteEl.setCssProps({ "--qnb-note-w": `${note.w}px` });
			noteEl.setCssProps({ "--qnb-note-h": `${note.h}px` });
			noteEl.setCssProps({ "--qnb-note-x": `${note.x}px` });
			noteEl.setCssProps({ "--qnb-note-y": `${note.y}px` });
		};

		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			handle.removeClass("is-resizing");
			noteEl.removeClass("is-dragging");
			void this.plugin.saveNotes();
		};

		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}

	private startTitleEdit(titleEl: HTMLElement, note: QuickNote) {
		if (titleEl.querySelector("input")) return; // già in modifica

		const currentText = note.title;
		titleEl.empty();
		const input = titleEl.createEl("input", { cls: "qnb-note-title-input", attr: { type: "text" } });
		input.value = currentText;
		input.addEventListener("mousedown", (evt) => evt.stopPropagation());
		input.addEventListener("click", (evt) => evt.stopPropagation());

		const finish = async (save: boolean) => {
			const newTitle = save ? input.value.trim() || this.tr("view.note.untitled") : currentText;
			if (save && newTitle !== note.title) {
				note.title = newTitle;
				await this.plugin.saveNotes();
			}
			titleEl.empty();
			titleEl.setText(note.title);
		};

		input.addEventListener("blur", () => void finish(true));
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				input.blur();
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				void finish(false);
			}
		});

		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	}

	private setEditToggleIcon(btn: HTMLElement, isEditing: boolean) {
		btn.empty();
		setIcon(btn, isEditing ? "eye" : "pencil-line");
		btn.setAttribute("aria-label", isEditing ? this.tr("view.note.viewMode") : this.tr("view.note.editMode"));
	}

	private updateLockIcon(btn: HTMLElement, isEncrypted: boolean) {
		btn.empty();
		setIcon(btn, isEncrypted ? "unlock" : "lock");
		btn.setAttribute("aria-label", this.tr(isEncrypted ? "view.note.unlock" : "view.note.lock"));
		btn.toggleClass("qnb-note-action-active", isEncrypted);
	}

	private updatePinIcon(btn: HTMLElement, isPinned: boolean) {
		btn.empty();
		setIcon(btn, isPinned ? "pin-off" : "pin");
		btn.setAttribute("aria-label", this.tr(isPinned ? "view.note.unpin" : "view.note.pin"));
		btn.toggleClass("qnb-note-action-active", isPinned);
	}

	private updateFavoriteIcon(btn: HTMLElement, isFavorite: boolean) {
		btn.empty();
		setIcon(btn, "star");
		btn.setAttribute("aria-label", this.tr(isFavorite ? "view.note.unfavorite" : "view.note.favorite"));
		btn.toggleClass("qnb-note-action-active", isFavorite);
	}

	private updateAlarmIcon(btn: HTMLElement, hasDueDate: boolean) {
		btn.empty();
		setIcon(btn, "alarm-clock");
		btn.setAttribute("aria-label", this.tr(hasDueDate ? "view.note.editDueDate" : "view.note.setDueDate"));
		btn.toggleClass("qnb-note-action-active", hasDueDate);
	}

	private updateMaximizeIcon(btn: HTMLElement, isMaximized: boolean) {
		btn.empty();
		setIcon(btn, isMaximized ? "minimize-2" : "maximize-2");
		btn.setAttribute("aria-label", this.tr(isMaximized ? "view.note.restore" : "view.note.maximize"));
		btn.toggleClass("qnb-note-action-active", isMaximized);
	}

	/** Massimizza la nota (riempie tutta la board) o la riporta alla posizione e
	 * dimensione originali se è già quella massimizzata. Se un'altra nota era
	 * massimizzata, viene ripristinata automaticamente prima di massimizzare questa —
	 * mai due massimizzate insieme. Solo classi CSS: non tocca mai x/y/w/h salvati, né
	 * ricostruisce la board (non interrompe eventuali modifiche in corso altrove). */
	private toggleMaximizeNote(note: QuickNote, noteEl: HTMLElement, btn: HTMLElement) {
		const isCurrentlyMaximized = this.maximizedNoteId === note.id;
		this.plugin.playSound("note-maximize");

		if (this.maximizedNoteId && this.maximizedNoteId !== note.id) {
			const prevEl = this.noteElements.get(this.maximizedNoteId);
			if (prevEl) {
				prevEl.removeClass("qnb-note-maximized");
				const prevBtn = prevEl.querySelector<HTMLElement>(".qnb-maximize-btn");
				if (prevBtn) this.updateMaximizeIcon(prevBtn, false);
			}
		}

		if (isCurrentlyMaximized) {
			noteEl.removeClass("qnb-note-maximized");
			this.boardEl.removeClass("qnb-has-maximized-note");
			this.maximizedNoteId = null;
		} else {
			noteEl.addClass("qnb-note-maximized");
			this.boardEl.addClass("qnb-has-maximized-note");
			this.maximizedNoteId = note.id;
		}
		this.updateMaximizeIcon(btn, this.maximizedNoteId === note.id);
	}

	private renderNoteBodyPreview(bodyEl: HTMLElement, note: QuickNote, noteEl: HTMLElement, toggleBtn: HTMLElement) {
		this.setEditToggleIcon(toggleBtn, false);
		bodyEl.empty();
		bodyEl.removeClass("qnb-note-body-editing");

		if (note.encrypted) {
			// Non renderizzare mai il blob cifrato: è dato, non markdown da mostrare.
			bodyEl.createDiv({
				cls: "qnb-note-placeholder qnb-note-locked",
				text: this.plugin.settings.lockedNotePlaceholder || this.tr("view.note.lockedPlaceholder"),
			});
			return;
		}

		if (!note.content) {
			bodyEl.createDiv({ cls: "qnb-note-placeholder", text: this.tr("view.note.placeholder") });
			return;
		}
		const renderEl = bodyEl.createDiv({ cls: "qnb-note-rendered markdown-rendered" });
		void MarkdownRenderer.render(this.app, note.content, renderEl, "", this);

		// Link interni [[...]]: click per navigare, hover per l'anteprima (come nelle note normali).
		renderEl.addEventListener("click", (evt) => {
			const link = (evt.target as HTMLElement).closest("a.internal-link");
			if (link) {
				evt.preventDefault();
				evt.stopPropagation();
				const linktext = link.getAttribute("href") || link.getAttr("data-href") || "";
				if (linktext) void this.app.workspace.openLinkText(linktext, "", evt.ctrlKey || evt.metaKey);
				return;
			}

			// Collegamento a un'altra quick note della board: [Titolo](qnb://id).
			const qnbLink = (evt.target as HTMLElement).closest("a[href^='qnb://']");
			if (qnbLink) {
				evt.preventDefault();
				evt.stopPropagation();
				const targetId = (qnbLink.getAttribute("href") || "").replace("qnb://", "");
				if (targetId) this.navigateToQuickNote(targetId);
			}
		});
		renderEl.addEventListener("mouseover", (evt) => {
			const link = (evt.target as HTMLElement).closest("a.internal-link");
			if (!link) return;
			const linktext = link.getAttribute("href") || link.getAttr("data-href") || "";
			this.app.workspace.trigger("hover-link", {
				event: evt,
				source: "quick-notes-board",
				hoverParent: noteEl,
				targetEl: link,
				linktext,
			});
		});

		// Caselle di spunta "- [ ]": Obsidian le renderizza ma il click-per-spuntare
		// integrato scrive nel file reale sorgente, che qui non esiste. Le gestiamo
		// noi a mano: individuiamo le righe "checkbox" nel testo, nello stesso ordine
		// in cui compaiono a schermo, e aggiorniamo/salviamo il testo della nota.
		const taskLineIndices: number[] = [];
		note.content.split("\n").forEach((line, idx) => {
			if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(line)) taskLineIndices.push(idx);
		});

		const checkboxes = renderEl.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox");
		checkboxes.forEach((checkbox, domIndex) => {
			checkbox.removeAttribute("disabled");
			checkbox.setCssStyles({ cursor: "pointer" });
			const lineIndex = taskLineIndices[domIndex];
			if (lineIndex === undefined) return;
			checkbox.addEventListener("click", (evt) => {
				void (async () => {
					evt.stopPropagation(); // non deve aprire la modalità modifica
					note.content = toggleTaskLine(note.content, lineIndex);
					note.modifiedAt = Date.now();
					await this.plugin.saveNotes();
					// Ridisegna leggendo il testo aggiornato: è Obsidian stesso, durante il
					// render, ad applicare la barratura e lo stile "spuntato" corretti — il
					// solo toggle nativo della checkbox non lo farebbe scattare.
					this.renderNoteBodyPreview(bodyEl, note, noteEl, toggleBtn);
				})();
			});
		});

		// Immagini incorporate ![[...]]: una maniglia in basso a destra per ridimensionarle
		// col mouse. Solo per questo formato, perché è l'unico in cui Obsidian supporta
		// nativamente una larghezza salvata nel testo stesso (![[img|300]]); il markdown
		// puro ![testo](link) non ha un modo nativo equivalente, e non lo "inventiamo" di
		// nascosto riscrivendolo in HTML.
		const embedMatches = [...note.content.matchAll(/!\[\[([^\]|]+)(?:\|\d+)?\]\]/g)];
		const embedEls = renderEl.querySelectorAll(".internal-embed.image-embed, .internal-embed.media-embed");
		embedEls.forEach((embedEl, domIndex) => {
			const match = embedMatches[domIndex];
			const img = embedEl.querySelector("img");
			if (!match || !img) return;

			const wrapper = embedEl as HTMLElement;
			wrapper.addClass("qnb-image-embed-wrapper");

			const handle = wrapper.createDiv({ cls: "qnb-image-resize-handle" });
			handle.addEventListener("mousedown", (evt) => {
				evt.preventDefault();
				evt.stopPropagation(); // non deve aprire la modalità modifica

				const startX = evt.clientX;
				const startWidth = img.getBoundingClientRect().width;
				wrapper.addClass("is-resizing-image");

				const onMove = (moveEvt: MouseEvent) => {
					const dx = moveEvt.clientX - startX;
					const newWidth = Math.max(50, Math.round(startWidth + dx));
					img.setCssStyles({ width: `${newWidth}px` });
				};

				const onUp = () => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
					wrapper.removeClass("is-resizing-image");

					const finalWidth = Math.max(50, Math.round(img.getBoundingClientRect().width));
					const target = match[1];
					note.content = replaceEmbedAtIndex(note.content, domIndex, `![[${target}|${finalWidth}]]`);
					note.modifiedAt = Date.now();
					void this.plugin.saveNotes();
				};

				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			});
		});

		// Barra di avanzamento sotto ogni elenco di checkbox, solo se attivata.
		if (this.plugin.settings.checklistProgressBar) {
			insertChecklistProgressBars(
				renderEl,
				this.plugin.settings.checklistProgressBarColorStart,
				this.plugin.settings.checklistProgressBarColorEnd,
				this.plugin.settings.checklistProgressBarHeight,
				this.plugin.settings.checklistProgressBarCompleteColor,
				this.plugin.settings.checklistProgressBarCompleteText ||
					this.tr("view.checklistProgress.completeDefault"),
				this.plugin.settings.checklistProgressCompleteDelaySeconds
			);
		}

		// Evidenziazione della ricerca: ultimo passo, dopo che link/checkbox/immagini
		// sono già stati agganciati sugli elementi (non tocca in alcun modo la struttura,
		// solo il testo). Le note cifrate non vengono cercate nel contenuto (solo nel
		// titolo, gestito altrove), quindi non ha senso evidenziarne il segnaposto.
		if (this.searchQuery.trim() && !note.encrypted) {
			highlightTextInElement(renderEl, this.searchQuery.trim());
		}
	}

	/** Calcola l'offset di carattere (nel testo così come mostrato a schermo) corrispondente
	 * al punto cliccato, per posizionare il cursore esattamente lì quando si entra in
	 * modifica — invece che sempre alla fine del testo. Per note senza formattazione
	 * (il caso più comune) l'offset combacia esattamente col testo grezzo; con markdown nel
	 * mezzo (grassetto, link, ecc.) resta una buona approssimazione, non sempre perfetta,
	 * perché il testo reso a schermo e quello grezzo non coincidono sempre carattere per
	 * carattere. Ritorna null se il browser non supporta l'API necessaria, o il punto non
	 * cade su testo: in quel caso resta il comportamento di sempre (cursore a fine testo). */
	private getClickOffsetInRenderedBody(bodyEl: HTMLElement, clientX: number, clientY: number): number | null {
		// Cast passando per `unknown`, non per un'intersezione con `Document`: così la
		// proprietà si risolve solo su questo tipo locale, che non porta il tag
		// `@deprecated` di lib.dom.d.ts per caretRangeFromPoint (usata solo come fallback,
		// per i browser/Electron meno recenti che non hanno ancora l'API standard).
		const doc = document as unknown as {
			caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};

		let node: Node | null = null;
		let offsetInNode = 0;

		if (typeof doc.caretPositionFromPoint === "function") {
			const pos = doc.caretPositionFromPoint(clientX, clientY);
			if (!pos) return null;
			node = pos.offsetNode;
			offsetInNode = pos.offset;
		} else if (typeof doc.caretRangeFromPoint === "function") {
			const range = doc.caretRangeFromPoint(clientX, clientY);
			if (!range) return null;
			node = range.startContainer;
			offsetInNode = range.startOffset;
		} else {
			return null;
		}

		if (!node || !bodyEl.contains(node)) return null;

		const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT);
		let total = 0;
		let current = walker.nextNode();
		while (current) {
			if (current === node) {
				return total + offsetInNode;
			}
			total += (current.textContent || "").length;
			current = walker.nextNode();
		}
		return null;
	}

	/** Scorre la textarea in modo che la riga del cursore sia visibile (circa a metà
	 * dell'area visibile), invece di lasciare la vista dov'era prima — altrimenti il
	 * cursore, pur posizionato correttamente, potrebbe restare fuori dalla parte
	 * visibile se la nota ha più testo di quanto ne stia a schermo. */
	private scrollTextareaToOffset(textarea: HTMLTextAreaElement, offset: number) {
		const before = textarea.value.slice(0, offset);
		const lineNumber = (before.match(/\n/g) || []).length;

		const computed = window.getComputedStyle(textarea);
		let lineHeight = parseFloat(computed.lineHeight);
		if (!Number.isFinite(lineHeight)) {
			// "normal" non è un numero: stima ragionevole dalla dimensione del carattere.
			const fontSize = parseFloat(computed.fontSize) || 14;
			lineHeight = fontSize * 1.2;
		}

		const cursorY = lineNumber * lineHeight;
		const desiredScrollTop = cursorY - textarea.clientHeight / 2 + lineHeight / 2;
		textarea.scrollTop = Math.max(0, desiredScrollTop);
	}

	private enterEditMode(
		noteEl: HTMLElement,
		bodyEl: HTMLElement,
		note: QuickNote,
		toggleBtn: HTMLElement,
		clickOffset?: number
	) {
		if (bodyEl.querySelector("textarea")) return; // già in modifica
		if (note.encrypted) return; // rete di sicurezza: mai editare direttamente il blob cifrato

		this.setEditToggleIcon(toggleBtn, true);
		noteEl.addClass("is-editing");
		bodyEl.empty();
		bodyEl.addClass("qnb-note-body-editing");

		const textarea = bodyEl.createEl("textarea", { cls: "qnb-note-textarea" });
		textarea.value = note.content;
		textarea.addEventListener("mousedown", (evt) => evt.stopPropagation());

		const save = async () => {
			const newContent = textarea.value;
			noteEl.removeClass("is-editing");
			if (newContent !== note.content) {
				note.content = newContent;
				note.modifiedAt = Date.now();
				await this.plugin.saveNotes();
			}
			this.renderNoteBodyPreview(bodyEl, note, noteEl, toggleBtn);
		};

		const suggestEl = bodyEl.createDiv({ cls: "qnb-link-suggest" });
		suggestEl.setCssStyles({ display: "none" });

		const hideSuggestions = () => {
			suggestEl.setCssStyles({ display: "none" });
			suggestEl.empty();
		};

		const updateSuggestions = () => {
			const cursor = textarea.selectionStart;
			const upToCursor = textarea.value.slice(0, cursor);
			const openIdx = upToCursor.lastIndexOf("[[");
			if (openIdx === -1) return hideSuggestions();
			const between = upToCursor.slice(openIdx + 2);
			if (between.includes("]]") || between.includes("\n")) return hideSuggestions();

			const query = between.toLowerCase();

			// Note vere del vault (comportamento invariato rispetto a prima).
			const vaultMatches = this.app.vault
				.getMarkdownFiles()
				.filter((f) => f.basename.toLowerCase().includes(query))
				.slice(0, 5);

			// Quick note della stessa board (nuove): escluse cestino/archivio e la nota
			// che si sta scrivendo (non ha senso collegarla a se stessa).
			const quickMatches = this.plugin.notes
				.filter(
					(n) =>
						!n.deleted &&
						!n.archived &&
						n.id !== note.id &&
						n.title.toLowerCase().includes(query)
				)
				.slice(0, 5);

			type Suggestion =
				| { kind: "vault"; basename: string }
				| { kind: "quick"; id: string; title: string; category: string };

			const suggestions: Suggestion[] = [
				...vaultMatches.map((f): Suggestion => ({ kind: "vault", basename: f.basename })),
				...quickMatches.map((n): Suggestion => ({ kind: "quick", id: n.id, title: n.title, category: n.category })),
			].slice(0, 8);

			if (suggestions.length === 0) return hideSuggestions();

			suggestEl.empty();
			suggestEl.setCssStyles({ display: "block" });
			for (const suggestion of suggestions) {
				const item = suggestEl.createDiv({ cls: "qnb-link-suggest-item" });
				setIcon(
					item.createSpan({ cls: "qnb-link-suggest-icon" }),
					suggestion.kind === "vault" ? "file-text" : "layout-grid"
				);
				const textWrap = item.createSpan({ cls: "qnb-link-suggest-text" });
				if (suggestion.kind === "vault") {
					textWrap.setText(suggestion.basename);
				} else {
					textWrap.createSpan({ text: suggestion.title });
					textWrap.createSpan({ cls: "qnb-link-suggest-sublabel", text: suggestion.category });
				}

				item.addEventListener("mousedown", (evt) => {
					// Evita che il textarea perda il focus prima del click (altrimenti si
					// attiverebbe il salvataggio/rirendering prima dell'inserimento del link).
					evt.preventDefault();
				});
				item.addEventListener("click", () => {
					const before = textarea.value.slice(0, openIdx);
					const after = textarea.value.slice(cursor);
					const inserted =
						suggestion.kind === "vault"
							? `[[${suggestion.basename}]]`
							: `[${suggestion.title}](qnb://${suggestion.id})`;
					textarea.value = before + inserted + after;
					const newCursor = before.length + inserted.length;
					textarea.selectionStart = textarea.selectionEnd = newCursor;
					hideSuggestions();
					textarea.focus();
				});
			}
		};

		textarea.addEventListener("input", updateSuggestions);
		textarea.addEventListener("click", updateSuggestions);

		textarea.addEventListener("blur", () => {
			hideSuggestions();
			void save();
		});
		textarea.addEventListener("keydown", (evt) => {
			const mod = evt.ctrlKey || evt.metaKey;

			if (evt.key === "Escape") {
				evt.preventDefault();
				if (suggestEl.style.display !== "none") {
					hideSuggestions();
				} else {
					textarea.blur();
				}
				return;
			}

			// Scorciatoie in stile Obsidian: grassetto, corsivo, link.
			if (mod && evt.key.toLowerCase() === "b") {
				evt.preventDefault();
				wrapSelection(textarea, "**", "**");
				updateSuggestions();
			} else if (mod && evt.key.toLowerCase() === "i") {
				evt.preventDefault();
				wrapSelection(textarea, "_", "_");
				updateSuggestions();
			} else if (mod && evt.key.toLowerCase() === "k") {
				evt.preventDefault();
				wrapSelection(textarea, "[[", "]]");
				updateSuggestions();
			}
		});

		window.setTimeout(() => {
			textarea.focus();
			if (clickOffset !== undefined) {
				const clamped = Math.max(0, Math.min(clickOffset, textarea.value.length));
				textarea.setSelectionRange(clamped, clamped);
				this.scrollTextareaToOffset(textarea, clamped);
			}
		}, 0);
	}

	private startDrag(evt: MouseEvent, note: QuickNote, noteEl: HTMLElement) {
		// ignora click sui pulsanti azione (rinomina/elimina) o su un titolo in modifica
		if ((evt.target as HTMLElement).closest(".qnb-note-actions")) return;
		if ((evt.target as HTMLElement).closest(".qnb-note-title-input")) return;
		// Da massimizzata, la posizione è forzata via CSS: non trascinare, altrimenti si
		// modificherebbero x/y salvati senza che si veda alcun movimento reale.
		if (this.maximizedNoteId === note.id) return;

		// Ctrl/Cmd+click: aggiunge o toglie questa nota dalla selezione multipla, senza
		// avviare alcun trascinamento.
		if (evt.ctrlKey || evt.metaKey) {
			evt.preventDefault();
			evt.stopPropagation();
			if (this.selectedNoteIds.has(note.id)) this.selectedNoteIds.delete(note.id);
			else this.selectedNoteIds.add(note.id);
			this.applySelectionVisuals();
			return;
		}

		// Trascinare una nota che non fa parte della selezione attuale esce dalla
		// modalità di selezione multipla: il click "prende il comando" da solo, come ci
		// si aspetta normalmente.
		const isGroupDrag = this.selectedNoteIds.has(note.id) && this.selectedNoteIds.size > 1;
		if (!isGroupDrag && this.selectedNoteIds.size > 0) {
			this.selectedNoteIds.clear();
			this.applySelectionVisuals();
		}

		evt.preventDefault();

		const groupExtras: { note: QuickNote; el: HTMLElement; origX: number; origY: number }[] = [];
		if (isGroupDrag) {
			for (const id of this.selectedNoteIds) {
				if (id === note.id) continue;
				const extraNote = this.plugin.notes.find((n) => n.id === id);
				const extraEl = this.noteElements.get(id);
				if (extraNote && extraEl) {
					groupExtras.push({ note: extraNote, el: extraEl, origX: extraNote.x, origY: extraNote.y });
				}
			}
		}

		this.dragState = {
			note,
			el: noteEl,
			startX: evt.clientX,
			startY: evt.clientY,
			origX: note.x,
			origY: note.y,
			groupExtras,
		};
		noteEl.addClass("is-dragging");
		for (const extra of groupExtras) extra.el.addClass("is-dragging");

		const onMove = (moveEvt: MouseEvent) => {
			if (!this.dragState) return;
			const dx = moveEvt.clientX - this.dragState.startX;
			const dy = moveEvt.clientY - this.dragState.startY;

			const newX = Math.max(0, this.dragState.origX + dx);
			const newY = Math.max(0, this.dragState.origY + dy);
			this.dragState.note.x = newX;
			this.dragState.note.y = newY;
			// Stessa variabile CSS usata dal ridimensionamento e dal render iniziale (non
			// left/top diretti): altrimenti un valore scritto direttamente qui resterebbe
			// "bloccato" e vincerebbe sempre sulla regola CSS basata sulla variabile,
			// impedendo al bordo sinistro di muoversi durante un ridimensionamento
			// successivo a uno spostamento.
			this.dragState.el.setCssProps({ "--qnb-note-x": `${newX}px` });
			this.dragState.el.setCssProps({ "--qnb-note-y": `${newY}px` });

			// Trascinamento di gruppo: stessa quantità di spostamento per tutte le altre
			// note selezionate, ognuna dalla propria posizione di partenza.
			for (const extra of this.dragState.groupExtras) {
				const exX = Math.max(0, extra.origX + dx);
				const exY = Math.max(0, extra.origY + dy);
				extra.note.x = exX;
				extra.note.y = exY;
				extra.el.setCssProps({ "--qnb-note-x": `${exX}px` });
				extra.el.setCssProps({ "--qnb-note-y": `${exY}px` });
			}
		};

		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			noteEl.removeClass("is-dragging");
			for (const extra of this.dragState?.groupExtras ?? []) extra.el.removeClass("is-dragging");

			if (this.plugin.settings.dragSettleAnimation) {
				const settledEls = [noteEl, ...(this.dragState?.groupExtras ?? []).map((extra) => extra.el)];
				for (const el of settledEls) this.playSettleAnimation(el);
			}

			if (this.dragState) {
				void this.plugin.saveNotes();
			}
			this.dragState = null;
		};

		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}

	/** Riproduce il piccolo "assestamento elastico" su una nota appena rilasciata dal
	 * trascinamento: aggiunge la classe che avvia l'animazione CSS e la toglie da sola
	 * alla fine (con un timeout di riserva, nel caso l'evento non scattasse). */
	private playSettleAnimation(el: HTMLElement) {
		el.removeClass("qnb-note-settle");
		// Forza un reflow prima di riaggiungere la classe, così l'animazione riparte anche
		// se la nota era già stata rilasciata pochissimo tempo prima.
		void el.offsetWidth;
		el.addClass("qnb-note-settle");

		const onEnd = () => {
			el.removeClass("qnb-note-settle");
			el.removeEventListener("animationend", onEnd);
		};
		el.addEventListener("animationend", onEnd);
		window.setTimeout(() => el.removeClass("qnb-note-settle"), 500);
	}
}

/** Sostituisce i caratteri non ammessi nei nomi file (Windows e altri OS) con un trattino. */
function sanitizeFileName(name: string): string {
	const cleaned = name.replace(/[\\/:*?"<>|]/g, "-").trim();
	return cleaned || "Nota senza titolo";
}

function cryptoRandomId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Avvolge il testo selezionato in un textarea con prefix/suffix (es. **grassetto**); senza selezione, inserisce i marcatori e posiziona il cursore in mezzo. */
function wrapSelection(textarea: HTMLTextAreaElement, prefix: string, suffix: string) {
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const value = textarea.value;
	const selected = value.slice(start, end);

	textarea.value = value.slice(0, start) + prefix + selected + suffix + value.slice(end);

	if (selected) {
		textarea.selectionStart = start + prefix.length;
		textarea.selectionEnd = start + prefix.length + selected.length;
	} else {
		const cursor = start + prefix.length;
		textarea.selectionStart = textarea.selectionEnd = cursor;
	}
}

/** Ritorna "#111111" o "#ffffff" a seconda di quale contrasta meglio col colore di sfondo dato (hex). */

/** Inverte lo stato "[ ]"/"[x]" di una singola riga di testo (usato per le checkbox delle note). */
/** Sostituisce solo l'occorrenza N-esima (per ordine di comparsa) di un embed
 * "![[...]]" nel testo — necessario perché la stessa immagine potrebbe comparire
 * più volte nella stessa nota, e vogliamo ridimensionare solo quella toccata. */
/** Evidenzia, dentro un elemento già renderizzato, ogni comparsa (case-insensitive) del
 * testo cercato — solo nei nodi di testo, senza toccare la struttura HTML circostante
 * (link, grassetto, tabelle, ecc. restano intatti). Esclude deliberatamente i tooltip
 * SVG (usati dalla maniglia di ridimensionamento immagini): un <mark> al loro interno
 * non sarebbe testo valido per un elemento <title>. */
/** Inserisce una barra di avanzamento subito dopo ogni elenco di checkbox già
 * renderizzato (Obsidian separa da solo elenchi diversi quando c'è una riga vuota nel
 * markdown, quindi non serve alcuna logica di raggruppamento: basta cercare ogni
 * <ul>/<ol> con checkbox e contare quelle dirette al suo interno). Conta solo le
 * checkbox dirette di ogni elenco (non quelle di eventuali sotto-elenchi annidati), così
 * un elenco annidato riceve una propria barra separata invece di essere conteggiato due
 * volte. */
function insertChecklistProgressBars(
	renderEl: HTMLElement,
	colorStart: string,
	colorEnd: string,
	heightPx: number,
	completeColor: string,
	completeText: string,
	completeDelaySeconds: number
) {
	const lists = renderEl.querySelectorAll("ul.contains-task-list, ol.contains-task-list");
	lists.forEach((list) => {
		const checkboxes = list.querySelectorAll(':scope > li > input[type="checkbox"]');
		if (checkboxes.length === 0) return;

		let checked = 0;
		checkboxes.forEach((cb) => {
			if ((cb as HTMLInputElement).checked) checked++;
		});
		const total = checkboxes.length;
		const percent = Math.round((checked / total) * 100);
		const isComplete = checked === total;

		const bar = createDiv({ cls: "qnb-checklist-progress" });

		const track = bar.createDiv({ cls: "qnb-checklist-progress-track" });
		track.setCssStyles({ height: `${heightPx}px` });
		track.setCssProps({ "--qnb-checklist-progress-start": colorStart });
		track.setCssProps({ "--qnb-checklist-progress-end": colorEnd });

		const fill = track.createDiv({ cls: "qnb-checklist-progress-fill" });
		fill.setCssStyles({ width: `${percent}%` });

		// Etichetta dentro la barra, centrata sull'intera larghezza (non solo sulla
		// parte riempita), così resta sempre leggibile e al centro qualunque percentuale.
		const label = track.createSpan({
			cls: "qnb-checklist-progress-label",
			text: `${checked}/${total} — ${percent}%`,
		});

		if (isComplete) {
			// Non passa subito al colore/testo "completo": mostra prima normalmente il
			// 100% raggiunto, e solo dopo i secondi configurati sostituisce colore e
			// testo — altrimenti il cambio è troppo brusco, come segnalato.
			const applyCompleteState = () => {
				fill.setCssStyles({ background: completeColor });
				label.textContent = completeText;
			};
			if (completeDelaySeconds > 0) {
				window.setTimeout(applyCompleteState, completeDelaySeconds * 1000);
			} else {
				applyCompleteState();
			}
		}

		list.insertAdjacentElement("afterend", bar);
	});
}

function highlightTextInElement(root: HTMLElement, query: string) {
	if (!query) return;
	const q = query.toLowerCase();

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const parentTag = node.parentElement?.tagName.toLowerCase();
			if (parentTag === "title" || parentTag === "script" || parentTag === "style") {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	const textNodes: Text[] = [];
	let current: Node | null;
	while ((current = walker.nextNode())) {
		textNodes.push(current as Text);
	}

	for (const textNode of textNodes) {
		const value = textNode.textContent || "";
		const lower = value.toLowerCase();
		if (!lower.includes(q)) continue;

		const frag = createFragment();
		let lastIndex = 0;
		let idx = lower.indexOf(q);
		while (idx !== -1) {
			if (idx > lastIndex) frag.appendChild(document.createTextNode(value.slice(lastIndex, idx)));
			frag.createEl("mark", {
				cls: "qnb-search-highlight",
				text: value.slice(idx, idx + q.length),
			});
			lastIndex = idx + q.length;
			idx = lower.indexOf(q, lastIndex);
		}
		if (lastIndex < value.length) frag.appendChild(document.createTextNode(value.slice(lastIndex)));
		textNode.replaceWith(frag);
	}
}

function replaceEmbedAtIndex(content: string, index: number, replacement: string): string {
	const re = /!\[\[([^\]|]+)(?:\|\d+)?\]\]/g;
	let count = 0;
	return content.replace(re, (match) => (count++ === index ? replacement : match));
}

function toggleTaskLine(content: string, lineIndex: number): string {
	const lines = content.split("\n");
	if (lineIndex < 0 || lineIndex >= lines.length) return content;

	const line = lines[lineIndex];
	const match = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/);
	if (!match) return content;

	const newMark = match[2].trim() === "" ? "x" : " ";
	lines[lineIndex] = `${match[1]}${newMark}${match[3]}`;
	return lines.join("\n");
}

