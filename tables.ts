/**
 * Tabelle Markdown delle note: individuazione nel testo, lettura, riscrittura.
 * Logica pura, senza dipendenze da Obsidian.
 *
 * I colori (prima riga, singole righe, singole colonne) non si possono esprimere in Markdown:
 * si salvano in un commento HTML, invisibile nell'anteprima, scritto sulla riga subito sopra la
 * tabella. Righe e colonne si contano da 1 (per le righe, la prima riga di dati è la 1):
 *   <!-- qnb-table header=#4a90d9 cols=2:#ffd966,4:#b6d7a8 rows=1:#f4cccc -->
 */

export type TableAlign = "" | "left" | "center" | "right";

export interface QnbTable {
	/** Prima riga della tabella (l'intestazione) nel testo diviso per righe. */
	startLine: number;
	/** Prima riga dopo la tabella. */
	endLine: number;
	/** Riga del commento col colore, subito sopra la tabella; -1 se non c'è. */
	commentLine: number;
	header: string[];
	rows: string[][];
	align: TableAlign[];
	/** Colore dell'intestazione, "#rrggbb"; stringa vuota = nessuno. */
	headerColor: string;
	/** Colore di ogni colonna ("" = nessuno); una voce per colonna. */
	colColors: string[];
	/** Colore di ogni riga di dati ("" = nessuno); una voce per riga di `rows`. */
	rowColors: string[];
}

const COMMENT_RE = /^\s*<!--\s*qnb-table\b(.*?)-->\s*$/;
const SEPARATOR_CELL_RE = /^:?-+:?$/;
/** Oltre queste dimensioni la tabella non si modifica con la griglia (sarebbe lenta): resta testo. */
const MAX_EDITABLE_CELLS = 4000;
/** Righe più lunghe di così non si considerano righe di tabella (evita lavoro inutile su testi enormi). */
const MAX_LINE_LENGTH = 20000;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const INDEX_COLOR_RE = /^(\d+):(#[0-9a-fA-F]{6})$/;
/** Trasparenza (circa 35%) con cui si colorano righe e colonne: il testo resta leggibile sia nel
 * tema chiaro sia in quello scuro. */
const TINT_ALPHA = "59";

/** Legge "2:#ffd966,4:#b6d7a8" in una lista di `count` colori; voci non valide o fuori misura si ignorano. */
function parseIndexColors(text: string | undefined, count: number): string[] {
	const out = new Array<string>(count).fill("");
	if (!text) return out;
	for (const item of text.split(",")) {
		const m = INDEX_COLOR_RE.exec(item.trim());
		if (!m) continue;
		const i = Number(m[1]) - 1;
		if (i >= 0 && i < count) out[i] = m[2].toLowerCase();
	}
	return out;
}

/** Il contrario di parseIndexColors: "2:#ffd966,4:#b6d7a8"; vuoto se non c'è nessun colore. */
function formatIndexColors(colors: string[], count: number): string {
	const items: string[] = [];
	colors.slice(0, count).forEach((color, i) => {
		if (HEX_RE.test(color)) items.push(`${i + 1}:${color.toLowerCase()}`);
	});
	return items.join(",");
}

/** Divide una riga di tabella in celle: ignora i `|` iniziale/finale e quelli preceduti da `\`. */
function splitTableRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	const cells: string[] = [];
	let cur = "";
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "\\" && s[i + 1] === "|") {
			cur += "|";
			i++;
		} else if (ch === "|") {
			cells.push(cur.trim());
			cur = "";
		} else {
			cur += ch;
		}
	}
	cells.push(cur.trim());
	return cells;
}

function parseAlign(cell: string): TableAlign {
	const c = cell.trim();
	const left = c.startsWith(":");
	const right = c.endsWith(":");
	if (left && right) return "center";
	if (right) return "right";
	if (left) return "left";
	return "";
}

/** Riga di separazione "| --- | :-: |": ogni cella è fatta solo di trattini con due punti facoltativi.
 * Controllo cella per cella, a costo lineare. */
function isSeparatorLine(line: string): boolean {
	if (line.length > MAX_LINE_LENGTH || !line.includes("|")) return false;
	const cells = splitTableRow(line);
	return cells.length > 0 && cells.every((c) => SEPARATOR_CELL_RE.test(c));
}

