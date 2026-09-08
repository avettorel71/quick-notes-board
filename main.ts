import { Plugin, WorkspaceLeaf, normalizePath, Notice } from "obsidian";

// Compressione del file dati: etichetta riconoscibile all'inizio del file quando è
// compresso. La lettura si basa SEMPRE su questa etichetta, mai sull'impostazione
// dell'utente — così un cambio dell'interruttore non rischia mai di far leggere male un
// file già esistente sul disco (letto correttamente sia acceso che spento).
const COMPRESSION_MARKER = "%% QNB-COMPRESSED v1 %%\n";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const chunkSize = 8192; // evita "Maximum call stack size exceeded" su file grandi
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
	}
	return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function compressText(text: string): Promise<string> {
	const input = new TextEncoder().encode(text);
	const cs = new CompressionStream("gzip");
	const writer = cs.writable.getWriter();
	void writer.write(input);
	void writer.close();
	const compressedBuffer = await new Response(cs.readable).arrayBuffer();
	return arrayBufferToBase64(compressedBuffer);
}

/** Decomprime; lancia un'eccezione se i dati non sono un gzip valido (file corrotto),
 * apposta: non deve mai restituire un risultato "vuoto" in silenzio in quel caso. */
async function decompressText(base64: string): Promise<string> {
	const compressedBytes = base64ToUint8Array(base64);
	const ds = new DecompressionStream("gzip");
	const writer = ds.writable.getWriter();
	void writer.write(compressedBytes);
	void writer.close();
	const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
	return new TextDecoder().decode(decompressedBuffer);
}

import { QuickNotesBoardView, VIEW_TYPE_QNB } from "./view";
import {
	QuickNotesBoardSettings,
	QuickNotesBoardSettingTab,
	DEFAULT_SETTINGS,
	QnbLang,
	QnbSoundEventId,
	QnbGroup,
	MAX_GROUP_DEPTH,
	QnbNoteIconConfig,
	QnbNoteIconId,
	DEFAULT_NOTE_ICON_ORDER,
	QnbLabel,
} from "./settings";
import { t } from "./i18n";

export type QnbFontFamily =
	| "default"
	| "sans"
	| "serif"
	| "mono"
	| "cursive"
	| "fantasy"
	| "arial"
	| "georgia"
	| "times"
	| "courier"
	| "verdana"
	| "trebuchet"
	| "palatino"
	| "garamond"
	| "comicsans"
	| "impact";

/** Valori CSS effettivi per ciascuna opzione di font (stringa vuota = eredita il font del tema).
 * Ogni font "reale" ha una catena di fallback sicura: se non è installato sul sistema,
 * il browser usa comunque la famiglia generica indicata per ultima, invece di un font casuale. */
export const FONT_FAMILY_CSS: Record<QnbFontFamily, string> = {
	default: "",
	sans: "sans-serif",
	serif: "serif",
	mono: "var(--font-monospace)",
	cursive: "cursive",
	fantasy: "fantasy",
	arial: "Arial, Helvetica, sans-serif",
	georgia: "Georgia, serif",
	times: "'Times New Roman', Times, serif",
	courier: "'Courier New', Courier, monospace",
	verdana: "Verdana, Geneva, sans-serif",
	trebuchet: "'Trebuchet MS', sans-serif",
	palatino: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
	garamond: "Garamond, serif",
	comicsans: "'Comic Sans MS', 'Comic Sans', cursive",
	impact: "Impact, Haettenschweiler, sans-serif",
};

const VALID_FONT_FAMILIES: QnbFontFamily[] = [
	"default",
	"sans",
	"serif",
	"mono",
	"cursive",
	"fantasy",
	"arial",
	"georgia",
	"times",
	"courier",
	"verdana",
	"trebuchet",
	"palatino",
	"garamond",
	"comicsans",
	"impact",
];

export interface QuickNote {
	id: string;
	title: string;
	category: string;
	/** Id del gruppo (o sottogruppo, a qualunque livello) a cui appartiene la nota; stringa vuota = nessun gruppo. */
	groupId: string;
	content: string;
	x: number;
	y: number;
	w: number;
	h: number;
	fontSize: number;
	fontFamily: QnbFontFamily;
	fontColor: string;
	bgColor: string;
	deleted: boolean;
	hidden: boolean;
	archived: boolean;
	/** Se true, "content" contiene il blob cifrato (vedi crypto.ts), non markdown in chiaro. */
	encrypted: boolean;
	/** Se true, la nota è sempre visibile e in primo piano: ignora "Tutte" e il nascondere per categoria/gruppo. */
	pinned: boolean;
	/** Timestamp (ms) di creazione e dell'ultima modifica del testo (non di posizione/categoria/ecc.). */
	createdAt: number;
	/** Nota "preferita": compare nella riga dedicata in toolbar (se la funzione è attiva). */
	favorite: boolean;
	/** Scadenza e avviso, tutti opzionali: assenti = nessuna scadenza impostata. */
	dueDate?: string; // "YYYY-MM-DD"
	reminderStartDate?: string; // "YYYY-MM-DD"
	reminderStartTime?: string; // "HH:MM"
	/** Se presente (e non vuoto), la nota usa "più orari nello stesso giorno" invece del
	 * singolo reminderStartTime: un allarme separato per ognuno, stesso giorno. Quando
	 * attivo, reminderStartTime viene ignorato. */
	reminderStartTimes?: string[];
	reminderIntervalMinutes?: number;
	/** Ripetizione: assente = nessuna. "reminderRepeatEvery" si usa solo con weekly/monthly. */
	reminderRepeat?: "daily" | "weekly" | "monthly" | "yearly";
	reminderRepeatEvery?: number;
	/** Se true, l'allarme (notifica, suono, bordo lampeggiante) non scatta mai di sabato
	 * o domenica, qualunque sia la ripetizione impostata. */
	skipWeekends?: boolean;
	/** Id delle etichette assegnate a questa nota (elenco piatto, definito in
	 * Impostazioni). Una nota può averne quante ne vuole insieme. */
	labelIds?: string[];
	modifiedAt: number;
}

export const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_FONT_FAMILY: QnbFontFamily = "default";
/** Stringa vuota = eredita il colore testo del tema. */
export const DEFAULT_FONT_COLOR = "";
/** Stringa vuota = eredita il colore di sfondo del tema. */
export const DEFAULT_BG_COLOR = "";

/** Ritorna "#111111" o "#ffffff" a seconda di quale contrasta meglio col colore di sfondo dato (hex). */
export function getContrastTextColor(hex: string): string {
	const clean = hex.replace("#", "");
	if (clean.length !== 6) return "#ffffff";
	const r = parseInt(clean.substring(0, 2), 16);
	const g = parseInt(clean.substring(2, 4), 16);
	const b = parseInt(clean.substring(4, 6), 16);
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance > 0.6 ? "#111111" : "#ffffff";
}

