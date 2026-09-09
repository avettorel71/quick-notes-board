import { App, PluginSettingTab, Setting, Notice, ButtonComponent, ColorComponent, TextComponent, setIcon } from "obsidian";
import type QuickNotesBoardPlugin from "./main";
import { t, QnbLang } from "./i18n";

export type QnbBackgroundMode = "none" | "image" | "color";
export type { QnbLang };

/** Un gruppo può contenere altri gruppi identici a sé stesso (sottogruppi), fino a
 * MAX_GROUP_DEPTH livelli complessivi sotto la categoria. L'id è stabile: le note
 * si riferiscono a un gruppo per id, non per nome, così rinominarlo non "perde" le note. */
export interface QnbGroup {
	id: string;
	name: string;
	groups: QnbGroup[];
}

/** Un'etichetta: elenco piatto definito in Impostazioni, assegnabile liberamente (più di
 * una insieme) a qualunque quick note, a prescindere da categoria/gruppo/sottogruppo. */
export interface QnbLabel {
	id: string;
	name: string;
	color: string;
}

export const MAX_GROUP_DEPTH = 5;

export interface QnbCategory {
	name: string;
	color: string;
	/** Colore esplicito per il testo del titolo delle note di questa categoria; stringa vuota = automatico (contrasto calcolato sul colore di sfondo, comportamento di default). */
	titleColor: string;
	/** Id icona (Lucide) mostrata prima del titolo delle note di questa categoria; stringa vuota = nessuna icona. */
	icon: string;
	/** Colore esplicito per l'icona; stringa vuota = automatico (stesso contrasto del titolo). */
	iconColor: string;
	/** Gruppi definiti dentro questa categoria: stesso colore/icona della categoria, nessuno proprio. */
	groups: QnbGroup[];
}

export const CATEGORY_ICON_OPTIONS: { value: string; labelKey: string }[] = [
	{ value: "", labelKey: "settings.categories.icon.none" },
	{ value: "star", labelKey: "settings.categories.icon.star" },
	{ value: "flag", labelKey: "settings.categories.icon.flag" },
	{ value: "briefcase", labelKey: "settings.categories.icon.briefcase" },
	{ value: "home", labelKey: "settings.categories.icon.home" },
	{ value: "heart", labelKey: "settings.categories.icon.heart" },
	{ value: "bookmark", labelKey: "settings.categories.icon.bookmark" },
	{ value: "folder", labelKey: "settings.categories.icon.folder" },
	{ value: "alert-circle", labelKey: "settings.categories.icon.alertCircle" },
	{ value: "check-circle", labelKey: "settings.categories.icon.checkCircle" },
	{ value: "calendar", labelKey: "settings.categories.icon.calendar" },
	{ value: "clock", labelKey: "settings.categories.icon.clock" },
	{ value: "user", labelKey: "settings.categories.icon.user" },
	{ value: "users", labelKey: "settings.categories.icon.users" },
	{ value: "book-open", labelKey: "settings.categories.icon.book" },
	{ value: "coffee", labelKey: "settings.categories.icon.coffee" },
	{ value: "zap", labelKey: "settings.categories.icon.zap" },
	{ value: "target", labelKey: "settings.categories.icon.target" },
	{ value: "pin", labelKey: "settings.categories.icon.pin" },
	{ value: "lightbulb", labelKey: "settings.categories.icon.lightbulb" },
	{ value: "graduation-cap", labelKey: "settings.categories.icon.graduationCap" },
	{ value: "shopping-cart", labelKey: "settings.categories.icon.shoppingCart" },
	{ value: "dollar-sign", labelKey: "settings.categories.icon.dollarSign" },
	{ value: "phone", labelKey: "settings.categories.icon.phone" },
];

/** Id di un evento sonoro configurabile. Aggiungerne uno nuovo = una riga in SOUND_EVENT_GROUPS
 * + una chiamata a plugin.playSound(id) nel punto giusto: nessun'altra modifica strutturale serve. */
export type QnbSoundEventId =
	| "board-open"
	| "note-rename"
	| "note-category"
	| "note-fontsize"
	| "note-toggle-view"
	| "note-minimize"
	| "note-archive"
	| "note-pin"
	| "note-labels"
	| "note-maximize"
	| "note-convert"
	| "note-favorite"
	| "note-qnb-link-navigate"
	| "note-due-reminder"
	| "note-due-date-open"
	| "note-lock"
	| "note-unlock"
	| "note-unlock-fail"
	| "note-delete"
	| "toolbar-new-note"
	| "toolbar-category-toggle"
	| "toolbar-label-filter-toggle"
	| "toolbar-toggle-all"
	| "toolbar-archive"
	| "toolbar-tidy-up"
	| "toolbar-board-info"
	| "toolbar-favorite-recall"
	| "toolbar-board-activity"
	| "toolbar-alarm-list"
	| "toolbar-note-explorer"
	| "toolbar-board-structure"
	| "toolbar-trash"
	| "toolbar-close"
	| "dialog-new-note"
	| "dialog-change-category"
	| "dialog-font-size"
	| "dialog-archive"
	| "dialog-trash"
	| "dialog-lock"
	| "dialog-unlock"
	| "dialog-note-info"
	| "dialog-category-stats"
	| "dialog-board-info"
	| "dialog-board-activity"
	| "dialog-alarm-list"
	| "dialog-note-explorer"
	| "dialog-label-assign"
	| "dialog-board-structure"
	| "dialog-new-note-confirm"
	| "dialog-change-category-confirm"
	| "dialog-font-size-close"
	| "archive-restore"
	| "archive-send-to-trash"
	| "trash-restore"
	| "trash-delete-forever"
	| "trash-empty";

export const SOUND_EVENT_GROUPS: {
	headingKey: string;
	events: { id: QnbSoundEventId; labelKey: string }[];
}[] = [
	{
		headingKey: "settings.sounds.group.note",
		events: [
			{ id: "note-rename", labelKey: "settings.sounds.event.noteRename" },
			{ id: "note-category", labelKey: "settings.sounds.event.noteCategory" },
			{ id: "note-fontsize", labelKey: "settings.sounds.event.noteFontSize" },
			{ id: "note-toggle-view", labelKey: "settings.sounds.event.noteToggleView" },
			{ id: "note-minimize", labelKey: "settings.sounds.event.noteMinimize" },
			{ id: "note-archive", labelKey: "settings.sounds.event.noteArchive" },
			{ id: "note-pin", labelKey: "settings.sounds.event.notePin" },
			{ id: "note-labels", labelKey: "settings.sounds.event.noteLabels" },
			{ id: "note-maximize", labelKey: "settings.sounds.event.noteMaximize" },
			{ id: "note-convert", labelKey: "settings.sounds.event.noteConvert" },
			{ id: "note-favorite", labelKey: "settings.sounds.event.noteFavorite" },
			{ id: "note-qnb-link-navigate", labelKey: "settings.sounds.event.noteQnbLinkNavigate" },
			{ id: "note-due-reminder", labelKey: "settings.sounds.event.noteDueReminder" },
			{ id: "note-due-date-open", labelKey: "settings.sounds.event.noteDueDateOpen" },
			{ id: "note-lock", labelKey: "settings.sounds.event.noteLock" },
			{ id: "note-unlock", labelKey: "settings.sounds.event.noteUnlock" },
			{ id: "note-unlock-fail", labelKey: "settings.sounds.event.noteUnlockFail" },
			{ id: "note-delete", labelKey: "settings.sounds.event.noteDelete" },
		],
	},
	{
		headingKey: "settings.sounds.group.toolbar",
		events: [
			{ id: "board-open", labelKey: "settings.sounds.event.boardOpen" },
			{ id: "toolbar-new-note", labelKey: "settings.sounds.event.toolbarNewNote" },
			{ id: "toolbar-category-toggle", labelKey: "settings.sounds.event.toolbarCategoryToggle" },
			{ id: "toolbar-label-filter-toggle", labelKey: "settings.sounds.event.toolbarLabelFilterToggle" },
			{ id: "toolbar-toggle-all", labelKey: "settings.sounds.event.toolbarToggleAll" },
			{ id: "toolbar-archive", labelKey: "settings.sounds.event.toolbarArchive" },
			{ id: "toolbar-tidy-up", labelKey: "settings.sounds.event.toolbarTidyUp" },
			{ id: "toolbar-board-info", labelKey: "settings.sounds.event.toolbarBoardInfo" },
			{ id: "toolbar-favorite-recall", labelKey: "settings.sounds.event.toolbarFavoriteRecall" },
			{ id: "toolbar-board-activity", labelKey: "settings.sounds.event.toolbarBoardActivity" },
			{ id: "toolbar-alarm-list", labelKey: "settings.sounds.event.toolbarAlarmList" },
			{ id: "toolbar-note-explorer", labelKey: "settings.sounds.event.toolbarNoteExplorer" },
			{ id: "toolbar-board-structure", labelKey: "settings.sounds.event.toolbarBoardStructure" },
			{ id: "toolbar-trash", labelKey: "settings.sounds.event.toolbarTrash" },
			{ id: "toolbar-close", labelKey: "settings.sounds.event.toolbarClose" },
		],
	},
	{
		headingKey: "settings.sounds.group.dialogs",
		events: [
			{ id: "dialog-new-note", labelKey: "settings.sounds.event.dialogNewNote" },
			{ id: "dialog-change-category", labelKey: "settings.sounds.event.dialogChangeCategory" },
			{ id: "dialog-font-size", labelKey: "settings.sounds.event.dialogFontSize" },
			{ id: "dialog-archive", labelKey: "settings.sounds.event.dialogArchive" },
			{ id: "dialog-trash", labelKey: "settings.sounds.event.dialogTrash" },
			{ id: "dialog-lock", labelKey: "settings.sounds.event.dialogLock" },
			{ id: "dialog-unlock", labelKey: "settings.sounds.event.dialogUnlock" },
			{ id: "dialog-note-info", labelKey: "settings.sounds.event.dialogNoteInfo" },
			{ id: "dialog-category-stats", labelKey: "settings.sounds.event.dialogCategoryStats" },
			{ id: "dialog-board-info", labelKey: "settings.sounds.event.dialogBoardInfo" },
			{ id: "dialog-board-activity", labelKey: "settings.sounds.event.dialogBoardActivity" },
			{ id: "dialog-alarm-list", labelKey: "settings.sounds.event.dialogAlarmList" },
			{ id: "dialog-note-explorer", labelKey: "settings.sounds.event.dialogNoteExplorer" },
			{ id: "dialog-label-assign", labelKey: "settings.sounds.event.dialogLabelAssign" },
			{ id: "dialog-board-structure", labelKey: "settings.sounds.event.dialogBoardStructure" },
		],
	},
	{
		headingKey: "settings.sounds.group.actions",
		events: [
			{ id: "dialog-new-note-confirm", labelKey: "settings.sounds.event.dialogNewNoteConfirm" },
			{ id: "dialog-change-category-confirm", labelKey: "settings.sounds.event.dialogChangeCategoryConfirm" },
			{ id: "dialog-font-size-close", labelKey: "settings.sounds.event.dialogFontSizeClose" },
			{ id: "archive-restore", labelKey: "settings.sounds.event.archiveRestore" },
			{ id: "archive-send-to-trash", labelKey: "settings.sounds.event.archiveSendToTrash" },
			{ id: "trash-restore", labelKey: "settings.sounds.event.trashRestore" },
			{ id: "trash-delete-forever", labelKey: "settings.sounds.event.trashDeleteForever" },
			{ id: "trash-empty", labelKey: "settings.sounds.event.trashEmpty" },
		],
	},
];