function fit(cells: string[], count: number): string[] {
	const out = cells.slice(0, count);
	while (out.length < count) out.push("");
	return out;
}

/** Trova tutte le tabelle del testo, nell'ordine in cui compaiono. Salta quelle dentro i
 * blocchi di codice. */
export function findTables(content: string): QnbTable[] {
	const lines = content.split("\n");
	const tables: QnbTable[] = [];
	let inFence = false;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			i++;
			continue;
		}
		if (inFence || line.length > MAX_LINE_LENGTH || !line.includes("|") || i + 1 >= lines.length || !isSeparatorLine(lines[i + 1])) {
			i++;
			continue;
		}
		const header = splitTableRow(line);
		const sepCells = splitTableRow(lines[i + 1]);
		if (header.length !== sepCells.length) {
			i++;
			continue;
		}
		const cols = header.length;
		let j = i + 2;
		const rows: string[][] = [];
		while (j < lines.length && lines[j].trim() !== "" && lines[j].includes("|") && lines[j].length <= MAX_LINE_LENGTH) {
			rows.push(fit(splitTableRow(lines[j]), cols));
			j++;
		}
		let commentLine = -1;
		let headerColor = "";
		let colColors = parseIndexColors(undefined, cols);
		let rowColors = parseIndexColors(undefined, rows.length);
		if (i > 0) {
			const m = COMMENT_RE.exec(lines[i - 1]);
			if (m) {
				commentLine = i - 1;
				const c = /\bheader=(#[0-9a-fA-F]{6})/.exec(m[1]);
				if (c) headerColor = c[1].toLowerCase();
				colColors = parseIndexColors(/\bcols=(\S*)/.exec(m[1])?.[1], cols);
				rowColors = parseIndexColors(/\brows=(\S*)/.exec(m[1])?.[1], rows.length);
			}
		}
		tables.push({
			startLine: i,
			endLine: j,
			commentLine,
			header,
			rows,
			align: sepCells.map(parseAlign),
			headerColor,
			colColors,
			rowColors,
		});
		i = j;
	}
	return tables;
}