/** Decodifica il nome del gruppo salvato nel file; in caso di dato corrotto, ripiega su "nessun gruppo" invece di far fallire il caricamento dell'intera nota. */
function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch (e) {
		return "";
	}
}

/** Interpreta cre=/mod= letti dal file: le versioni precedenti del plugin salvavano i
 * millisecondi, la versione attuale salva i secondi (file più leggero). Un valore così
 * grande da essere già "troppo preciso" per essere in secondi per una data recente viene
 * riconosciuto automaticamente come millisecondi, mantenendo la compatibilità con i file
 * già salvati senza bisogno di alcuna migrazione esplicita. */
function parseTimestamp(raw: string | undefined): number {
	if (!raw) return Date.now();
	const value = parseInt(raw, 10);
	if (!Number.isFinite(value)) return Date.now();
	return value > 1e11 ? value : value * 1000;
}

/** Prefisso riconoscibile: distingue un id di gruppo "moderno" da un vecchio nome
 * codificato con encodeURIComponent (formato usato prima dei sottogruppi), durante
 * il parsing di note salvate da una versione precedente del plugin. */
const GROUP_ID_PREFIX = "grp_";

function generateGroupId(): string {
	return GROUP_ID_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Legge un valore di provenienza sconosciuta (dati salvati, potenzialmente da una
 * versione precedente o modificati a mano) come un oggetto semplice, senza mai
 * assumerne la forma: un oggetto vuoto se non lo è davvero. Ogni proprietà letta da qui
 * resta "unknown" finché non viene controllata esplicitamente (typeof/Array.isArray),
 * invece di propagare "any" nel resto del codice. */
function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Completa ricorsivamente i gruppi caricati da versioni precedenti (senza id o
 * senza array "groups"), senza mai perdere quelli già validi. */
function normalizeGroups(raw: unknown): QnbGroup[] {
	if (!Array.isArray(raw)) return [];
	return (raw as unknown[]).map((item) => {
		const g = asRecord(item);
		return {
			id: typeof g.id === "string" && g.id ? g.id : generateGroupId(),
			name: typeof g.name === "string" ? g.name : "",
			groups: normalizeGroups(g.groups),
		};
	});
}

const KNOWN_NOTE_ICON_IDS = new Set<string>(DEFAULT_NOTE_ICON_ORDER.map((cfg) => cfg.id));

/** Ripulisce l'ordine icone salvato: scarta eventuali id sconosciuti (es. una versione
 * precedente del plugin, o un file modificato a mano), e aggiunge in fondo — visibili di
 * default — le icone note mancanti dall'elenco salvato (es. una nuova icona introdotta
 * da un aggiornamento del plugin dopo che l'utente aveva già personalizzato l'ordine). */
function normalizeNoteIconOrder(raw: unknown): QnbNoteIconConfig[] {
	const result: QnbNoteIconConfig[] = [];
	const seen = new Set<string>();
	if (Array.isArray(raw)) {
		for (const item of raw as unknown[]) {
			const entry = asRecord(item);
			const id = entry.id;
			if (typeof id === "string" && KNOWN_NOTE_ICON_IDS.has(id) && !seen.has(id)) {
				seen.add(id);
				result.push({ id: id as QnbNoteIconId, visible: entry.visible !== false });
			}
		}
	}
	for (const cfg of DEFAULT_NOTE_ICON_ORDER) {
		if (!seen.has(cfg.id)) result.push({ ...cfg });
	}
	return result;
}

const DATA_FILE_NAME = "Quick notes board.md";
const DEFAULT_CATEGORY = "Generale";
const BACKGROUND_BASENAME = "board-background";

/** Forma del file dati del plugin (data.json), per evitare che il tipo "any" restituito
 * da loadData()/saveData() dell'API Obsidian si propaghi in giro nel codice: un unico
 * cast esplicito al confine, invece di lasciarlo implicito ovunque. */
interface QnbPluginDataFile {
	settings?: Record<string, unknown>;
	[key: string]: unknown;
}

export default class QuickNotesBoardPlugin extends Plugin {
	notes: QuickNote[] = [];
	settings: QuickNotesBoardSettings = DEFAULT_SETTINGS;
	/** Ultimo avviso di scadenza inviato per nota (solo in memoria: non sopravvive alla
	 * chiusura di Obsidian, come concordato). */
	private dueReminderLastFired = new Map<string, number>();
	/** Per le note con "più orari nello stesso giorno": quali orari (HH:MM) sono già
	 * stati "risolti" (fermati) oggi per quella nota, così non risuonano subito di nuovo
	 * per lo stesso slot — solo al prossimo orario della lista. Si azzera da solo quando
	 * cambia il giorno (confronto sulla data salvata insieme). Solo in memoria. */
	private resolvedAlarmSlots = new Map<string, { date: string; times: Set<string> }>();
	/** true se il file dati risulta compresso ma non decomprimibile (danneggiato): in
	 * questo stato saveNotes() si rifiuta di scrivere, per non perdere i dati originali. */
	private dataFileCorrupted = false;
	/** Audio dell'allarme attualmente in loop per nota (finché non viene fermato). */
	private activeDueAlarms = new Map<string, HTMLAudioElement>();

	tr(key: string, vars?: Record<string, string>): string {
		return t(this.settings.language, key, vars);
	}

	async onload() {
		// Le impostazioni (lingua compresa) vanno caricate PRIMA delle note, così
		// eventuali testi di default usati durante il parsing sono nella lingua giusta.
		await this.loadSettings();
		await this.loadNotes();

		this.registerView(
			VIEW_TYPE_QNB,
			(leaf: WorkspaceLeaf) => new QuickNotesBoardView(leaf, this)
		);

		this.addSettingTab(new QuickNotesBoardSettingTab(this.app, this));

		this.addRibbonIcon("layout-dashboard", this.tr("ribbon.open"), () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-board",
			name: this.tr("command.open"),
			callback: () => void this.activateView(),
		});

		// Avvisi di scadenza: girano a livello di plugin (non della vista), così
		// continuano a scattare anche a pannello board chiuso, finché Obsidian resta
		// aperto. registerInterval lo ripulisce da solo alla disattivazione del plugin.
		// 5 secondi (non più 30): bordo e allarme sonoro restano quindi sempre entro
		// pochi secondi dal momento esatto in cui la nota entra/esce dalla finestra di
		// allarme, invece di poter apparire con fino a mezzo minuto di scarto tra loro.
		this.checkDueReminders();
		this.registerInterval(window.setInterval(() => this.checkDueReminders(), 5000));
	}

	onunload() {
		// Nulla da ripulire: i dati sono già salvati su file ad ogni modifica.
	}

	async activateView() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_QNB);

		if (existing.length > 0) {
			// Già aperta: il click la chiude (stesso comportamento sia dal ribbon
			// icon sia dal comando), invece di limitarsi a portarla in primo piano.
			for (const leaf of existing) leaf.detach();
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_QNB, active: true });
		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		const data = ((await this.loadData()) as QnbPluginDataFile | null) || {};
		const stored: Partial<QuickNotesBoardSettings> & {
			deleteSoundFileName?: string;
			minimizeSoundFileName?: string;
		} = (data.settings as typeof stored) || {};
		const rawCategories =
			stored.categories && stored.categories.length > 0
				? stored.categories
				: DEFAULT_SETTINGS.categories.map((c) => ({ ...c }));

		// Le categorie salvate da versioni precedenti del plugin possono non avere ancora
		// i campi introdotti più di recente (titleColor/icon/iconColor/groups): completarli
		// qui evita che il pannello impostazioni si blocchi a metà provando a leggerli.
		const normalizedCategories = rawCategories.map((c) => ({
			name: c.name,
			color: c.color,
			titleColor: c.titleColor ?? "",
			icon: c.icon ?? "",
			iconColor: c.iconColor ?? "",
			groups: normalizeGroups(c.groups),
		}));

		this.settings = {
			...DEFAULT_SETTINGS,
			...stored,
			categories: normalizedCategories,
			soundFiles: { ...(stored.soundFiles || {}) },
			noteIconOrder: normalizeNoteIconOrder(stored.noteIconOrder),
		};

		// Migrazione da una versione precedente del plugin, che aveva solo due suoni fissi.
		if (stored.deleteSoundFileName && !this.settings.soundFiles["note-delete"]) {
			this.settings.soundFiles["note-delete"] = stored.deleteSoundFileName;
		}
		if (stored.minimizeSoundFileName && !this.settings.soundFiles["note-minimize"]) {
			this.settings.soundFiles["note-minimize"] = stored.minimizeSoundFileName;
		}
	}

	async saveSettings() {
		const data = ((await this.loadData()) as QnbPluginDataFile | null) || {};
		data.settings = this.settings as unknown as Record<string, unknown>;
		await this.saveData(data);
	}

	refreshOpenViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QNB)) {
			const view = leaf.view as QuickNotesBoardView;
			view.refresh();
		}
	}

	/** Ritorna l'URL utilizzabile in CSS per l'immagine di sfondo corrente, o null se non impostata. */
	getBackgroundResourcePath(): string | null {
		if (!this.settings.backgroundFileName) return null;
		const path = normalizePath(`${this.manifest.dir}/${this.settings.backgroundFileName}`);
		return this.app.vault.adapter.getResourcePath(path);
	}

	async setBackgroundImage(buffer: ArrayBuffer, extension: string) {
		await this.removeBackgroundFiles();
		const fileName = `${BACKGROUND_BASENAME}.${extension}`;
		const path = normalizePath(`${this.manifest.dir}/${fileName}`);
		await this.app.vault.adapter.writeBinary(path, buffer);
		this.settings.backgroundFileName = fileName;
		this.settings.backgroundMode = "image";
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async clearBackgroundImage() {
		await this.removeBackgroundFiles();
		this.settings.backgroundFileName = "";
		if (this.settings.backgroundMode === "image") {
			this.settings.backgroundMode = "none";
		}
		await this.saveSettings();
		this.refreshOpenViews();
	}

	/** Ritorna l'URL utilizzabile per riprodurre il suono impostato per l'evento dato, o null se non impostato. */
	getSoundResourcePath(eventId: QnbSoundEventId): string | null {
		const fileName = this.settings.soundFiles[eventId];
		if (!fileName) return null;
		const path = normalizePath(`${this.manifest.dir}/${fileName}`);
		return this.app.vault.adapter.getResourcePath(path);
	}

	/** Imposta (o rimuove, con stringa vuota) il file audio da usare per l'evento dato.
	 * Il file DEVE già esistere nella cartella del plugin: non viene copiato né gestito
	 * qui, così più eventi possono condividere lo stesso file senza duplicati. */
	async setEventSoundFile(eventId: QnbSoundEventId, fileName: string) {
		if (fileName) {
			this.settings.soundFiles[eventId] = fileName;
		} else {
			delete this.settings.soundFiles[eventId];
		}
		await this.saveSettings();
	}

	/** Riproduce il suono impostato per l'evento dato (silenzioso se non impostato). */
	playSound(eventId: QnbSoundEventId) {
		const resourcePath = this.getSoundResourcePath(eventId);
		if (!resourcePath) return;
		try {
			const audio = new Audio(resourcePath);
			audio.volume = 0.6;
			// Alcuni ambienti bloccano la riproduzione automatica: ignora l'errore, non è critico.
			audio.play().catch(() => {});
		} catch (e) {
			console.error("Quick Notes Board: errore nella riproduzione del suono", e);
		}
	}

	async setBackgroundColor(hex: string) {
		this.settings.backgroundColor = hex;
		this.settings.backgroundMode = "color";
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setBackgroundMode(mode: "none" | "image" | "color") {
		this.settings.backgroundMode = mode;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setLanguage(lang: QnbLang) {
		this.settings.language = lang;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setFullscreenMode(enabled: boolean) {
		this.settings.fullscreenMode = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setCollapseNoteIcons(enabled: boolean) {
		this.settings.collapseNoteIcons = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setRequireDoubleClickToEdit(enabled: boolean) {
		this.settings.requireDoubleClickToEdit = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setDueDateBorderColor(color: string) {
		this.settings.dueDateBorderColor = color;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setNoteIconOrder(order: QnbNoteIconConfig[]) {
		this.settings.noteIconOrder = order;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setLabels(labels: QnbLabel[]) {
		this.settings.labels = labels;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setDragSettleAnimation(enabled: boolean) {
		this.settings.dragSettleAnimation = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setHoverLiftEffect(enabled: boolean) {
		this.settings.hoverLiftEffect = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setHoverLiftDurationSeconds(seconds: number) {
		this.settings.hoverLiftDurationSeconds = seconds;
		await this.saveSettings();
	}

	async setChecklistProgressBar(enabled: boolean) {
		this.settings.checklistProgressBar = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setChecklistProgressBarColorStart(color: string) {
		this.settings.checklistProgressBarColorStart = color;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setChecklistProgressBarColorEnd(color: string) {
		this.settings.checklistProgressBarColorEnd = color;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setChecklistProgressBarHeight(height: number) {
		this.settings.checklistProgressBarHeight = height;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setChecklistProgressBarCompleteColor(color: string) {
		this.settings.checklistProgressBarCompleteColor = color;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setChecklistProgressBarCompleteText(text: string) {
		this.settings.checklistProgressBarCompleteText = text;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setChecklistProgressCompleteDelaySeconds(seconds: number) {
		this.settings.checklistProgressCompleteDelaySeconds = seconds;
		await this.saveSettings();
	}

	async setAlwaysOnNoteShadow(enabled: boolean) {
		this.settings.alwaysOnNoteShadow = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setNoteShadowIntensity(value: number) {
		this.settings.noteShadowIntensity = value;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setActivityChartNotesColor(color: string) {
		this.settings.activityChartNotesColor = color;
		await this.saveSettings();
	}

	async setActivityChartCharsColor(color: string) {
		this.settings.activityChartCharsColor = color;
		await this.saveSettings();
	}

	/** Ricorda la dimensione scelta dall'utente ridimensionando manualmente la finestra
	 * "Andamento della board", entro limiti minimi/massimi di sicurezza. */
	async setActivityChartWindowSize(width: number, height: number) {
		this.settings.activityChartWindowWidth = Math.min(3000, Math.max(480, Math.round(width)));
		this.settings.activityChartWindowHeight = Math.min(2000, Math.max(400, Math.round(height)));
		await this.saveSettings();
	}

	async setBoardStructureWindowSize(width: number, height: number) {
		this.settings.boardStructureWindowWidth = Math.min(3000, Math.max(480, Math.round(width)));
		this.settings.boardStructureWindowHeight = Math.min(2000, Math.max(400, Math.round(height)));
		await this.saveSettings();
	}

	async setConvertedNotesFolder(folder: string) {
		this.settings.convertedNotesFolder = folder;
		await this.saveSettings();
	}

	async setDefaultNoteSize(width: number, height: number) {
		this.settings.defaultNoteWidth = width;
		this.settings.defaultNoteHeight = height;
		await this.saveSettings();
	}

	async setLockedNotePlaceholder(message: string) {
		this.settings.lockedNotePlaceholder = message;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setUseFavorites(enabled: boolean) {
		this.settings.useFavorites = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async setFavoriteChipFullTitle(enabled: boolean) {
		this.settings.favoriteChipFullTitle = enabled;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	getCategoryColor(name: string): string | undefined {
		return this.settings.categories.find((c) => c.name === name)?.color;
	}

	getCategoryTitleColor(name: string): string | undefined {
		return this.settings.categories.find((c) => c.name === name)?.titleColor || undefined;
	}

	getCategoryIcon(name: string): string | undefined {
		return this.settings.categories.find((c) => c.name === name)?.icon || undefined;
	}

	getCategoryIconColor(name: string): string | undefined {
		return this.settings.categories.find((c) => c.name === name)?.iconColor || undefined;
	}

	async addCategory(name: string, color: string) {
		const trimmed = name.trim();
		if (!trimmed) return;
		if (this.settings.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return;
		this.settings.categories.push({ name: trimmed, color, titleColor: "", icon: "", iconColor: "", groups: [] });
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async updateCategoryColor(name: string, color: string) {
		const cat = this.settings.categories.find((c) => c.name === name);
		if (!cat) return;
		cat.color = color;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async updateCategoryTitleColor(name: string, titleColor: string) {
		const cat = this.settings.categories.find((c) => c.name === name);
		if (!cat) return;
		cat.titleColor = titleColor;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async updateCategoryIcon(name: string, icon: string) {
		const cat = this.settings.categories.find((c) => c.name === name);
		if (!cat) return;
		cat.icon = icon;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async updateCategoryIconColor(name: string, iconColor: string) {
		const cat = this.settings.categories.find((c) => c.name === name);
		if (!cat) return;
		cat.iconColor = iconColor;
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async renameCategory(oldName: string, newName: string) {
		const trimmed = newName.trim();
		if (!trimmed || trimmed === oldName) return;
		const cat = this.settings.categories.find((c) => c.name === oldName);
		if (!cat) return;
		if (this.settings.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase() && c !== cat)) return;

		cat.name = trimmed;

		let notesChanged = false;
		for (const note of this.notes) {
			if (note.category === oldName) {
				note.category = trimmed;
				notesChanged = true;
			}
		}

		await this.saveSettings();
		if (notesChanged) await this.saveNotes();
		this.refreshOpenViews();
	}

	async removeCategory(name: string) {
		this.settings.categories = this.settings.categories.filter((c) => c.name !== name);
		await this.saveSettings();
		this.refreshOpenViews();
	}

	getCategoryGroups(categoryName: string): QnbGroup[] {
		return this.settings.categories.find((c) => c.name === categoryName)?.groups || [];
	}

	/** Trova un gruppo (a qualunque livello) dentro l'albero di una categoria, insieme
	 * all'array di "fratelli" in cui vive (per poterlo rinominare/rimuovere) e alla sua
	 * profondità (1 = gruppo di primo livello, sotto la categoria direttamente). */
	private locateGroup(
		groups: QnbGroup[],
		groupId: string,
		depth = 1
	): { group: QnbGroup; siblings: QnbGroup[]; depth: number } | undefined {
		for (const g of groups) {
			if (g.id === groupId) return { group: g, siblings: groups, depth };
			const found = this.locateGroup(g.groups, groupId, depth + 1);
			if (found) return found;
		}
		return undefined;
	}

	private collectGroupAndDescendantIds(group: QnbGroup): Set<string> {
		const ids = new Set<string>();
		const walk = (g: QnbGroup) => {
			ids.add(g.id);
			for (const child of g.groups) walk(child);
		};
		walk(group);
		return ids;
	}

	/** Id del gruppo dato più tutti i suoi sottogruppi a qualunque profondità: usato per
	 * il comportamento "a cascata" (nascondere un gruppo nasconde anche i suoi sotto-livelli). */
	getGroupAndDescendantIds(categoryName: string, groupId: string): Set<string> {
		const cat = this.settings.categories.find((c) => c.name === categoryName);
		if (!cat) return new Set([groupId]);
		const loc = this.locateGroup(cat.groups, groupId);
		if (!loc) return new Set([groupId]);
		return this.collectGroupAndDescendantIds(loc.group);
	}

	private findGroupPath(groups: QnbGroup[], groupId: string, path: string[] = []): string[] | undefined {
		for (const g of groups) {
			const newPath = [...path, g.name];
			if (g.id === groupId) return newPath;
			const found = this.findGroupPath(g.groups, groupId, newPath);
			if (found) return found;
		}
		return undefined;
	}

	/** Percorso leggibile del gruppo/sottogruppo di una nota, es. "Progetto A > Urgente".
	 * Stringa vuota se la nota non appartiene a nessun gruppo (o il gruppo non esiste più). */
	getGroupPath(categoryName: string, groupId: string): string {
		if (!groupId) return "";
		const cat = this.settings.categories.find((c) => c.name === categoryName);
		if (!cat) return "";
		const path = this.findGroupPath(cat.groups, groupId);
		return path ? path.join(" > ") : "";
	}

	/** Istante da cui parte l'avviso: data/ora di inizio se specificate, altrimenti
	 * mezzanotte del giorno di scadenza (avviso attivo fin da subito). */
	private getReminderStart(note: QuickNote): Date {
		const date = note.reminderStartDate || note.dueDate || "";
		const time = note.reminderStartTime || "00:00";
		return new Date(`${date}T${time}:00`);
	}

	/** Vero se la nota ha una scadenza impostata e siamo dentro la sua finestra di
	 * avviso. Con un solo orario: da inizio avviso a fine del giorno di scadenza, come
	 * sempre. Con "più orari nello stesso giorno": vero se almeno uno degli orari di
	 * oggi è già passato e non ancora risolto (fermato) oggi — condivisa tra il
	 * controllo periodico che invia gli avvisi e il bordo visivo sulla board. */
	isNoteDueActive(note: QuickNote): boolean {
		if (!note.dueDate || note.deleted || note.archived) return false;
		const now = new Date();
		if (note.skipWeekends) {
			const dayOfWeek = now.getDay(); // 0 = domenica, 6 = sabato
			if (dayOfWeek === 0 || dayOfWeek === 6) return false;
		}

		if (note.reminderStartTimes && note.reminderStartTimes.length > 0) {
			const startDate = note.reminderStartDate || note.dueDate;
			const todayStr = this.getTodayDateStr();
			// Confronto testuale su date in formato YYYY-MM-DD: funziona correttamente
			// come confronto cronologico, senza bisogno di crearne oggetti Date.
			if (todayStr < startDate || todayStr > note.dueDate) return false;

			const resolved = this.getResolvedSlotsForToday(note.id);
			const nowHHMM = this.getCurrentHHMM();
			return note.reminderStartTimes.some((t) => t <= nowHHMM && !resolved.has(t));
		}

		const start = this.getReminderStart(note);
		const end = new Date(`${note.dueDate}T23:59:59`);
		return now.getTime() >= start.getTime() && now.getTime() <= end.getTime();
	}

	private getTodayDateStr(): string {
		const now = new Date();
		const y = now.getFullYear();
		const m = String(now.getMonth() + 1).padStart(2, "0");
		const d = String(now.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}

	private getCurrentHHMM(): string {
		const now = new Date();
		return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	}

	/** Gli orari (HH:MM) già risolti oggi per questa nota, per il sistema "più orari nello
	 * stesso giorno" — si azzera da solo (nuovo Set vuoto) quando cambia il giorno
	 * rispetto all'ultima volta registrata. */
	private getResolvedSlotsForToday(noteId: string): Set<string> {
		const todayStr = this.getTodayDateStr();
		const entry = this.resolvedAlarmSlots.get(noteId);
		if (!entry || entry.date !== todayStr) {
			const fresh = { date: todayStr, times: new Set<string>() };
			this.resolvedAlarmSlots.set(noteId, fresh);
			return fresh.times;
		}
		return entry.times;
	}

	/** Gira a intervalli regolari finché il plugin è attivo (non la sola vista board):
	 * per ogni nota in finestra di avviso, invia notifica + suono. Con un solo orario,
	 * ripete ogni "tot minuti" impostato finché non fermata (comportamento di sempre).
	 * Con più orari, nessuna attesa: se isNoteDueActive è vero c'è uno slot non ancora
	 * risolto oggi, quindi suona subito — il "non suonare finché non arriva il prossimo
	 * orario" lo garantisce già isNoteDueActive/i risolti di oggi. */
	private checkDueReminders() {
		// Aggiorna il bordo lampeggiante su ogni vista aperta ad OGNI controllo, non solo
		// quando scatta un nuovo avviso: così bordo e allarme sonoro sono sempre valutati
		// sulla stessa identica cadenza, invece che su due "orologi" diversi.
		this.refreshDueBordersInOpenViews();

		for (const note of this.notes) {
			if (!this.isNoteDueActive(note)) continue;
			if (this.activeDueAlarms.has(note.id)) continue; // già in corso, non sovrapporre

			const isMultiTime = !!(note.reminderStartTimes && note.reminderStartTimes.length > 0);
			if (!isMultiTime) {
				const last = this.dueReminderLastFired.get(note.id) ?? 0;
				const intervalMs = (note.reminderIntervalMinutes || 30) * 60000;
				if (Date.now() - last < intervalMs) continue;
				this.dueReminderLastFired.set(note.id, Date.now());
			}

			// Resta visibile anche se la sua categoria è nascosta, così non finisce
			// "invisibile" nemmeno se in questo momento nessuna vista è aperta.
			if (note.hidden) {
				note.hidden = false;
				void this.saveNotes();
			}

			// Notifica persistente (non sparisce da sola) + suono in loop: entrambi si
			// fermano solo cliccando la notifica stessa o l'icona allarme della nota.
			const notice = new Notice(this.tr("notice.dueReminder", { title: note.title }), 0);
			notice.noticeEl.addEventListener("click", () => this.stopDueAlarm(note.id));
			this.playDueAlarmLoop(note.id);
			this.focusDueNoteInOpenViews(note.id);
		}
	}

	/** Aggiorna solo la classe del bordo lampeggiante sulle note già a schermo, su ogni
	 * vista aperta — leggero, non ricostruisce nulla, non interrompe eventuali modifiche
	 * in corso. */
	private refreshDueBordersInOpenViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QNB)) {
			(leaf.view as QuickNotesBoardView).refreshDueBorders();
		}
	}

	/** Avvia il suono di allarme in loop per una nota, tracciandolo per poterlo fermare
	 * più avanti (click sulla notifica o sull'icona allarme della nota). */
	private playDueAlarmLoop(noteId: string) {
		this.stopDueAlarm(noteId);
		const resourcePath = this.getSoundResourcePath("note-due-reminder");
		if (!resourcePath) return;
		try {
			const audio = new Audio(resourcePath);
			audio.volume = 0.6;
			audio.loop = true;
			audio.play().catch(() => {});
			this.activeDueAlarms.set(noteId, audio);
		} catch (e) {
			console.error("Quick Notes Board: errore nella riproduzione del suono", e);
		}
	}

	/** Ferma il suono di allarme in loop di una nota, se in corso. Per le note con "più
	 * orari nello stesso giorno", segna anche come risolti tutti gli orari di oggi già
	 * passati fino ad ora: così non risuona subito per lo stesso slot, solo al prossimo
	 * orario della lista (anche se più di uno era rimasto in sospeso insieme). */
	stopDueAlarm(noteId: string) {
		const audio = this.activeDueAlarms.get(noteId);
		if (!audio) return;
		audio.pause();
		audio.currentTime = 0;
		this.activeDueAlarms.delete(noteId);

		const note = this.notes.find((n) => n.id === noteId);
		if (note?.reminderStartTimes && note.reminderStartTimes.length > 0) {
			const resolved = this.getResolvedSlotsForToday(noteId);
			const nowHHMM = this.getCurrentHHMM();
			for (const t of note.reminderStartTimes) {
				if (t <= nowHHMM) resolved.add(t);
			}
		}
	}

	/** Se una vista della board è aperta, porta la nota in primo piano ed evidenziata. */
	private focusDueNoteInOpenViews(noteId: string) {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QNB)) {
			(leaf.view as QuickNotesBoardView).focusNote(noteId);
		}
	}

	/** Aggiunge un gruppo di primo livello (parentGroupId nullo) o un sottogruppo
	 * (parentGroupId = id del gruppo padre). Rifiuta se si supererebbe MAX_GROUP_DEPTH. */
	async addGroup(categoryName: string, parentGroupId: string | null, name: string) {
		const trimmed = name.trim();
		if (!trimmed) return;
		const cat = this.settings.categories.find((c) => c.name === categoryName);
		if (!cat) return;

		let targetArray: QnbGroup[];
		if (parentGroupId === null) {
			targetArray = cat.groups;
		} else {
			const loc = this.locateGroup(cat.groups, parentGroupId);
			if (!loc || loc.depth >= MAX_GROUP_DEPTH) return;
			targetArray = loc.group.groups;
		}

		if (targetArray.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) return;
		targetArray.push({ id: generateGroupId(), name: trimmed, groups: [] });
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async renameGroup(categoryName: string, groupId: string, newName: string) {
		const trimmed = newName.trim();
		if (!trimmed) return;
		const cat = this.settings.categories.find((c) => c.name === categoryName);
		if (!cat) return;
		const loc = this.locateGroup(cat.groups, groupId);
		if (!loc) return;
		if (trimmed === loc.group.name) return;
		if (loc.siblings.some((g) => g.id !== groupId && g.name.toLowerCase() === trimmed.toLowerCase())) return;

		loc.group.name = trimmed;
		await this.saveSettings();
		// Le note si riferiscono al gruppo per id: rinominarlo non richiede di toccarle.
		this.refreshOpenViews();
	}

	/** Sposta un gruppo (o sottogruppo) a un'altra posizione, sempre tra i suoi soli
	 * "fratelli" allo stesso livello — non lo sposta mai sotto un genitore diverso. */
	async reorderGroup(categoryName: string, groupId: string, toIndex: number) {
		const cat = this.settings.categories.find((c) => c.name === categoryName);
		if (!cat) return;
		const loc = this.locateGroup(cat.groups, groupId);
		if (!loc) return;

		const fromIndex = loc.siblings.indexOf(loc.group);
		if (fromIndex === -1 || fromIndex === toIndex || toIndex < 0 || toIndex >= loc.siblings.length) return;

		const [moved] = loc.siblings.splice(fromIndex, 1);
		loc.siblings.splice(toIndex, 0, moved);
		await this.saveSettings();
		this.refreshOpenViews();
	}

	async removeGroup(categoryName: string, groupId: string) {
		const cat = this.settings.categories.find((c) => c.name === categoryName);
		if (!cat) return;
		const loc = this.locateGroup(cat.groups, groupId);
		if (!loc) return;

		// Rimuove anche tutti i sottogruppi al suo interno: le note in uno qualunque
		// di essi tornano "senza gruppo" invece di restare agganciate a un id sparito.
		const idsToClear = this.collectGroupAndDescendantIds(loc.group);
		const idx = loc.siblings.indexOf(loc.group);
		if (idx !== -1) loc.siblings.splice(idx, 1);

		let notesChanged = false;
		for (const note of this.notes) {
			if (note.category === categoryName && idsToClear.has(note.groupId)) {
				note.groupId = "";
				notesChanged = true;
			}
		}

		await this.saveSettings();
		if (notesChanged) await this.saveNotes();
		this.refreshOpenViews();
	}

	/** Sposta la categoria dall'indice fromIndex all'indice toIndex, cambiando l'ordine
	 * personalizzato usato sia in questo pannello sia dai pulsanti categoria in toolbar. */
	async reorderCategories(fromIndex: number, toIndex: number) {
		const cats = this.settings.categories;
		if (
			fromIndex === toIndex ||
			fromIndex < 0 ||
			fromIndex >= cats.length ||
			toIndex < 0 ||
			toIndex >= cats.length
		) {
			return;
		}
		const [moved] = cats.splice(fromIndex, 1);
		cats.splice(toIndex, 0, moved);
		await this.saveSettings();
		this.refreshOpenViews();
	}

	private async removeBackgroundFiles() {
		const adapter = this.app.vault.adapter;
		for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
			const path = normalizePath(`${this.manifest.dir}/${BACKGROUND_BASENAME}.${ext}`);
			if (await adapter.exists(path)) {
				await adapter.remove(path);
			}
		}
	}

	private getDataFilePath(): string {
		return normalizePath(`${this.manifest.dir}/${DATA_FILE_NAME}`);
	}

	/** Data di creazione/ultima modifica e dimensione (byte) del file dati della board. */
	async getNotesFileStat(): Promise<{ ctime: number; mtime: number; size: number } | null> {
		try {
			const stat = await this.app.vault.adapter.stat(this.getDataFilePath());
			return stat ? { ctime: stat.ctime, mtime: stat.mtime, size: stat.size } : null;
		} catch (e) {
			console.error("Quick Notes Board: errore nel leggere le informazioni del file dati", e);
			return null;
		}
	}

	async loadNotes() {
		const path = this.getDataFilePath();
		const adapter = this.app.vault.adapter;

		try {
			const exists = await adapter.exists(path);
			if (!exists) {
				this.notes = [];
				this.dataFileCorrupted = false;
				return;
			}
			const raw = await adapter.read(path);

			let content: string;
			if (raw.startsWith(COMPRESSION_MARKER)) {
				try {
					content = await decompressText(raw.slice(COMPRESSION_MARKER.length));
				} catch (decompressError) {
					// File compresso ma illeggibile (danneggiato): non proseguiamo come se
					// fosse vuoto, altrimenti il prossimo salvataggio scriverebbe sopra dati
					// ancora presenti sul disco, perdendoli per sempre. Ci fermiamo e avvisiamo.
					console.error(
						"Quick Notes Board: file dati compresso ma non decomprimibile",
						decompressError
					);
					this.dataFileCorrupted = true;
					this.notes = [];
					new Notice(this.tr("notice.corruptedDataFile"), 0);
					return;
				}
			} else {
				content = raw;
			}

			this.dataFileCorrupted = false;
			this.notes = this.parseNotesFile(content);
		} catch (e) {
			console.error("Quick Notes Board: errore nel caricamento del file dati", e);
			this.notes = [];
		}
	}

	async saveNotes() {
		if (this.dataFileCorrupted) {
			// Non scriviamo mai sopra un file che non siamo riusciti a leggere
			// correttamente: i dati originali restano intatti sul disco finché il
			// problema non viene risolto (o il file sostituito manualmente).
			return;
		}

		const path = this.getDataFilePath();
		const adapter = this.app.vault.adapter;

		// Assicura che la cartella del plugin esista (di norma esiste già).
		const dir = this.manifest.dir;
		if (dir && !(await adapter.exists(dir))) {
			await adapter.mkdir(dir);
		}

		const content = this.serializeNotesFile(this.notes);
		if (this.settings.compressionEnabled) {
			const compressed = await compressText(content);
			await adapter.write(path, COMPRESSION_MARKER + compressed);
		} else {
			await adapter.write(path, content);
		}
	}

	/** Dimensione su disco (così com'è salvato) e dimensione reale del contenuto (non
	 * compresso), per la finestra "Informazioni sulla board". null se il file compresso
	 * risultasse danneggiato (evita di mostrare numeri inventati). */
	async getNotesFileSizeInfo(): Promise<{ onDisk: number; real: number } | null> {
		if (this.dataFileCorrupted) return null;
		const stat = await this.getNotesFileStat();
		if (!stat) return null;
		const realContent = this.serializeNotesFile(this.notes);
		const real = new TextEncoder().encode(realContent).length;
		return { onDisk: stat.size, real };
	}

	/** Attiva/disattiva la compressione e riscrive SUBITO il file nel nuovo formato: non
	 * resta mai "a metà" in attesa del prossimo salvataggio qualsiasi. */
	async setCompressionEnabled(enabled: boolean) {
		this.settings.compressionEnabled = enabled;
		await this.saveSettings();
		await this.saveNotes();
	}

	/** Interpreta l'attributo grp= del file: nel formato attuale è già un id di gruppo;
	 * nel formato usato prima dei sottogruppi era un nome codificato con
	 * encodeURIComponent, cercato solo tra i gruppi di primo livello (l'unico livello
	 * che esisteva allora) della categoria della nota. */
	private resolveGroupIdFromFile(categoryName: string, grpStr: string | undefined): string {
		if (!grpStr || grpStr === "none") return "";
		if (grpStr.startsWith(GROUP_ID_PREFIX)) return grpStr;

		const legacyName = safeDecodeURIComponent(grpStr);
		if (!legacyName) return "";
		const cat = this.settings.categories.find((c) => c.name === categoryName);
		const match = cat?.groups.find((g) => g.name === legacyName);
		return match ? match.id : "";
	}

	/** Analizza gli attributi "chiave=valore" di una riga %% QNB ... %%, in qualunque
	 * ordine si trovino: il riconoscimento non deve mai dipendere dall'ordine in cui li
	 * scriviamo, né oggi né in future versioni del plugin. */
	private parseAttrString(attrStr: string): Map<string, string> {
		const map = new Map<string, string>();
		for (const token of attrStr.split(/\s+/)) {
			const eqIdx = token.indexOf("=");
			if (eqIdx === -1) continue;
			map.set(token.slice(0, eqIdx), token.slice(eqIdx + 1));
		}
		return map;
	}

	private parseNotesFile(raw: string): QuickNote[] {
		const notes: QuickNote[] = [];
		const lines = raw.split(/\r?\n/);

		let currentCategory = DEFAULT_CATEGORY;
		let i = 0;

		const categoryRe = /^##\s*Categoria:\s*(.+?)\s*$/;
		const startRe = /^%%\s*QNB\s+(.+?)\s*%%\s*$/;
		const endRe = /^%%\s*\/QNB\s*%%\s*$/;
		const titleRe = /^###\s?(.*)$/;

		while (i < lines.length) {
			const line = lines[i];

			const catMatch = line.match(categoryRe);
			if (catMatch) {
				currentCategory = catMatch[1].trim() || DEFAULT_CATEGORY;
				i++;
				continue;
			}

			const startMatch = line.match(startRe);
			if (startMatch) {
				const attrs = this.parseAttrString(startMatch[1]);
				const id = attrs.get("id");
				if (!id) {
					// Riga malformata (manca l'id): la ignoriamo prudentemente, come testo normale.
					i++;
					continue;
				}
				const xStr = attrs.get("x");
				const yStr = attrs.get("y");
				const wStr = attrs.get("w");
				const hStr = attrs.get("h");
				const fsStr = attrs.get("fs");
				const ffStr = attrs.get("ff");
				const fcStr = attrs.get("fc");
				const bgStr = attrs.get("bg");
				const delStr = attrs.get("del");
				const hidStr = attrs.get("hid");
				const arcStr = attrs.get("arc");
				const encStr = attrs.get("enc");
				const grpStr = attrs.get("grp");
				const pinStr = attrs.get("pin");
				const creStr = attrs.get("cre");
				const modStr = attrs.get("mod");
				const favStr = attrs.get("fav");
				const dueStr = attrs.get("due");
				const remStartDateStr = attrs.get("remstart");
				const remStartTimeStr = attrs.get("remtime");
				const remStartTimesStr = attrs.get("remtimes");
				const remIntervalStr = attrs.get("reminterval");
				const remRepeatStr = attrs.get("remrepeat");
				const remRepeatEveryStr = attrs.get("remrepeatevery");
				const remSkipWeekendsStr = attrs.get("remskipwe");
				const labelsStr = attrs.get("labels");
				i++;

				let title = "";
				if (i < lines.length) {
					const titleMatch = lines[i].match(titleRe);
					if (titleMatch) {
						title = titleMatch[1];
						i++;
					}
				}

				const bodyLines: string[] = [];
				while (i < lines.length && !endRe.test(lines[i])) {
					bodyLines.push(lines[i]);
					i++;
				}
				// consuma la riga di chiusura %% /QNB %%
				if (i < lines.length && endRe.test(lines[i])) {
					i++;
				}

				// rimuove eventuale riga vuota iniziale/finale del corpo
				while (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();
				while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();

				notes.push({
					id,
					title: title || this.tr("view.note.untitled"),
					category: currentCategory,
					content: bodyLines.join("\n"),
					x: parseInt(xStr ?? "", 10) || 0,
					y: parseInt(yStr ?? "", 10) || 0,
					w: parseInt(wStr ?? "", 10) || 260,
					h: parseInt(hStr ?? "", 10) || 180,
					fontSize: fsStr ? parseInt(fsStr, 10) || DEFAULT_FONT_SIZE : DEFAULT_FONT_SIZE,
					fontFamily: (ffStr && VALID_FONT_FAMILIES.includes(ffStr as QnbFontFamily)
						? (ffStr as QnbFontFamily)
						: DEFAULT_FONT_FAMILY),
					fontColor: fcStr && /^[0-9a-fA-F]{6}$/.test(fcStr) ? `#${fcStr}` : DEFAULT_FONT_COLOR,
					bgColor: bgStr && /^[0-9a-fA-F]{6}$/.test(bgStr) ? `#${bgStr}` : DEFAULT_BG_COLOR,
					deleted: delStr === "1",
					hidden: hidStr === "1",
					archived: arcStr === "1",
					encrypted: encStr === "1",
					groupId: this.resolveGroupIdFromFile(currentCategory, grpStr),
					pinned: pinStr === "1",
					createdAt: parseTimestamp(creStr),
					modifiedAt: parseTimestamp(modStr),
					favorite: favStr === "1",
					dueDate: dueStr || undefined,
					reminderStartDate: remStartDateStr || undefined,
					reminderStartTime: remStartTimeStr || undefined,
					reminderStartTimes: remStartTimesStr ? remStartTimesStr.split(",").filter((t) => t) : undefined,
					reminderIntervalMinutes: remIntervalStr ? parseInt(remIntervalStr, 10) || undefined : undefined,
					reminderRepeat:
						remRepeatStr === "daily" ||
						remRepeatStr === "weekly" ||
						remRepeatStr === "monthly" ||
						remRepeatStr === "yearly"
							? remRepeatStr
							: undefined,
					reminderRepeatEvery: remRepeatEveryStr ? parseInt(remRepeatEveryStr, 10) || undefined : undefined,
					skipWeekends: remSkipWeekendsStr === "1" ? true : undefined,
					labelIds: labelsStr ? labelsStr.split(",").filter((id) => id) : undefined,
				});
				continue;
			}

			i++;
		}

		return notes;
	}

	/** Dimensione in byte di una singola nota, così come verrebbe scritta su disco (stesso
	 * formato esatto usato per il file completo) — usata per esempio nella finestra
	 * Cestino, per mostrare quanto spazio occupa ogni nota e quanto se ne recupererebbe
	 * svuotandolo. */
	getNoteByteSize(note: QuickNote): number {
		return new TextEncoder().encode(this.serializeNotesFile([note])).length;
	}

	private serializeNotesFile(notes: QuickNote[]): string {
		const categories = new Map<string, QuickNote[]>();

		for (const note of notes) {
			const cat = note.category || DEFAULT_CATEGORY;
			if (!categories.has(cat)) categories.set(cat, []);
			categories.get(cat)!.push(note);
		}

		const sortedCategories = Array.from(categories.keys()).sort((a, b) =>
			a.localeCompare(b, "it")
		);

		const parts: string[] = [
			"<!-- File generato dal plugin Quick Notes Board. Puoi leggerlo, ma modificalo con cautela: la struttura %% QNB ... %% contiene i metadati di posizione. -->",
			"",
		];

		for (const cat of sortedCategories) {
			parts.push(`## Categoria: ${cat}`);
			parts.push("");
			for (const note of categories.get(cat)!) {
				const colorAttr =
					note.fontColor && /^#[0-9a-fA-F]{6}$/.test(note.fontColor)
						? note.fontColor.slice(1)
						: "default";
				const bgAttr =
					note.bgColor && /^#[0-9a-fA-F]{6}$/.test(note.bgColor) ? note.bgColor.slice(1) : "default";
				const groupAttr = note.groupId || "none";

				// Scrive solo gli attributi diversi dal valore di default: il parser li
				// reinterpreta correttamente come predefiniti anche quando mancano dal
				// file (è già così che leggiamo i file salvati da versioni precedenti),
				// quindi il file resta più leggero senza perdere alcuna informazione.
				const optionalAttrs: string[] = [];
				const fontSize = Math.round(note.fontSize || DEFAULT_FONT_SIZE);
				if (fontSize !== DEFAULT_FONT_SIZE) optionalAttrs.push(`fs=${fontSize}`);
				const fontFamily = note.fontFamily || DEFAULT_FONT_FAMILY;
				if (fontFamily !== DEFAULT_FONT_FAMILY) optionalAttrs.push(`ff=${fontFamily}`);
				if (colorAttr !== "default") optionalAttrs.push(`fc=${colorAttr}`);
				if (bgAttr !== "default") optionalAttrs.push(`bg=${bgAttr}`);
				if (note.deleted) optionalAttrs.push("del=1");
				if (note.hidden) optionalAttrs.push("hid=1");
				if (note.archived) optionalAttrs.push("arc=1");
				if (note.encrypted) optionalAttrs.push("enc=1");
				if (groupAttr !== "none") optionalAttrs.push(`grp=${groupAttr}`);
				if (note.pinned) optionalAttrs.push("pin=1");
				if (note.favorite) optionalAttrs.push("fav=1");
				if (note.dueDate) {
					optionalAttrs.push(`due=${note.dueDate}`);
					if (note.reminderStartDate) optionalAttrs.push(`remstart=${note.reminderStartDate}`);
					if (note.reminderStartTimes && note.reminderStartTimes.length > 0) {
						optionalAttrs.push(`remtimes=${note.reminderStartTimes.join(",")}`);
					} else if (note.reminderStartTime) {
						optionalAttrs.push(`remtime=${note.reminderStartTime}`);
					}
					if (note.reminderIntervalMinutes) optionalAttrs.push(`reminterval=${note.reminderIntervalMinutes}`);
					if (note.reminderRepeat) {
						optionalAttrs.push(`remrepeat=${note.reminderRepeat}`);
						if (note.reminderRepeatEvery) optionalAttrs.push(`remrepeatevery=${note.reminderRepeatEvery}`);
					}
					if (note.skipWeekends) optionalAttrs.push("remskipwe=1");
				}
				if (note.labelIds && note.labelIds.length > 0) {
					optionalAttrs.push(`labels=${note.labelIds.join(",")}`);
				}
				const attrsStr = optionalAttrs.length > 0 ? ` ${optionalAttrs.join(" ")}` : "";

				// Date in secondi (non millisecondi): precisione più che sufficiente per
				// uno strumento di appunti, e qualche carattere in meno per ogni nota.
				const createdSec = Math.round((note.createdAt || Date.now()) / 1000);
				const modifiedSec = Math.round((note.modifiedAt || Date.now()) / 1000);

				parts.push(
					`%% QNB id=${note.id} x=${Math.round(note.x)} y=${Math.round(note.y)} w=${Math.round(note.w)} h=${Math.round(note.h)} cre=${createdSec} mod=${modifiedSec}${attrsStr} %%`
				);
				parts.push(`### ${note.title || this.tr("view.note.untitled")}`);
				if (note.content) parts.push(note.content);
				parts.push("%% /QNB %%");
				parts.push("");
			}
		}

		return parts.join("\n");
	}
}