/** Le 12 icone azione della nota che si possono riordinare/nascondere a piacere
 * (Chiudi/X resta sempre fissa, non fa parte di questo elenco). */
export type QnbNoteIconId =
	| "rename"
	| "category"
	| "fontSize"
	| "toggleView"
	| "archive"
	| "convert"
	| "lock"
	| "delete"
	| "favorite"
	| "alarm"
	| "maximize"
	| "pin"
	| "labels";

export interface QnbNoteIconConfig {
	id: QnbNoteIconId;
	visible: boolean;
}

/** Ordine di default: identico a come sono sempre state disposte finora, tutte visibili. */
export const DEFAULT_NOTE_ICON_ORDER: QnbNoteIconConfig[] = [
	{ id: "rename", visible: true },
	{ id: "category", visible: true },
	{ id: "fontSize", visible: true },
	{ id: "toggleView", visible: true },
	{ id: "archive", visible: true },
	{ id: "convert", visible: true },
	{ id: "lock", visible: true },
	{ id: "delete", visible: true },
	{ id: "favorite", visible: true },
	{ id: "alarm", visible: true },
	{ id: "maximize", visible: true },
	{ id: "pin", visible: true },
	{ id: "labels", visible: true },
];

export interface QuickNotesBoardSettings {
	language: QnbLang;
	fullscreenMode: boolean; // se true, apre la board a schermo intero chiudendo i pannelli laterali
	collapseNoteIcons: boolean; // se true, le icone azione della nota si vedono solo al passaggio del mouse
	/** Se true, la nota fa un piccolo "assestamento elastico" quando la rilasci dopo averla trascinata. */
	dragSettleAnimation: boolean;
	/** Se true, la nota si solleva leggermente (con ombra più ampia) al passaggio del mouse. */
	hoverLiftEffect: boolean;
	/** Durata (secondi) del sollevamento prima di tornare normale da solo, anche se il
	 * mouse resta sopra: 0 = nessun limite (resta sollevata finché il mouse c'è sopra). */
	hoverLiftDurationSeconds: number;
	/** Se true, mostra una barra di avanzamento sotto ogni elenco di checkbox della nota. */
	checklistProgressBar: boolean;
	/** Colori iniziale/finale dello sfumato della barra. */
	checklistProgressBarColorStart: string;
	checklistProgressBarColorEnd: string;
	/** Spessore (px) della barra. */
	checklistProgressBarHeight: number;
	/** Testo mostrato al centro quando tutti i task sono completi; vuoto = testo predefinito tradotto. */
	checklistProgressBarCompleteText: string;
	/** Colore della barra quando risulta completa (sostituisce lo sfumato). */
	checklistProgressBarCompleteColor: string;
	/** Secondi di attesa, dopo aver raggiunto il 100%, prima di mostrare colore e testo
	 * "completo" al posto del conteggio: 0 = passaggio immediato. */
	checklistProgressCompleteDelaySeconds: number;
	/** Se true, il singolo click sul testo della nota non fa nulla: serve il doppio click
	 * (o l'icona dedicata) per entrare in modifica. */
	requireDoubleClickToEdit: boolean;
	/** Se true, il file dati viene salvato compresso su disco (riconosciuto in automatico
	 * alla lettura tramite un'etichetta all'inizio del file, indipendentemente da questa
	 * impostazione: cambiarla non rischia mai di leggere male un file già esistente). */
	compressionEnabled: boolean;
	/** Elenco piatto delle etichette definite, in ordine di visualizzazione. */
	labels: QnbLabel[];
	/** Ordine e visibilità delle 12 icone azione riordinabili della nota. */
	noteIconOrder: QnbNoteIconConfig[];
	/** Colore del bordo lampeggiante mostrato quando una nota è in avviso di scadenza. */
	dueDateBorderColor: string;
	/** Se true, tutte le note hanno sempre un'ombra più marcata (non solo al passaggio del mouse). */
	alwaysOnNoteShadow: boolean;
	/** Intensità dell'ombra permanente, 0-100. */
	noteShadowIntensity: number;
	/** Colore delle barre "note create"; vuoto = colore di accento del tema. */
	activityChartNotesColor: string;
	/** Colore delle barre "caratteri scritti"; vuoto = verde predefinito. */
	activityChartCharsColor: string;
	/** Dimensione (px) della finestra "Andamento della board", ricordata dall'ultimo
	 * ridimensionamento manuale dell'utente. */
	activityChartWindowWidth: number;
	activityChartWindowHeight: number;
	boardStructureWindowWidth: number;
	boardStructureWindowHeight: number;
	/** Cartella del vault dove creare i file quando si trasforma una quick note in nota vera; vuota = radice del vault. */
	convertedNotesFolder: string;
	/** Larghezza e altezza (px) assegnate a una nota appena creata. */
	defaultNoteWidth: number;
	defaultNoteHeight: number;
	/** Messaggio mostrato al posto del contenuto di una nota cifrata; vuoto = usa quello predefinito del plugin. */
	lockedNotePlaceholder: string;
	/** Se true, mostra la stellina "preferito" sulle note e la riga dedicata in toolbar. */
	useFavorites: boolean;
	/** Se true, i "chip" dei preferiti mostrano il titolo per intero (nessun taglio/puntini). */
	favoriteChipFullTitle: boolean;
	backgroundMode: QnbBackgroundMode;
	backgroundFileName: string; // nome del file immagine dentro la cartella del plugin, vuoto = nessuno
	backgroundDim: number; // 0-80: percentuale di oscuramento sopra l'immagine, per leggibilità
	backgroundSize: "cover" | "contain" | "repeat";
	backgroundColor: string; // hex, usato quando backgroundMode === "color"
	categories: QnbCategory[]; // censimento categorie note veloci: nome + colore associato
	/** id evento -> nome file audio dentro la cartella del plugin. Assente/vuoto = nessun suono per quell'evento. */
	soundFiles: Record<string, string>;
}

export const DEFAULT_SETTINGS: QuickNotesBoardSettings = {
	language: "it",
	fullscreenMode: false,
	collapseNoteIcons: false,
	dragSettleAnimation: false,
	hoverLiftEffect: false,
	hoverLiftDurationSeconds: 2,
	checklistProgressBar: false,
	checklistProgressBarColorStart: "#7c5cff",
	checklistProgressBarColorEnd: "#4facfe",
	checklistProgressBarHeight: 22,
	checklistProgressBarCompleteText: "",
	checklistProgressBarCompleteColor: "#4caf50",
	checklistProgressCompleteDelaySeconds: 1.5,
	requireDoubleClickToEdit: false,
	compressionEnabled: false,
	labels: [],
	noteIconOrder: DEFAULT_NOTE_ICON_ORDER.map((cfg) => ({ ...cfg })),
	dueDateBorderColor: "#ff5252",
	alwaysOnNoteShadow: false,
	noteShadowIntensity: 40,
	activityChartNotesColor: "",
	activityChartCharsColor: "",
	activityChartWindowWidth: 1200,
	activityChartWindowHeight: 640,
	boardStructureWindowWidth: 1000,
	boardStructureWindowHeight: 600,
	convertedNotesFolder: "",
	defaultNoteWidth: 520,
	defaultNoteHeight: 200,
	lockedNotePlaceholder: "",
	useFavorites: false,
	favoriteChipFullTitle: false,
	backgroundMode: "none",
	backgroundFileName: "",
	backgroundDim: 0,
	backgroundSize: "cover",
	backgroundColor: "#2d2d34",
	categories: [{ name: "Generale", color: "#3f3f46", titleColor: "", icon: "", iconColor: "", groups: [] }],
	soundFiles: {},
};

export const ACCEPTED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];
export const ACCEPTED_SOUND_EXTENSIONS = ["mp3", "wav", "ogg", "m4a"];

const COLOR_PALETTE = [
	"#2d2d34", "#1e293b", "#0f172a", "#3f3f46",
	"#4b3b2a", "#2f4030", "#1f3a3d", "#3a2a44",
	"#5c1f1f", "#5c4400", "#1f4d2e", "#1f3d5c",
	"#e5e5e5", "#d6c9b8", "#f5deb3", "#ffffff",
];

interface ElectronOpenDialogResult {
	canceled: boolean;
	filePaths: string[];
}
interface ElectronDialog {
	showOpenDialog: (options: {
		title: string;
		properties: string[];
		filters: { name: string; extensions: string[] }[];
	}) => Promise<ElectronOpenDialogResult>;
}
interface ElectronModule {
	remote?: { dialog?: ElectronDialog };
	dialog?: ElectronDialog;
}
/** Solo le proprietà che leggiamo davvero da un Buffer Node, per non dipendere dai tipi
 * di @types/node (il resto del progetto non ne ha bisogno). */
interface NodeBufferLike {
	buffer: ArrayBufferLike;
	byteOffset: number;
	byteLength: number;
}
interface NodeFsModule {
	readFileSync: (path: string) => NodeBufferLike;
}

export class QuickNotesBoardSettingTab extends PluginSettingTab {
	plugin: QuickNotesBoardPlugin;
	private pendingCategoryName = "";
	private draggedCategoryIndex: number | null = null;
	private draggedGroupId: string | null = null;
	private draggedGroupSiblings: QnbGroup[] | null = null;
	private draggedNoteIconId: QnbNoteIconId | null = null;
	/** Nomi delle categorie attualmente compresse (solo mentre il pannello resta aperto). */
	private collapsedCategories: Set<string> = new Set();
	private pendingCategoryColor: string = COLOR_PALETTE[0];

	constructor(app: App, plugin: QuickNotesBoardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.plugin.settings.language, key, vars);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName(this.tr("settings.title")).setHeading();

		new Setting(containerEl)
			.setName(this.tr("settings.language.name"))
			.setDesc(this.tr("settings.language.desc"))
			.addDropdown((dd) =>
				dd
					.addOption("it", this.tr("settings.language.it"))
					.addOption("en", this.tr("settings.language.en"))
					.setValue(this.plugin.settings.language)
					.onChange(async (value: string) => {
						await this.plugin.setLanguage(value as QnbLang);
						this.display();
					})
			);