function escapeCell(cell: string): string {
	return cell.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function separatorCell(align: TableAlign, width: number): string {
	const w = Math.max(3, width);
	if (align === "center") return ":" + "-".repeat(w - 2) + ":";
	if (align === "right") return "-".repeat(w - 1) + ":";
	if (align === "left") return ":" + "-".repeat(w - 1);
	return "-".repeat(w);
}

/** Righe di testo della tabella, con le colonne allineate; il commento dei colori, se ce ne sono, va per primo. */
function serializeTable(table: QnbTable): string[] {
	const cols = table.header.length;
	const head = table.header.map(escapeCell);
	const body = table.rows.map((r) => fit(r, cols).map(escapeCell));
	const widths: number[] = [];
	for (let c = 0; c < cols; c++) {
		let w = 3;
		for (const row of [head, ...body]) w = Math.max(w, row[c].length);
		widths.push(w);
	}
	const fmt = (cells: string[]) => "| " + cells.map((cell, c) => cell.padEnd(widths[c], " ")).join(" | ") + " |";
	const out: string[] = [];
	const marks: string[] = [];
	if (HEX_RE.test(table.headerColor)) marks.push(`header=${table.headerColor.toLowerCase()}`);
	const colMarks = formatIndexColors(table.colColors, cols);
	if (colMarks) marks.push(`cols=${colMarks}`);
	const rowMarks = formatIndexColors(table.rowColors, body.length);
	if (rowMarks) marks.push(`rows=${rowMarks}`);
	if (marks.length > 0) out.push(`<!-- qnb-table ${marks.join(" ")} -->`);
	out.push(fmt(head));
	out.push("| " + widths.map((w, c) => separatorCell(table.align[c] || "", w)).join(" | ") + " |");
	for (const row of body) out.push(fmt(row));
	return out;
}

/** Legge celle copiate da Excel o da un altro foglio di calcolo: tabulazioni tra le celle, a capo
 * tra le righe; una cella con tabulazioni, a capo o virgolette arriva tra virgolette (quelle
 * interne raddoppiate). */
function parseTabular(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let atCellStart = true;
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (atCellStart && ch === '"') {
			i++;
			while (i < text.length) {
				if (text[i] === '"') {
					if (text[i + 1] === '"') {
						cell += '"';
						i += 2;
						continue;
					}
					i++;
					break;
				}
				cell += text[i++];
			}
			atCellStart = false;
		} else if (ch === "\t") {
			row.push(cell);
			cell = "";
			atCellStart = true;
			i++;
		} else if (ch === "\n" || ch === "\r") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			atCellStart = true;
			i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
		} else {
			cell += ch;
			atCellStart = false;
			i++;
		}
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

/** Se il testo è una tabella copiata da Excel (almeno due righe e due colonne, tutte le righe con lo
 * stesso numero di celle, titoli in almeno due celle della prima riga) la restituisce come tabella
 * Markdown, con la prima riga come intestazione; altrimenti null, e il testo si incolla com'è. */
export function tabularTextToMarkdown(text: string): string | null {
	if (!text.includes("\t")) return null;
	const grid = parseTabular(text);
	const cols = grid[0]?.length ?? 0;
	if (grid.length < 2 || cols < 2 || grid.some((r) => r.length !== cols)) return null;
	// Un testo rientrato con tabulazioni (codice, elenchi) non è una tabella.
	if (grid[0].filter((c) => c.trim() !== "").length < 2) return null;
	const clean = (c: string) => c.trim().replace(/\r?\n/g, "<br>").replace(/\t/g, " ");
	const table: QnbTable = {
		startLine: 0,
		endLine: 0,
		commentLine: -1,
		header: grid[0].map(clean),
		rows: grid.slice(1).map((r) => r.map(clean)),
		align: new Array<TableAlign>(cols).fill(""),
		headerColor: "",
		colColors: new Array<string>(cols).fill(""),
		rowColors: new Array<string>(grid.length - 1).fill(""),
	};
	return serializeTable(table).join("\n");
}

/** Tabella Markdown vuota, da cui partire: intestazione con i titoli dati e `dataRows` righe vuote. */
export function emptyTableMarkdown(headers: string[], dataRows: number): string {
	const cols = headers.length;
	const table: QnbTable = {
		startLine: 0,
		endLine: 0,
		commentLine: -1,
		header: [...headers],
		rows: Array.from({ length: dataRows }, () => new Array<string>(cols).fill("")),
		align: new Array<TableAlign>(cols).fill(""),
		headerColor: "",
		colColors: new Array<string>(cols).fill(""),
		rowColors: new Array<string>(dataRows).fill(""),
	};
	return serializeTable(table).join("\n");
}

/** Sostituisce nel testo la tabella numero `index` (come la restituisce findTables sullo
 * stesso testo) con la versione modificata. Il resto del testo non cambia. */
export function replaceTableInContent(content: string, index: number, edited: QnbTable): string | null {
	const tables = findTables(content);
	const original = tables[index];
	if (!original) return null;
	const lines = content.split("\n");
	const from = original.commentLine >= 0 ? original.commentLine : original.startLine;
	lines.splice(from, original.endLine - from, ...serializeTable(edited));
	return lines.join("\n");
}

/** Toglie dal testo la tabella numero `index` (con il suo commento di colori, se c'è). Se resterebbero
 * due righe vuote di fila dove era la tabella, ne tiene una sola. Null se la tabella non esiste. */
export function removeTableFromContent(content: string, index: number): string | null {
	const original = findTables(content)[index];
	if (!original) return null;
	const lines = content.split("\n");
	const from = original.commentLine >= 0 ? original.commentLine : original.startLine;
	lines.splice(from, original.endLine - from);
	if (from > 0 && from < lines.length && lines[from - 1].trim() === "" && lines[from].trim() === "") lines.splice(from, 1);
	return lines.join("\n");
}

/** Vero se la tabella è abbastanza piccola da modificarla con la griglia. */
export function isEditableSize(table: QnbTable): boolean {
	return (table.rows.length + 1) * table.header.length <= MAX_EDITABLE_CELLS;
}

export function cloneTable(table: QnbTable): QnbTable {
	return {
		...table,
		header: [...table.header],
		rows: table.rows.map((r) => [...r]),
		align: [...table.align],
		colColors: [...table.colColors],
		rowColors: [...table.rowColors],
	};
}

/** Colore con cui disegnare la cella (riga `row`: 0 = intestazione, 1.. = righe di dati), o null.
 * L'intestazione colorata ha il suo colore pieno; per il resto vince quello della riga su quello
 * della colonna, e va usato attenuato (vedi `tintColor`). */
export function cellColor(table: QnbTable, row: number, col: number): { hex: string; solid: boolean } | null {
	if (row === 0 && table.headerColor) return { hex: table.headerColor, solid: true };
	const own = (row > 0 ? table.rowColors[row - 1] : "") || table.colColors[col];
	return own ? { hex: own, solid: false } : null;
}

/** Lo stesso colore reso semitrasparente, per colorare celle lasciando il testo normale. */
export function tintColor(hex: string): string {
	return hex + TINT_ALPHA;
}

/** Colore proposto la prima volta, quando non ne è ancora stato scelto nessuno. */
export const DEFAULT_TABLE_COLOR = "#ffd966";
/** Colori suggeriti accanto agli ultimi usati. */
export const SUGGESTED_TABLE_COLORS = ["#ffd966", "#f4cccc", "#b6d7a8", "#9fc5e8", "#d9d2e9", "#fce5cd", "#ead1dc", "#cccccc"];
/** Quanti degli ultimi colori scelti si ricordano. */
const MAX_RECENT_COLORS = 8;

/** Lista degli ultimi colori letta dalle impostazioni: solo "#rrggbb" validi, senza doppioni. */
export function normalizeRecentColors(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string" || !HEX_RE.test(item)) continue;
		const hex = item.toLowerCase();
		if (!out.includes(hex)) out.push(hex);
	}
	return out.slice(0, MAX_RECENT_COLORS);
}