		new Setting(containerEl)
			.setName(this.tr("settings.fullscreen.name"))
			.setDesc(this.tr("settings.fullscreen.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.fullscreenMode).onChange(async (value) => {
					await this.plugin.setFullscreenMode(value);
				})
			);

		new Setting(containerEl)
			.setName(this.tr("settings.collapseIcons.name"))
			.setDesc(this.tr("settings.collapseIcons.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.collapseNoteIcons).onChange(async (value) => {
					await this.plugin.setCollapseNoteIcons(value);
				})
			);

		new Setting(containerEl).setName(this.tr("settings.noteIconOrder.heading")).setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: this.tr("settings.noteIconOrder.intro"),
		});
		this.buildNoteIconOrderList(containerEl);

		new Setting(containerEl).setName(this.tr("settings.labels.heading")).setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: this.tr("settings.labels.intro"),
		});
		this.buildLabelsList(containerEl);

		this.buildSimpleSettings(containerEl);
		this.buildHoverLiftSection(containerEl);
		this.buildChecklistProgressSection(containerEl);
		this.buildShadowSection(containerEl);

		new Setting(containerEl).setName(this.tr("settings.activityChart.heading")).setHeading();
		this.buildActivityChartColors(containerEl);
		this.buildFavoritesSection(containerEl);
		this.buildConvertFolderSetting(containerEl);
		this.buildDefaultNoteSizeSetting(containerEl);
		this.buildLockedPlaceholderSetting(containerEl);

		this.buildCategoriesSection(containerEl);
		this.buildSoundsSection(containerEl);
		this.buildBackgroundSection(containerEl);
	}

	/** Obsidian 1.13+: rende le impostazioni ricercabili nella ricerca globale delle Impostazioni
	 * e sostituisce display() (che resta comunque sopra, invariato, per Obsidian < 1.13 — vedi
	 * Path B della guida ufficiale alla migrazione). Le sezioni semplici sono righe dichiarative
	 * dirette; quelle complesse (liste trascinabili, alberi di categorie) delegano con un
	 * `render` alla stessa identica logica già usata da display(), così le due implementazioni
	 * restano una singola fonte di verità invece di doversi mantenere sincronizzate a mano. */
	getSettingDefinitions() {
		return [
			{
				name: this.tr("settings.language.name"),
				desc: this.tr("settings.language.desc"),
				render: (setting: Setting) => {
					setting.addDropdown((dd) =>
						dd
							.addOption("it", this.tr("settings.language.it"))
							.addOption("en", this.tr("settings.language.en"))
							.setValue(this.plugin.settings.language)
							.onChange(async (value: string) => {
								await this.plugin.setLanguage(value as QnbLang);
								this.update();
							})
					);
				},
			},
			{
				name: this.tr("settings.fullscreen.name"),
				desc: this.tr("settings.fullscreen.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.fullscreenMode).onChange(async (value) => {
							await this.plugin.setFullscreenMode(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.collapseIcons.name"),
				desc: this.tr("settings.collapseIcons.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.collapseNoteIcons).onChange(async (value) => {
							await this.plugin.setCollapseNoteIcons(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.noteIconOrder.heading"),
				desc: this.tr("settings.noteIconOrder.intro"),
				render: (setting: Setting) => {
					setting.setHeading();
					this.buildNoteIconOrderList(setting.settingEl.createDiv());
				},
			},
			{
				name: this.tr("settings.labels.heading"),
				desc: this.tr("settings.labels.intro"),
				render: (setting: Setting) => {
					setting.setHeading();
					this.buildLabelsList(setting.settingEl.createDiv());
				},
			},
			{
				name: this.tr("settings.requireDoubleClick.name"),
				desc: this.tr("settings.requireDoubleClick.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.requireDoubleClickToEdit).onChange(async (value) => {
							await this.plugin.setRequireDoubleClickToEdit(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.dueDateBorderColor.name"),
				desc: this.tr("settings.dueDateBorderColor.desc"),
				render: (setting: Setting) => {
					setting.addColorPicker((cp) =>
						cp.setValue(this.plugin.settings.dueDateBorderColor).onChange(async (value) => {
							await this.plugin.setDueDateBorderColor(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.compression.name"),
				desc: this.tr("settings.compression.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.compressionEnabled).onChange(async (value) => {
							await this.plugin.setCompressionEnabled(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.dragSettleAnimation.name"),
				desc: this.tr("settings.dragSettleAnimation.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.dragSettleAnimation).onChange(async (value) => {
							await this.plugin.setDragSettleAnimation(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.hoverLift.name"),
				desc: this.tr("settings.hoverLift.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.hoverLiftEffect).onChange(async (value) => {
							await this.plugin.setHoverLiftEffect(value);
							this.refreshDomState();
						})
					);
				},
			},
			{
				name: this.tr("settings.hoverLift.durationLabel"),
				desc: this.tr("settings.hoverLift.durationDesc"),
				visible: () => this.plugin.settings.hoverLiftEffect,
				render: (setting: Setting) => {
					setting.addSlider((slider) =>
						slider
							.setLimits(0, 10, 0.5)
							.setValue(this.plugin.settings.hoverLiftDurationSeconds)
							.setDynamicTooltip()
							.onChange(async (value) => {
								await this.plugin.setHoverLiftDurationSeconds(value);
							})
					);
				},
			},
			{
				name: this.tr("settings.checklistProgress.name"),
				desc: this.tr("settings.checklistProgress.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.checklistProgressBar).onChange(async (value) => {
							await this.plugin.setChecklistProgressBar(value);
							this.refreshDomState();
						})
					);
				},
			},
			{
				name: this.tr("settings.checklistProgress.colorStartLabel"),
				visible: () => this.plugin.settings.checklistProgressBar,
				render: (setting: Setting) => {
					setting.addColorPicker((cp) =>
						cp.setValue(this.plugin.settings.checklistProgressBarColorStart).onChange(async (value) => {
							await this.plugin.setChecklistProgressBarColorStart(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.checklistProgress.colorEndLabel"),
				visible: () => this.plugin.settings.checklistProgressBar,
				render: (setting: Setting) => {
					setting.addColorPicker((cp) =>
						cp.setValue(this.plugin.settings.checklistProgressBarColorEnd).onChange(async (value) => {
							await this.plugin.setChecklistProgressBarColorEnd(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.checklistProgress.heightLabel"),
				visible: () => this.plugin.settings.checklistProgressBar,
				render: (setting: Setting) => {
					setting.addSlider((slider) =>
						slider
							.setLimits(10, 50, 1)
							.setValue(this.plugin.settings.checklistProgressBarHeight)
							.setDynamicTooltip()
							.onChange(async (value) => {
								await this.plugin.setChecklistProgressBarHeight(value);
							})
					);
				},
			},
			{
				name: this.tr("settings.checklistProgress.completeColorLabel"),
				visible: () => this.plugin.settings.checklistProgressBar,
				render: (setting: Setting) => {
					setting.addColorPicker((cp) =>
						cp
							.setValue(this.plugin.settings.checklistProgressBarCompleteColor)
							.onChange(async (value) => {
								await this.plugin.setChecklistProgressBarCompleteColor(value);
							})
					);
				},
			},
			{
				name: this.tr("settings.checklistProgress.completeTextLabel"),
				desc: this.tr("settings.checklistProgress.completeTextDesc"),
				visible: () => this.plugin.settings.checklistProgressBar,
				render: (setting: Setting) => {
					setting.addText((text) => {
						text.setPlaceholder(this.tr("view.checklistProgress.completeDefault"));
						text.setValue(this.plugin.settings.checklistProgressBarCompleteText);
						text.onChange(async (value) => {
							await this.plugin.setChecklistProgressBarCompleteText(value);
						});
					});
				},
			},
			{
				name: this.tr("settings.checklistProgress.completeDelayLabel"),
				desc: this.tr("settings.checklistProgress.completeDelayDesc"),
				visible: () => this.plugin.settings.checklistProgressBar,
				render: (setting: Setting) => {
					setting.addSlider((slider) =>
						slider
							.setLimits(0, 10, 0.5)
							.setValue(this.plugin.settings.checklistProgressCompleteDelaySeconds)
							.setDynamicTooltip()
							.onChange(async (value) => {
								await this.plugin.setChecklistProgressCompleteDelaySeconds(value);
							})
					);
				},
			},
			{
				name: this.tr("settings.alwaysOnShadow.name"),
				desc: this.tr("settings.alwaysOnShadow.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.alwaysOnNoteShadow).onChange(async (value) => {
							await this.plugin.setAlwaysOnNoteShadow(value);
							this.refreshDomState();
						})
					);
				},
			},
			{
				name: this.tr("settings.alwaysOnShadow.intensityLabel"),
				visible: () => this.plugin.settings.alwaysOnNoteShadow,
				render: (setting: Setting) => {
					setting.addSlider((slider) =>
						slider
							.setLimits(0, 100, 5)
							.setValue(this.plugin.settings.noteShadowIntensity)
							.setDynamicTooltip()
							.onChange(async (value) => {
								await this.plugin.setNoteShadowIntensity(value);
							})
					);
				},
			},
			{
				name: this.tr("settings.activityChart.heading"),
				render: (setting: Setting) => {
					setting.setHeading();
					this.buildActivityChartColors(setting.settingEl.createDiv());
				},
			},
			{
				name: this.tr("settings.useFavorites.name"),
				desc: this.tr("settings.useFavorites.desc"),
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.useFavorites).onChange(async (value) => {
							await this.plugin.setUseFavorites(value);
							this.refreshDomState();
						})
					);
				},
			},
			{
				name: this.tr("settings.favoriteChipFullTitle.name"),
				desc: this.tr("settings.favoriteChipFullTitle.desc"),
				visible: () => this.plugin.settings.useFavorites,
				render: (setting: Setting) => {
					setting.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.favoriteChipFullTitle).onChange(async (value) => {
							await this.plugin.setFavoriteChipFullTitle(value);
						})
					);
				},
			},
			{
				name: this.tr("settings.convertFolder.name"),
				desc: this.tr("settings.convertFolder.desc"),
				render: (setting: Setting) => {
					setting.addText((text) =>
						text
							.setPlaceholder(this.tr("settings.convertFolder.placeholder"))
							.setValue(this.plugin.settings.convertedNotesFolder)
							.onChange(async (value) => {
								await this.plugin.setConvertedNotesFolder(value.trim());
							})
					);
				},
			},
			{
				name: this.tr("settings.defaultNoteSize.name"),
				desc: this.tr("settings.defaultNoteSize.desc"),
				render: (setting: Setting) => {
					const MIN_NOTE_W = 180;
					const MIN_NOTE_H = 120;
					setting
						.addText((text) => {
							text.inputEl.type = "number";
							text.inputEl.min = String(MIN_NOTE_W);
							text.setValue(String(this.plugin.settings.defaultNoteWidth));
							text.inputEl.addEventListener("change", () => {
								void (async () => {
									const value = Math.max(MIN_NOTE_W, parseInt(text.inputEl.value, 10) || MIN_NOTE_W);
									text.setValue(String(value));
									await this.plugin.setDefaultNoteSize(value, this.plugin.settings.defaultNoteHeight);
								})();
							});
						})
						.addText((text) => {
							text.inputEl.type = "number";
							text.inputEl.min = String(MIN_NOTE_H);
							text.setValue(String(this.plugin.settings.defaultNoteHeight));
							text.inputEl.addEventListener("change", () => {
								void (async () => {
									const value = Math.max(MIN_NOTE_H, parseInt(text.inputEl.value, 10) || MIN_NOTE_H);
									text.setValue(String(value));
									await this.plugin.setDefaultNoteSize(this.plugin.settings.defaultNoteWidth, value);
								})();
							});
						});
				},
			},
			{
				name: this.tr("settings.lockedPlaceholder.name"),
				desc: this.tr("settings.lockedPlaceholder.desc"),
				render: (setting: Setting) => {
					let lockedPlaceholderField: TextComponent | null = null;
					setting
						.addText((text) => {
							lockedPlaceholderField = text;
							text.setPlaceholder(this.tr("view.note.lockedPlaceholder"));
							text.setValue(this.plugin.settings.lockedNotePlaceholder);
							text.onChange(async (value) => {
								await this.plugin.setLockedNotePlaceholder(value);
							});
						})
						.addButton((btn) =>
							btn
								.setButtonText(this.tr("settings.categories.titleColorReset"))
								.setTooltip(this.tr("settings.lockedPlaceholder.resetTooltip"))
								.onClick(async () => {
									await this.plugin.setLockedNotePlaceholder("");
									lockedPlaceholderField?.setValue("");
								})
						);
				},
			},
			{
				name: this.tr("settings.categories.heading"),
				desc: this.tr("settings.categories.desc"),
				render: (setting: Setting) => {
					setting.setHeading();
					this.buildCategoriesSection(setting.settingEl.createDiv(), false);
				},
			},
			{
				name: this.tr("settings.sounds.heading"),
				desc: this.tr("settings.sounds.desc", { configDir: this.app.vault.configDir }),
				render: (setting: Setting) => {
					setting.setHeading();
					this.buildSoundsSection(setting.settingEl.createDiv(), false);
				},
			},
			{
				name: this.tr("settings.background.name"),
				desc: this.tr("settings.background.desc"),
				render: (setting: Setting) => {
					setting.addDropdown((dd) =>
						dd
							.addOption("none", this.tr("settings.background.none"))
							.addOption("image", this.tr("settings.background.image"))
							.addOption("color", this.tr("settings.background.color"))
							.setValue(this.plugin.settings.backgroundMode)
							.onChange(async (value: string) => {
								await this.plugin.setBackgroundMode(value as QnbBackgroundMode);
								this.refreshDomState();
							})
					);
				},
			},
			{
				name: this.tr("settings.background.image"),
				visible: () => this.plugin.settings.backgroundMode === "image",
				render: (setting: Setting) => {
					setting.setHeading();
					this.buildImageSection(setting.settingEl.createDiv());
				},
			},
			{
				name: this.tr("settings.background.color"),
				visible: () => this.plugin.settings.backgroundMode === "color",
				render: (setting: Setting) => {
					setting.setHeading();
					this.buildColorSection(setting.settingEl.createDiv());
				},
			},
		];
	}

	/** Elenco riordinabile (drag&drop) delle icone azione mostrate su ogni nota, con toggle di
	 * visibilità per ciascuna. Isolato in un metodo a sé perché riutilizzato identico sia
	 * dall'imperativo display() sia dalla riga dichiarativa di getSettingDefinitions(). */
	private buildNoteIconOrderList(containerEl: HTMLElement) {
		const iconListEl = containerEl.createDiv();
		const renderIconList = () => {
			iconListEl.empty();
			const order = this.plugin.settings.noteIconOrder;

			order.forEach((cfg, idx) => {
				const row = new Setting(iconListEl).setClass("qnb-group-row");
				row.setName(this.tr(`settings.noteIconOrder.icon.${cfg.id}`));

				const handle = createSpan({ cls: "qnb-drag-handle qnb-group-drag-handle" });
				setIcon(handle, "grip-vertical");
				row.settingEl.prepend(handle);
				row.settingEl.addClass("qnb-group-row-draggable");

				// Stesso identico meccanismo già usato per riordinare i sottogruppi: si
				// trascina solo tenendo premuta la maniglia.
				handle.addEventListener("mousedown", () => {
					row.settingEl.setAttribute("draggable", "true");
				});
				row.settingEl.addEventListener("dragend", () => {
					row.settingEl.removeAttribute("draggable");
					row.settingEl.removeClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("dragstart", (evt) => {
					this.draggedNoteIconId = cfg.id;
					evt.dataTransfer?.setData("text/plain", cfg.id);
					if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
				});
				row.settingEl.addEventListener("dragover", (evt) => {
					if (this.draggedNoteIconId === null) return;
					evt.preventDefault();
					row.settingEl.addClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("dragleave", () => {
					row.settingEl.removeClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("drop", (evt) => {
					void (async () => {
						evt.preventDefault();
						row.settingEl.removeClass("qnb-drag-over");
						const draggedId = this.draggedNoteIconId;
						this.draggedNoteIconId = null;
						if (!draggedId || draggedId === cfg.id) return;

						const newOrder = [...this.plugin.settings.noteIconOrder];
						const fromIdx = newOrder.findIndex((c) => c.id === draggedId);
						if (fromIdx === -1) return;
						const [moved] = newOrder.splice(fromIdx, 1);
						const toIdx = newOrder.findIndex((c) => c.id === cfg.id);
						newOrder.splice(toIdx === -1 ? idx : toIdx, 0, moved);
						await this.plugin.setNoteIconOrder(newOrder);
						renderIconList();
					})();
				});

				row.addToggle((toggle) =>
					toggle.setValue(cfg.visible).onChange(async (value) => {
						const current = this.plugin.settings.noteIconOrder;
						const newOrder = current.map((c) => (c.id === cfg.id ? { ...c, visible: value } : c));
						await this.plugin.setNoteIconOrder(newOrder);
					})
				);
			});
		};
		renderIconList();
	}

	/** Elenco riordinabile delle etichette (colore + nome), con aggiunta/eliminazione. Isolato
	 * per lo stesso motivo di buildNoteIconOrderList. */
	private buildLabelsList(containerEl: HTMLElement) {
		const labelsListEl = containerEl.createDiv();
		let draggedLabelId: string | null = null;
		const renderLabelsList = () => {
			labelsListEl.empty();
			const labels = this.plugin.settings.labels;

			labels.forEach((label) => {
				const row = new Setting(labelsListEl).setClass("qnb-group-row");

				const handle = createSpan({ cls: "qnb-drag-handle qnb-group-drag-handle" });
				setIcon(handle, "grip-vertical");
				row.settingEl.prepend(handle);
				row.settingEl.addClass("qnb-group-row-draggable");

				handle.addEventListener("mousedown", () => {
					row.settingEl.setAttribute("draggable", "true");
				});
				row.settingEl.addEventListener("dragend", () => {
					row.settingEl.removeAttribute("draggable");
					row.settingEl.removeClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("dragstart", () => {
					draggedLabelId = label.id;
				});
				row.settingEl.addEventListener("dragover", (evt) => {
					if (draggedLabelId === null) return;
					evt.preventDefault();
					row.settingEl.addClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("dragleave", () => {
					row.settingEl.removeClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("drop", (evt) => {
					void (async () => {
						evt.preventDefault();
						row.settingEl.removeClass("qnb-drag-over");
						const fromId = draggedLabelId;
						draggedLabelId = null;
						if (!fromId || fromId === label.id) return;

						const current = [...this.plugin.settings.labels];
						const fromIdx = current.findIndex((l) => l.id === fromId);
						if (fromIdx === -1) return;
						const [moved] = current.splice(fromIdx, 1);
						const toIdx = current.findIndex((l) => l.id === label.id);
						current.splice(toIdx === -1 ? current.length : toIdx, 0, moved);
						await this.plugin.setLabels(current);
						renderLabelsList();
					})();
				});

				row.addColorPicker((cp) =>
					cp.setValue(label.color || "#888888").onChange(async (value) => {
						const current = this.plugin.settings.labels.map((l) =>
							l.id === label.id ? { ...l, color: value } : l
						);
						await this.plugin.setLabels(current);
					})
				);
				row.addText((text) => {
					text.setValue(label.name).onChange(async (value) => {
						const current = this.plugin.settings.labels.map((l) =>
							l.id === label.id ? { ...l, name: value } : l
						);
						await this.plugin.setLabels(current);
					});
				});
				row.addExtraButton((btn) =>
					btn
						.setIcon("trash-2")
						.setTooltip(this.tr("settings.labels.delete"))
						.onClick(async () => {
							const current = this.plugin.settings.labels.filter((l) => l.id !== label.id);
							await this.plugin.setLabels(current);
							renderLabelsList();
						})
				);
			});

			new Setting(labelsListEl).addButton((btn) =>
				btn.setButtonText(this.tr("settings.labels.add")).onClick(async () => {
					const newLabel: QnbLabel = {
						id: "lbl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
						name: this.tr("settings.labels.newName"),
						color: "#888888",
					};
					await this.plugin.setLabels([...this.plugin.settings.labels, newLabel]);
					renderLabelsList();
				})
			);
		};
		renderLabelsList();
	}

	/** Quattro toggle/colorpicker indipendenti, senza stato annidato: qui vengono applicati a
	 * una Setting già creata dal chiamante (display() ne crea una nuova per ciascuno; la riga
	 * dichiarativa passa quella fornita dal framework). */
	private buildSimpleSettings(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName(this.tr("settings.requireDoubleClick.name"))
			.setDesc(this.tr("settings.requireDoubleClick.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.requireDoubleClickToEdit).onChange(async (value) => {
					await this.plugin.setRequireDoubleClickToEdit(value);
				})
			);

		new Setting(containerEl)
			.setName(this.tr("settings.dueDateBorderColor.name"))
			.setDesc(this.tr("settings.dueDateBorderColor.desc"))
			.addColorPicker((cp) =>
				cp.setValue(this.plugin.settings.dueDateBorderColor).onChange(async (value) => {
					await this.plugin.setDueDateBorderColor(value);
				})
			);

		new Setting(containerEl)
			.setName(this.tr("settings.compression.name"))
			.setDesc(this.tr("settings.compression.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.compressionEnabled).onChange(async (value) => {
					await this.plugin.setCompressionEnabled(value);
				})
			);

		new Setting(containerEl)
			.setName(this.tr("settings.dragSettleAnimation.name"))
			.setDesc(this.tr("settings.dragSettleAnimation.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dragSettleAnimation).onChange(async (value) => {
					await this.plugin.setDragSettleAnimation(value);
				})
			);
	}

	private buildHoverLiftSection(containerEl: HTMLElement) {
		const hoverLiftContainer = containerEl.createDiv();
		const renderHoverLiftSettings = () => {
			hoverLiftContainer.empty();

			new Setting(hoverLiftContainer)
				.setName(this.tr("settings.hoverLift.name"))
				.setDesc(this.tr("settings.hoverLift.desc"))
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.hoverLiftEffect).onChange(async (value) => {
						await this.plugin.setHoverLiftEffect(value);
						renderHoverLiftSettings();
					})
				);

			if (this.plugin.settings.hoverLiftEffect) {
				const nested = hoverLiftContainer.createDiv({ cls: "qnb-nested-setting" });
				new Setting(nested)
					.setName(this.tr("settings.hoverLift.durationLabel"))
					.setDesc(this.tr("settings.hoverLift.durationDesc"))
					.addSlider((slider) =>
						slider
							.setLimits(0, 10, 0.5)
							.setValue(this.plugin.settings.hoverLiftDurationSeconds)
							.setDynamicTooltip()
							.onChange(async (value) => {
								await this.plugin.setHoverLiftDurationSeconds(value);
							})
					);
			}
		};
		renderHoverLiftSettings();
	}

	private buildChecklistProgressSection(containerEl: HTMLElement) {
		const checklistProgressContainer = containerEl.createDiv();
		const renderChecklistProgressSettings = () => {
			checklistProgressContainer.empty();

			new Setting(checklistProgressContainer)
				.setName(this.tr("settings.checklistProgress.name"))
				.setDesc(this.tr("settings.checklistProgress.desc"))
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.checklistProgressBar).onChange(async (value) => {
						await this.plugin.setChecklistProgressBar(value);
						renderChecklistProgressSettings();
					})
				);

			if (this.plugin.settings.checklistProgressBar) {
				const nested = checklistProgressContainer.createDiv({ cls: "qnb-nested-setting" });

				new Setting(nested)
					.setName(this.tr("settings.checklistProgress.colorStartLabel"))
					.addColorPicker((cp) =>
						cp
							.setValue(this.plugin.settings.checklistProgressBarColorStart)
							.onChange(async (value) => {
								await this.plugin.setChecklistProgressBarColorStart(value);
							})
					);

				new Setting(nested)
					.setName(this.tr("settings.checklistProgress.colorEndLabel"))
					.addColorPicker((cp) =>
						cp
							.setValue(this.plugin.settings.checklistProgressBarColorEnd)
							.onChange(async (value) => {
								await this.plugin.setChecklistProgressBarColorEnd(value);
							})
					);

				new Setting(nested)
					.setName(this.tr("settings.checklistProgress.heightLabel"))
					.addSlider((slider) =>
						slider
							.setLimits(10, 50, 1)
							.setValue(this.plugin.settings.checklistProgressBarHeight)
							.setDynamicTooltip()
							.onChange(async (value) => {
								await this.plugin.setChecklistProgressBarHeight(value);
							})
					);

				new Setting(nested)
					.setName(this.tr("settings.checklistProgress.completeColorLabel"))
					.addColorPicker((cp) =>
						cp
							.setValue(this.plugin.settings.checklistProgressBarCompleteColor)
							.onChange(async (value) => {
								await this.plugin.setChecklistProgressBarCompleteColor(value);
							})
					);

				new Setting(nested)
					.setName(this.tr("settings.checklistProgress.completeTextLabel"))
					.setDesc(this.tr("settings.checklistProgress.completeTextDesc"))
					.addText((text) => {
						text.setPlaceholder(this.tr("view.checklistProgress.completeDefault"));
						text.setValue(this.plugin.settings.checklistProgressBarCompleteText);
						text.onChange(async (value) => {
							await this.plugin.setChecklistProgressBarCompleteText(value);
						});
					});

				new Setting(nested)
					.setName(this.tr("settings.checklistProgress.completeDelayLabel"))
					.setDesc(this.tr("settings.checklistProgress.completeDelayDesc"))
					.addSlider((slider) =>
						slider
							.setLimits(0, 10, 0.5)
							.setValue(this.plugin.settings.checklistProgressCompleteDelaySeconds)
							.setDynamicTooltip()
							.onChange(async (value) => {
								await this.plugin.setChecklistProgressCompleteDelaySeconds(value);
							})
					);
			}
		};
		renderChecklistProgressSettings();
	}

	private buildShadowSection(containerEl: HTMLElement) {
		const shadowContainer = containerEl.createDiv();
		const renderShadowSettings = () => {
			shadowContainer.empty();

			new Setting(shadowContainer)
				.setName(this.tr("settings.alwaysOnShadow.name"))
				.setDesc(this.tr("settings.alwaysOnShadow.desc"))
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.alwaysOnNoteShadow).onChange(async (value) => {
						await this.plugin.setAlwaysOnNoteShadow(value);
						renderShadowSettings();
					})
				);

			if (this.plugin.settings.alwaysOnNoteShadow) {
				const nested = shadowContainer.createDiv({ cls: "qnb-nested-setting" });
				new Setting(nested)
					.setName(this.tr("settings.alwaysOnShadow.intensityLabel"))
					.addSlider((slider) =>
						slider
							.setLimits(0, 100, 5)
							.setValue(this.plugin.settings.noteShadowIntensity)
							.setDynamicTooltip()
							.onChange(async (value) => {
								await this.plugin.setNoteShadowIntensity(value);
							})
					);
			}
		};
		renderShadowSettings();
	}

	/** Le due righe colore (note/caratteri) del grafico attività, senza l'intestazione (che
	 * display() e la riga dichiarativa gestiscono ciascuno a modo proprio). */
	private buildActivityChartColors(containerEl: HTMLElement) {
		let notesColorPicker: ColorComponent | null = null;
		const notesColorRow = new Setting(containerEl).setName(this.tr("settings.activityChart.notesColor"));
		notesColorRow.addColorPicker((cp) => {
			notesColorPicker = cp;
			cp.setValue(this.plugin.settings.activityChartNotesColor || "#7c5cff");
			cp.onChange(async (value) => {
				await this.plugin.setActivityChartNotesColor(value);
			});
		});
		notesColorRow.addButton((btn) =>
			btn.setButtonText(this.tr("settings.categories.titleColorReset")).onClick(async () => {
				await this.plugin.setActivityChartNotesColor("");
				notesColorPicker?.setValue("#7c5cff");
			})
		);

		let charsColorPicker: ColorComponent | null = null;
		const charsColorRow = new Setting(containerEl).setName(this.tr("settings.activityChart.charsColor"));
		charsColorRow.addColorPicker((cp) => {
			charsColorPicker = cp;
			cp.setValue(this.plugin.settings.activityChartCharsColor || "#4caf50");
			cp.onChange(async (value) => {
				await this.plugin.setActivityChartCharsColor(value);
			});
		});
		charsColorRow.addButton((btn) =>
			btn.setButtonText(this.tr("settings.categories.titleColorReset")).onClick(async () => {
				await this.plugin.setActivityChartCharsColor("");
				charsColorPicker?.setValue("#4caf50");
			})
		);
	}

	private buildFavoritesSection(containerEl: HTMLElement) {
		const favoritesContainer = containerEl.createDiv();
		const renderFavoritesSettings = () => {
			favoritesContainer.empty();

			new Setting(favoritesContainer)
				.setName(this.tr("settings.useFavorites.name"))
				.setDesc(this.tr("settings.useFavorites.desc"))
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.useFavorites).onChange(async (value) => {
						await this.plugin.setUseFavorites(value);
						renderFavoritesSettings();
					})
				);

			// Non ha senso poterla attivare se "Usa i preferiti" è spento: compare solo
			// dopo averlo acceso, come il corpo comprimibile di ogni categoria.
			if (this.plugin.settings.useFavorites) {
				const nested = favoritesContainer.createDiv({ cls: "qnb-nested-setting" });
				new Setting(nested)
					.setName(this.tr("settings.favoriteChipFullTitle.name"))
					.setDesc(this.tr("settings.favoriteChipFullTitle.desc"))
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.favoriteChipFullTitle).onChange(async (value) => {
							await this.plugin.setFavoriteChipFullTitle(value);
						})
					);
			}
		};
		renderFavoritesSettings();
	}

	private buildConvertFolderSetting(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName(this.tr("settings.convertFolder.name"))
			.setDesc(this.tr("settings.convertFolder.desc"))
			.addText((text) =>
				text
					.setPlaceholder(this.tr("settings.convertFolder.placeholder"))
					.setValue(this.plugin.settings.convertedNotesFolder)
					.onChange(async (value) => {
						await this.plugin.setConvertedNotesFolder(value.trim());
					})
			);
	}

	private buildDefaultNoteSizeSetting(containerEl: HTMLElement) {
		const MIN_NOTE_W = 180;
		const MIN_NOTE_H = 120;
		new Setting(containerEl)
			.setName(this.tr("settings.defaultNoteSize.name"))
			.setDesc(this.tr("settings.defaultNoteSize.desc"))
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = String(MIN_NOTE_W);
				text.setValue(String(this.plugin.settings.defaultNoteWidth));
				text.inputEl.addEventListener("change", () => {
					void (async () => {
						const value = Math.max(MIN_NOTE_W, parseInt(text.inputEl.value, 10) || MIN_NOTE_W);
						text.setValue(String(value));
						await this.plugin.setDefaultNoteSize(value, this.plugin.settings.defaultNoteHeight);
					})();
				});
			})
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = String(MIN_NOTE_H);
				text.setValue(String(this.plugin.settings.defaultNoteHeight));
				text.inputEl.addEventListener("change", () => {
					void (async () => {
						const value = Math.max(MIN_NOTE_H, parseInt(text.inputEl.value, 10) || MIN_NOTE_H);
						text.setValue(String(value));
						await this.plugin.setDefaultNoteSize(this.plugin.settings.defaultNoteWidth, value);
					})();
				});
			});
	}

	private buildLockedPlaceholderSetting(containerEl: HTMLElement) {
		let lockedPlaceholderField: TextComponent | null = null;
		new Setting(containerEl)
			.setName(this.tr("settings.lockedPlaceholder.name"))
			.setDesc(this.tr("settings.lockedPlaceholder.desc"))
			.addText((text) => {
				lockedPlaceholderField = text;
				text.setPlaceholder(this.tr("view.note.lockedPlaceholder"));
				text.setValue(this.plugin.settings.lockedNotePlaceholder);
				text.onChange(async (value) => {
					await this.plugin.setLockedNotePlaceholder(value);
				});
			})
			.addButton((btn) =>
				btn
					.setButtonText(this.tr("settings.categories.titleColorReset"))
					.setTooltip(this.tr("settings.lockedPlaceholder.resetTooltip"))
					.onClick(async () => {
						await this.plugin.setLockedNotePlaceholder("");
						lockedPlaceholderField?.setValue("");
					})
			);
	}

	private buildBackgroundSection(containerEl: HTMLElement) {
		const modeContainer = containerEl.createDiv();
		const renderMode = () => {
			modeContainer.empty();

			new Setting(modeContainer)
				.setName(this.tr("settings.background.name"))
				.setDesc(this.tr("settings.background.desc"))
				.addDropdown((dd) =>
					dd
						.addOption("none", this.tr("settings.background.none"))
						.addOption("image", this.tr("settings.background.image"))
						.addOption("color", this.tr("settings.background.color"))
						.setValue(this.plugin.settings.backgroundMode)
						.onChange(async (value: string) => {
							await this.plugin.setBackgroundMode(value as QnbBackgroundMode);
							renderMode();
						})
				);

			if (this.plugin.settings.backgroundMode === "image") {
				this.buildImageSection(modeContainer);
			}

			if (this.plugin.settings.backgroundMode === "color") {
				this.buildColorSection(modeContainer);
			}
		};
		renderMode();
	}

	private buildCategoriesSection(containerEl: HTMLElement, withHeading = true) {
		const wrapper = containerEl.createDiv();

		const render = () => {
			wrapper.empty();

			if (withHeading) {
				new Setting(wrapper).setName(this.tr("settings.categories.heading")).setHeading();
				wrapper.createEl("p", {
					cls: "setting-item-description",
					text: this.tr("settings.categories.desc"),
				});
			}

			this.plugin.settings.categories.forEach((cat, index) => {
				const card = wrapper.createDiv({ cls: "qnb-category-card" });

				const header = new Setting(card);
				header.settingEl.addClass("qnb-category-header");
				let pendingName = cat.name;

				const handle = createSpan({ cls: "qnb-drag-handle" });
				setIcon(handle, "grip-vertical");
				header.settingEl.prepend(handle);

				// Il trascinamento si attiva solo tenendo premuta la maniglia, così scrivere
				// nel campo nome non lo scatena per errore. Si trascina l'intera scheda
				// (compresa o espansa), non solo l'intestazione.
				handle.addEventListener("mousedown", () => {
					card.setAttribute("draggable", "true");
				});
				card.addEventListener("dragend", () => {
					card.removeAttribute("draggable");
					card.removeClass("qnb-drag-over");
				});
				card.addEventListener("dragstart", (evt) => {
					this.draggedCategoryIndex = index;
					evt.dataTransfer?.setData("text/plain", String(index));
					if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
				});
				card.addEventListener("dragover", (evt) => {
					if (this.draggedCategoryIndex === null) return;
					evt.preventDefault();
					card.addClass("qnb-drag-over");
				});
				card.addEventListener("dragleave", () => {
					card.removeClass("qnb-drag-over");
				});
				card.addEventListener("drop", (evt) => {
					void (async () => {
						evt.preventDefault();
						card.removeClass("qnb-drag-over");
						const fromIndex = this.draggedCategoryIndex;
						this.draggedCategoryIndex = null;
						if (fromIndex === null || fromIndex === index) return;
						await this.plugin.reorderCategories(fromIndex, index);
						render();
					})();
				});

				header.addText((text) => {
					text.setValue(cat.name);
					text.onChange((v) => (pendingName = v));
					text.inputEl.addEventListener("blur", () => {
						void (async () => {
							const trimmed = pendingName.trim();
							if (trimmed && trimmed !== cat.name) {
								await this.plugin.renameCategory(cat.name, trimmed);
								render();
							}
						})();
					});
				});

				const isCollapsed = this.collapsedCategories.has(cat.name);
				const body = card.createDiv({ cls: "qnb-category-body" });
				body.setCssStyles({ display: isCollapsed ? "none" : "block" });

				let collapseBtnComponent: ButtonComponent | null = null;
				header.addButton((btn) => {
					collapseBtnComponent = btn;
					btn
						.setIcon(isCollapsed ? "chevron-right" : "chevron-down")
						.setTooltip(this.tr("settings.categories.collapseTooltip"))
						.onClick(() => {
							const nowCollapsed = body.style.display !== "none";
							body.setCssStyles({ display: nowCollapsed ? "none" : "block" });
							if (nowCollapsed) this.collapsedCategories.add(cat.name);
							else this.collapsedCategories.delete(cat.name);
							collapseBtnComponent?.setIcon(nowCollapsed ? "chevron-right" : "chevron-down");
						});
				});

				header.addButton((btn) =>
					btn
						.setIcon("trash-2")
						.setTooltip(this.tr("settings.categories.delete.tooltip"))
						.onClick(async () => {
							if (this.plugin.settings.categories.length <= 1) {
								new Notice(this.tr("settings.categories.delete.mustKeepOne"));
								return;
							}
							await this.plugin.removeCategory(cat.name);
							render();
						})
				);

				// Colori della categoria, dentro il corpo comprimibile.
				const colorsRow = new Setting(body).setName(this.tr("settings.categories.colorsLabel"));
				colorsRow.addColorPicker((cp) => {
					cp.setValue(cat.color);
					(cp as unknown as { colorPickerEl: HTMLInputElement }).colorPickerEl.setAttr(
						"aria-label",
						this.tr("settings.categories.bgColorTooltip")
					);
					cp.onChange(async (value) => {
						await this.plugin.updateCategoryColor(cat.name, value);
					});
				});

				let titleColorPicker: ColorComponent | null = null;
				colorsRow.addColorPicker((cp) => {
					titleColorPicker = cp;
					cp.setValue(cat.titleColor || "#ffffff");
					(cp as unknown as { colorPickerEl: HTMLInputElement }).colorPickerEl.setAttr(
						"aria-label",
						this.tr("settings.categories.titleColorTooltip")
					);
					cp.onChange(async (value) => {
						await this.plugin.updateCategoryTitleColor(cat.name, value);
					});
				});
				colorsRow.addButton((btn) =>
					btn
						.setButtonText(this.tr("settings.categories.titleColorReset"))
						.setTooltip(this.tr("settings.categories.titleColorResetTooltip"))
						.onClick(async () => {
							await this.plugin.updateCategoryTitleColor(cat.name, "");
							titleColorPicker?.setValue("#ffffff");
						})
				);

				// Ordine richiesto: prima gruppi e sottogruppi, poi icona (e le altre opzioni).
				this.buildCategoryGroupsSection(body, cat);
				this.buildCategoryIconPicker(body, cat);
			});

			const addSetting = new Setting(wrapper)
				.setName(this.tr("settings.categories.new.name"))
				.setDesc(this.tr("settings.categories.new.desc"));

			addSetting.addText((text) => {
				text.setPlaceholder(this.tr("settings.categories.new.placeholder"));
				text.setValue(this.pendingCategoryName);
				text.onChange((v) => (this.pendingCategoryName = v));
			});

			let pendingColorPicker: ColorComponent | null = null;
			addSetting.addColorPicker((cp) => {
				pendingColorPicker = cp;
				cp.setValue(this.pendingCategoryColor);
				cp.onChange((v) => {
					this.pendingCategoryColor = v;
					highlightAddSwatch(v);
				});
			});

			addSetting.addButton((btn) =>
				btn
					.setButtonText(this.tr("settings.categories.new.add"))
					.setCta()
					.onClick(async () => {
						const name = this.pendingCategoryName.trim();
						if (!name) {
							new Notice(this.tr("settings.categories.new.emptyName"));
							return;
						}
						if (
							this.plugin.settings.categories.some(
								(c) => c.name.toLowerCase() === name.toLowerCase()
							)
						) {
							new Notice(this.tr("settings.categories.new.duplicate"));
							return;
						}
						await this.plugin.addCategory(name, this.pendingCategoryColor);
						this.pendingCategoryName = "";
						render();
					})
			);

			const addPaletteEl = wrapper.createDiv({ cls: "qnb-color-palette qnb-color-palette-inline" });
			const addSwatches: HTMLElement[] = [];
			const highlightAddSwatch = (hex: string) => {
				for (const s of addSwatches) s.removeClass("is-selected");
				const match = addSwatches.find(
					(s) => s.getAttr("aria-label")?.toLowerCase() === hex.toLowerCase()
				);
				match?.addClass("is-selected");
			};
			for (const hex of COLOR_PALETTE) {
				const swatch = addPaletteEl.createDiv({ cls: "qnb-color-swatch" });
				swatch.setCssStyles({ backgroundColor: hex });
				if (hex.toLowerCase() === this.pendingCategoryColor.toLowerCase()) {
					swatch.addClass("is-selected");
				}
				swatch.setAttr("aria-label", hex);
				addSwatches.push(swatch);
				swatch.addEventListener("click", () => {
					// Aggiorna solo la selezione (e il color picker nativo accanto), senza
					// ricostruire l'intero pannello: altrimenti la pagina tornerebbe in cima.
					this.pendingCategoryColor = hex;
					highlightAddSwatch(hex);
					pendingColorPicker?.setValue(hex);
				});
			}
		};

		render();
	}

	/** Galleria di icone cliccabili (non un elenco testuale): quella scelta è evidenziata. */
	private buildCategoryIconPicker(containerEl: HTMLElement, cat: QnbCategory) {
		const wrapper = containerEl.createDiv({ cls: "qnb-icon-picker" });
		wrapper.createSpan({ cls: "qnb-icon-picker-label", text: this.tr("settings.categories.iconTooltip") });

		const grid = wrapper.createDiv({ cls: "qnb-icon-picker-grid" });
		const quickButtons: HTMLElement[] = [];

		const highlightQuickMatch = (value: string) => {
			for (const b of quickButtons) b.removeClass("is-selected");
			const idx = CATEGORY_ICON_OPTIONS.findIndex((o) => o.value === value);
			if (idx !== -1) quickButtons[idx].addClass("is-selected");
		};

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
					// Aggiorna solo l'evidenziazione, senza ricostruire l'intero pannello:
					// altrimenti la pagina tornerebbe in cima ad ogni scelta.
					highlightQuickMatch(opt.value);
					customInput.value = "";
					updateCustomPreview("");
				})();
			});
		}

		// Campo libero: qualsiasi icona della libreria Lucide, con anteprima dal vivo
		// (l'intera libreria conta oltre 1500 icone, troppe per una griglia navigabile).
		const customRow = wrapper.createDiv({ cls: "qnb-icon-picker-custom" });

		const previewEl = customRow.createDiv({ cls: "qnb-icon-picker-custom-preview" });
		const updateCustomPreview = (value: string) => {
			previewEl.empty();
			const trimmed = value.trim();
			if (trimmed) setIcon(previewEl, trimmed);
		};

		const customInput = customRow.createEl("input", {
			cls: "qnb-icon-picker-custom-input",
			attr: { type: "text", placeholder: this.tr("settings.categories.iconCustomPlaceholder") },
		});

		const isQuickIcon = CATEGORY_ICON_OPTIONS.some((o) => o.value === (cat.icon || ""));
		if (!isQuickIcon && cat.icon) customInput.value = cat.icon;
		updateCustomPreview(customInput.value);

		customInput.addEventListener("input", () => updateCustomPreview(customInput.value));

		const applyCustom = async () => {
			const trimmed = customInput.value.trim();
			if (trimmed === (cat.icon || "")) return;
			cat.icon = trimmed;
			await this.plugin.updateCategoryIcon(cat.name, trimmed);
			highlightQuickMatch(trimmed); // se combacia per caso con una rapida, la evidenzia anche lì
		};

		customInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void applyCustom();
			}
		});

		customRow.createEl("button", {
			cls: "qnb-icon-picker-custom-apply",
			attr: { type: "button" },
			text: this.tr("settings.categories.iconCustomApply"),
		}).addEventListener("click", () => void applyCustom());

		// Colore dell'icona: si applica sia alle icone rapide sia a quella custom.
		previewEl.setCssStyles({ color: cat.iconColor || "" });
		const colorRow = wrapper.createDiv({ cls: "qnb-icon-picker-color-row" });
		colorRow.createSpan({ cls: "qnb-icon-picker-color-label", text: this.tr("settings.categories.iconColorLabel") });
		const colorInput = colorRow.createEl("input", {
			cls: "qnb-icon-picker-color-input",
			attr: { type: "color" },
		});
		colorInput.value = cat.iconColor || "#ffffff";
		colorInput.addEventListener("input", () => {
			previewEl.setCssStyles({ color: colorInput.value });
		});
		colorInput.addEventListener("change", () => {
			void (async () => {
				cat.iconColor = colorInput.value;
				await this.plugin.updateCategoryIconColor(cat.name, colorInput.value);
			})();
		});
		colorRow.createEl("button", {
			cls: "qnb-icon-picker-custom-apply",
			attr: { type: "button" },
			text: this.tr("settings.categories.titleColorReset"),
		}).addEventListener("click", () => {
			void (async () => {
				cat.iconColor = "";
				await this.plugin.updateCategoryIconColor(cat.name, "");
				colorInput.value = "#ffffff";
				previewEl.setCssStyles({ color: "" });
			})();
		});

		const hintRow = wrapper.createDiv({ cls: "qnb-icon-picker-hint-row" });
		hintRow.createDiv({ cls: "qnb-icon-picker-hint", text: this.tr("settings.categories.iconCustomHint") });
		const libraryLinkBtn = hintRow.createEl("button", {
			cls: "qnb-icon-picker-link-btn",
			attr: { type: "button" },
		});
		setIcon(libraryLinkBtn.createSpan({ cls: "qnb-btn-icon" }), "external-link");
		libraryLinkBtn.createSpan({ text: this.tr("settings.categories.iconLibraryLink") });
		libraryLinkBtn.addEventListener("click", () => {
			window.open("https://lucide.dev/icons/", "_blank");
		});
	}

	/** Punto di ingresso: i gruppi di primo livello di una categoria (profondità 1). */
	private buildCategoryGroupsSection(containerEl: HTMLElement, cat: QnbCategory) {
		this.buildGroupsTree(
			containerEl,
			cat.name,
			cat.groups,
			null,
			1,
			this.tr("settings.groups.heading", { category: cat.name })
		);
	}

	/** Disegna un livello dell'albero dei gruppi (gruppi di quella profondità, con
	 * rinomina/elimina) e, per ognuno che può ancora averne, la sezione dei suoi
	 * sottogruppi — ricorsiva, dal 3° livello in poi parte compressa. */
	private buildGroupsTree(
		containerEl: HTMLElement,
		categoryName: string,
		groups: QnbGroup[],
		parentGroupId: string | null,
		depth: number,
		heading: string
	) {
		const wrapper = containerEl.createDiv({ cls: "qnb-groups-section" });
		wrapper.createEl(depth === 1 ? "h4" : "h5", { text: heading });
		if (depth === 1) {
			wrapper.createEl("p", { cls: "setting-item-description", text: this.tr("settings.groups.desc") });
		}

		const list = wrapper.createDiv({ cls: "qnb-groups-list" });

		const renderList = () => {
			list.empty();
			groups.forEach((grp, idx) => {
				const row = new Setting(list).setClass("qnb-group-row");
				let pendingName = grp.name;

				const handle = createSpan({ cls: "qnb-drag-handle qnb-group-drag-handle" });
				setIcon(handle, "grip-vertical");
				row.settingEl.prepend(handle);
				row.settingEl.addClass("qnb-group-row-draggable");

				// Stesso meccanismo delle categorie: si trascina solo tenendo premuta la
				// maniglia, e solo tra "fratelli" dello stesso livello (mai sotto un
				// genitore diverso, per non complicare la logica di riordino).
				handle.addEventListener("mousedown", () => {
					row.settingEl.setAttribute("draggable", "true");
				});
				row.settingEl.addEventListener("dragend", () => {
					row.settingEl.removeAttribute("draggable");
					row.settingEl.removeClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("dragstart", (evt) => {
					this.draggedGroupId = grp.id;
					this.draggedGroupSiblings = groups;
					evt.dataTransfer?.setData("text/plain", grp.id);
					if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
				});
				row.settingEl.addEventListener("dragover", (evt) => {
					if (this.draggedGroupId === null || this.draggedGroupSiblings !== groups) return;
					evt.preventDefault();
					row.settingEl.addClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("dragleave", () => {
					row.settingEl.removeClass("qnb-drag-over");
				});
				row.settingEl.addEventListener("drop", (evt) => {
					void (async () => {
						evt.preventDefault();
						row.settingEl.removeClass("qnb-drag-over");
						const draggedId = this.draggedGroupId;
						const draggedSiblings = this.draggedGroupSiblings;
						this.draggedGroupId = null;
						this.draggedGroupSiblings = null;
						if (!draggedId || draggedSiblings !== groups || draggedId === grp.id) return;
						await this.plugin.reorderGroup(categoryName, draggedId, idx);
						renderList();
					})();
				});

				row.addText((text) => {
					text.setValue(grp.name);
					text.onChange((v) => (pendingName = v));
					text.inputEl.addEventListener("blur", () => {
						void (async () => {
							const trimmed = pendingName.trim();
							if (trimmed && trimmed !== grp.name) {
								await this.plugin.renameGroup(categoryName, grp.id, trimmed);
								renderList();
							}
						})();
					});
				});

				row.addButton((btn) =>
					btn
						.setIcon("trash-2")
						.setTooltip(this.tr("settings.groups.delete.tooltip"))
						.onClick(async () => {
							await this.plugin.removeGroup(categoryName, grp.id);
							renderList();
						})
				);

				// Sezione dei sottogruppi di QUESTO gruppo, solo se non si è già alla
				// profondità massima consentita.
				if (depth < MAX_GROUP_DEPTH) {
					const childHeading = this.tr("settings.groups.subheading", { name: grp.name });
					if (depth + 1 >= 3) {
						this.buildCollapsedGroupSection(list, categoryName, grp, depth + 1, childHeading);
					} else {
						this.buildGroupsTree(list, categoryName, grp.groups, grp.id, depth + 1, childHeading);
					}
				}
			});
		};
		renderList();

		// Riga "aggiungi (sotto)gruppo" a questo stesso livello.
		if (depth <= MAX_GROUP_DEPTH) {
			let pendingGroupName = "";
			let nameField: TextComponent | null = null;
			const addRow = new Setting(wrapper).setName(this.tr("settings.groups.new.name"));
			addRow.addText((text) => {
				nameField = text;
				text.setPlaceholder(this.tr("settings.groups.new.placeholder"));
				text.onChange((v) => (pendingGroupName = v));
				text.inputEl.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						void addBtnClick();
					}
				});
			});

			const addBtnClick = async () => {
				const trimmed = pendingGroupName.trim();
				if (!trimmed) {
					new Notice(this.tr("settings.groups.new.emptyName"));
					return;
				}
				if (groups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
					new Notice(this.tr("settings.groups.new.duplicate"));
					return;
				}
				await this.plugin.addGroup(categoryName, parentGroupId, trimmed);
				pendingGroupName = "";
				nameField?.setValue("");
				renderList();
			};

			addRow.addButton((btn) =>
				btn
					.setButtonText(this.tr("settings.groups.new.add"))
					.setCta()
					.onClick(() => void addBtnClick())
			);
		}
	}

	/** Un livello compresso di default (dal 3° livello in poi): un pulsante con una
	 * freccetta che, al primo click, costruisce e mostra la sezione vera e propria. */
	private buildCollapsedGroupSection(
		containerEl: HTMLElement,
		categoryName: string,
		grp: QnbGroup,
		depth: number,
		heading: string
	) {
		const wrapper = containerEl.createDiv({ cls: "qnb-groups-collapsed" });
		const totalDescendants = this.countGroupsRecursive(grp.groups);
		const label = totalDescendants > 0 ? `${heading} (${totalDescendants})` : heading;

		const toggleBtn = wrapper.createEl("button", { cls: "qnb-groups-collapse-toggle", attr: { type: "button" } });
		setIcon(toggleBtn.createSpan({ cls: "qnb-groups-collapse-icon" }), "chevron-right");
		toggleBtn.createSpan({ text: label });

		const contentHost = wrapper.createDiv({ cls: "qnb-groups-collapsed-content" });
		contentHost.setCssStyles({ display: "none" });
		let expanded = false;

		toggleBtn.addEventListener("click", () => {
			expanded = !expanded;
			contentHost.setCssStyles({ display: expanded ? "block" : "none" });
			toggleBtn.toggleClass("is-expanded", expanded);
			if (expanded) {
				contentHost.empty();
				this.buildGroupsTree(contentHost, categoryName, grp.groups, grp.id, depth, heading);
			}
		});
	}

	private countGroupsRecursive(groups: QnbGroup[]): number {
		let count = groups.length;
		for (const g of groups) count += this.countGroupsRecursive(g.groups);
		return count;
	}

	private buildSoundsSection(containerEl: HTMLElement, withHeading = true) {
		if (withHeading) {
			new Setting(containerEl).setName(this.tr("settings.sounds.heading")).setHeading();
			containerEl.createEl("p", {
				cls: "setting-item-description",
				text: this.tr("settings.sounds.desc", { configDir: this.app.vault.configDir }),
			});
		}

		const listContainer = containerEl.createDiv();
		void this.renderSoundsList(listContainer);
	}

	/** Elenca i file audio già presenti nella cartella del plugin (estensioni accettate). */
	private async getAvailableSoundFiles(): Promise<{ files: string[]; dirPath: string; error: boolean }> {
		const dirPath = this.plugin.manifest.dir ?? "";
		try {
			const listing = await this.app.vault.adapter.list(dirPath);
			const files = listing.files
				.map((f) => f.split("/").pop() || f)
				.filter((name) => {
					const ext = name.split(".").pop()?.toLowerCase();
					return !!ext && ACCEPTED_SOUND_EXTENSIONS.includes(ext);
				})
				.sort((a, b) => a.localeCompare(b));
			return { files, dirPath, error: false };
		} catch {
			return { files: [], dirPath, error: true };
		}
	}

	private async renderSoundsList(listContainer: HTMLElement) {
		listContainer.empty();

		const { files: availableFiles, dirPath, error } = await this.getAvailableSoundFiles();

		const refreshSetting = new Setting(listContainer)
			.setName(this.tr("settings.sounds.refresh.name"))
			.setDesc(this.tr("settings.sounds.refresh.desc"));
		refreshSetting.addButton((btn) =>
			btn.setButtonText(this.tr("settings.sounds.refresh.button")).onClick(() => {
				void this.renderSoundsList(listContainer);
			})
		);

		if (error) {
			listContainer.createEl("p", {
				cls: "qnb-sounds-warning",
				text: this.tr("settings.sounds.readError", { path: dirPath }),
			});
		} else if (availableFiles.length === 0) {
			listContainer.createEl("p", {
				cls: "qnb-sounds-warning",
				text: this.tr("settings.sounds.noFilesFound", { path: dirPath }),
			});
		}

		for (const group of SOUND_EVENT_GROUPS) {
			new Setting(listContainer).setName(this.tr(group.headingKey)).setHeading();
			for (const event of group.events) {
				this.buildSoundRow(listContainer, event.id, this.tr(event.labelKey), availableFiles);
			}
		}
	}

	private buildSoundRow(
		containerEl: HTMLElement,
		eventId: QnbSoundEventId,
		label: string,
		availableFiles: string[]
	) {
		const currentFile = this.plugin.settings.soundFiles[eventId] || "";
		const row = new Setting(containerEl).setName(label);
		let previewBtn: ButtonComponent | null = null;

		row.addDropdown((dd) => {
			dd.addOption("", this.tr("settings.sounds.noneOption"));
			for (const file of availableFiles) {
				dd.addOption(file, file);
			}
			// Se il file impostato non è (più) nella cartella, tienilo comunque in elenco
			// (segnalato) invece di farlo sparire silenziosamente dalla selezione.
			if (currentFile && !availableFiles.includes(currentFile)) {
				dd.addOption(currentFile, `${currentFile} ⚠️`);
			}
			dd.setValue(currentFile);
			dd.onChange(async (value) => {
				// Aggiorna solo il pulsante anteprima, senza ricostruire l'intero pannello:
				// altrimenti la pagina tornerebbe in cima ad ogni selezione.
				previewBtn?.setDisabled(!value);
				await this.plugin.setEventSoundFile(eventId, value);
			});
		});

		row.addButton((btn) => {
			previewBtn = btn;
			btn
				.setIcon("play")
				.setTooltip(this.tr("settings.sounds.preview"))
				.setDisabled(!currentFile)
				.onClick(() => {
					if (this.plugin.settings.soundFiles[eventId]) this.plugin.playSound(eventId);
				});
		});
	}

	private buildImageSection(containerEl: HTMLElement) {
		const wrapper = containerEl.createDiv();

		const render = () => {
			wrapper.empty();

			const bgSetting = new Setting(wrapper)
				.setName(this.tr("settings.image.name"))
				.setDesc(
					this.plugin.settings.backgroundFileName
						? this.tr("settings.image.current", { file: this.plugin.settings.backgroundFileName })
						: this.tr("settings.image.none")
				);

			bgSetting.addButton((btn) =>
				btn.setButtonText(this.tr("settings.image.choose")).onClick(() => this.pickImage(render))
			);

			if (this.plugin.settings.backgroundFileName) {
				bgSetting.addButton((btn) =>
					btn
						.setButtonText(this.tr("settings.image.remove"))
						.setWarning()
						.onClick(async () => {
							await this.plugin.clearBackgroundImage();
							render();
						})
				);
			}

			new Setting(wrapper)
				.setName(this.tr("settings.image.fit.name"))
				.setDesc(this.tr("settings.image.fit.desc"))
				.addDropdown((dd) =>
					dd
						.addOption("cover", this.tr("settings.image.fit.cover"))
						.addOption("contain", this.tr("settings.image.fit.contain"))
						.addOption("repeat", this.tr("settings.image.fit.repeat"))
						.setValue(this.plugin.settings.backgroundSize)
						.onChange(async (value: "cover" | "contain" | "repeat") => {
							this.plugin.settings.backgroundSize = value;
							await this.plugin.saveSettings();
							this.plugin.refreshOpenViews();
						})
				);

			new Setting(wrapper)
				.setName(this.tr("settings.image.dim.name"))
				.setDesc(this.tr("settings.image.dim.desc"))
				.addSlider((slider) =>
					slider
						.setLimits(0, 80, 5)
						.setValue(this.plugin.settings.backgroundDim)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.backgroundDim = value;
							await this.plugin.saveSettings();
							this.plugin.refreshOpenViews();
						})
				);
		};

		render();
	}

	private buildColorSection(containerEl: HTMLElement) {
		const wrapper = containerEl.createDiv();

		const render = () => {
			wrapper.empty();

			new Setting(wrapper)
				.setName(this.tr("settings.color.name"))
				.setDesc(this.tr("settings.color.desc"))
				.addColorPicker((cp) =>
					cp.setValue(this.plugin.settings.backgroundColor).onChange(async (value) => {
						await this.plugin.setBackgroundColor(value);
						swatches.forEach((s) =>
							s.toggleClass("is-selected", s.getAttr("aria-label")?.toLowerCase() === value.toLowerCase())
						);
					})
				);

			const paletteSetting = new Setting(wrapper).setName(this.tr("settings.color.palette"));
			const paletteEl = paletteSetting.controlEl.createDiv({ cls: "qnb-color-palette" });

			const swatches: HTMLElement[] = [];
			for (const hex of COLOR_PALETTE) {
				const swatch = paletteEl.createDiv({ cls: "qnb-color-swatch" });
				swatch.setCssStyles({ backgroundColor: hex });
				if (hex.toLowerCase() === this.plugin.settings.backgroundColor.toLowerCase()) {
					swatch.addClass("is-selected");
				}
				swatch.setAttr("aria-label", hex);
				swatches.push(swatch);
				swatch.addEventListener("click", () => {
					void (async () => {
						// Aggiorna solo la selezione, senza ricostruire l'intero pannello:
						// altrimenti la pagina tornerebbe in cima ad ogni scelta.
						await this.plugin.setBackgroundColor(hex);
						swatches.forEach((s) => s.toggleClass("is-selected", s === swatch));
					})();
				});
			}
		};

		render();
	}

	/**
	 * Apre il selettore file per scegliere un'immagine dal disco.
	 * Su desktop usa il dialogo nativo di Electron (più affidabile in Obsidian);
	 * se non disponibile (es. mobile), ricade su un <input type="file"> HTML.
	 */
	private async pickImage(onDone: () => void) {
		const win = window as unknown as { require?: (moduleName: string) => unknown };

		if (typeof win.require === "function") {
			try {
				const handled = await this.pickImageViaElectron(win.require, onDone);
				if (handled) return;
			} catch (e) {
				console.error("Quick Notes Board: dialogo nativo non disponibile, uso il fallback HTML", e);
			}
		}

		this.pickImageViaHtmlInput(onDone);
	}

	/** Ritorna true se il dialogo è stato gestito (scelto un file o annullato esplicitamente). */
	private async pickImageViaElectron(
		nodeRequire: (moduleName: string) => unknown,
		onDone: () => void
	): Promise<boolean> {
		const electron = nodeRequire("electron") as ElectronModule | undefined;
		const dialog = electron?.remote?.dialog ?? electron?.dialog;
		const fs = nodeRequire("fs") as NodeFsModule | undefined;

		if (!dialog || !fs) return false;

		const result = await dialog.showOpenDialog({
			title: this.tr("settings.image.dialogTitle"),
			properties: ["openFile"],
			filters: [{ name: this.tr("settings.image.dialogFilter"), extensions: ACCEPTED_EXTENSIONS }],
		});

		if (!result || result.canceled || !result.filePaths?.length) {
			return true; // annullato dall'utente: gestito, nessun fallback necessario
		}

		const filePath: string = result.filePaths[0];
		const ext = (filePath.split(".").pop() || "png").toLowerCase();

		if (!ACCEPTED_EXTENSIONS.includes(ext)) {
			new Notice(this.tr("settings.image.unsupported"));
			return true;
		}

		try {
			const nodeBuffer = fs.readFileSync(filePath);
			const arrayBuffer = nodeBuffer.buffer.slice(
				nodeBuffer.byteOffset,
				nodeBuffer.byteOffset + nodeBuffer.byteLength
			) as ArrayBuffer;
			await this.plugin.setBackgroundImage(arrayBuffer, ext);
			new Notice(this.tr("settings.image.updated"));
			onDone();
		} catch (e) {
			console.error("Quick Notes Board: errore nel salvataggio dell'immagine", e);
			new Notice(this.tr("settings.image.saveError"));
		}

		return true;
	}

	private pickImageViaHtmlInput(onDone: () => void) {
		const input = document.body.createEl("input", {
			attr: {
				type: "file",
				accept: "image/png,image/jpeg,image/webp,image/gif",
			},
		});
		// display:none impedisce ad alcuni ambienti Electron/Chromium di aprire il dialogo
		// file quando si chiama .click() da codice: l'elemento resta "renderizzato" ma invisibile.
		input.setCssStyles({ position: "fixed" });
		input.setCssStyles({ top: "-1000px" });
		input.setCssStyles({ left: "-1000px" });
		input.setCssStyles({ opacity: "0" });
		input.setCssStyles({ pointerEvents: "none" });

		input.addEventListener("change", () => {
			void (async () => {
				const file = input.files?.[0];
				input.remove();
				if (!file) return;

				const ext = (file.name.split(".").pop() || "png").toLowerCase();
				if (!ACCEPTED_EXTENSIONS.includes(ext)) {
					new Notice(this.tr("settings.image.unsupported"));
					return;
				}

				try {
					const buffer = await file.arrayBuffer();
					await this.plugin.setBackgroundImage(buffer, ext);
					new Notice(this.tr("settings.image.updated"));
					onDone();
				} catch (e) {
					console.error("Quick Notes Board: errore nel salvataggio dell'immagine", e);
					new Notice(this.tr("settings.image.saveError"));
				}
			})();
		});

		input.click();
	}
}