/** Aggiunge `hex` in testa agli ultimi colori usati, senza doppioni. */
export function rememberColor(list: string[], hex: string): string[] {
	return normalizeRecentColors([hex, ...list]);
}

/** Legge un colore scritto a mano ("ffd966", "#FFD966", "#fd6"): "#rrggbb" in minuscolo, o null. */
export function parseHexColor(text: string): string | null {
	let t = text.trim().replace(/^#/, "");
	if (/^[0-9a-fA-F]{3}$/.test(t)) t = t.replace(/./g, (ch) => ch + ch);
	return /^[0-9a-fA-F]{6}$/.test(t) ? "#" + t.toLowerCase() : null;
}

// Operazioni sulla struttura. Indice di riga: 0 = intestazione, 1.. = righe di dati.

export function insertColumn(table: QnbTable, at: number): void {
	const pos = Math.max(0, Math.min(at, table.header.length));
	table.header.splice(pos, 0, "");
	table.align.splice(pos, 0, "");
	table.colColors.splice(pos, 0, "");
	for (const row of table.rows) row.splice(pos, 0, "");
}

export function deleteColumn(table: QnbTable, col: number): boolean {
	if (table.header.length <= 1 || col < 0 || col >= table.header.length) return false;
	table.header.splice(col, 1);
	table.align.splice(col, 1);
	table.colColors.splice(col, 1);
	for (const row of table.rows) row.splice(col, 1);
	return true;
}

export function moveColumn(table: QnbTable, col: number, dir: -1 | 1): boolean {
	const to = col + dir;
	if (col < 0 || to < 0 || col >= table.header.length || to >= table.header.length) return false;
	const swap = <T>(arr: T[]) => {
		[arr[col], arr[to]] = [arr[to], arr[col]];
	};
	swap(table.header);
	swap(table.align);
	swap(table.colColors);
	for (const row of table.rows) swap(row);
	return true;
}

/** Inserisce una riga di dati nella posizione `at` (1 = subito sotto l'intestazione). */
export function insertRow(table: QnbTable, at: number): void {
	const pos = Math.max(0, Math.min(at - 1, table.rows.length));
	table.rows.splice(pos, 0, new Array<string>(table.header.length).fill(""));
	table.rowColors.splice(pos, 0, "");
}

export function deleteRow(table: QnbTable, row: number): boolean {
	if (row < 1 || row > table.rows.length) return false;
	table.rows.splice(row - 1, 1);
	table.rowColors.splice(row - 1, 1);
	return true;
}

export function moveRow(table: QnbTable, row: number, dir: -1 | 1): boolean {
	const a = row - 1;
	const b = a + dir;
	if (a < 0 || b < 0 || a >= table.rows.length || b >= table.rows.length) return false;
	[table.rows[a], table.rows[b]] = [table.rows[b], table.rows[a]];
	[table.rowColors[a], table.rowColors[b]] = [table.rowColors[b], table.rowColors[a]];
	return true;
}
