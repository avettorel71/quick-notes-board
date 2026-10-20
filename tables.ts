/**
 * Tabelle Markdown delle note: individuazione nel testo, lettura, riscrittura.
 * Logica pura, senza dipendenze da Obsidian.
 *
 * Il colore della riga di intestazione non si può esprimere in Markdown: si salva in un
 * commento HTML, invisibile nell'anteprima, scritto sulla riga subito sopra la tabella:
 *   <!-- qnb-table header=#4a90d9 -->
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
}

const COMMENT_RE = /^\s*<!--\s*qnb-table\b(.*?)-->\s*$/;
const SEPARATOR_CELL_RE = /^:?-+:?$/;
/** Oltre queste dimensioni la tabella non si modifica con la griglia (sarebbe lenta): resta testo. */
const MAX_EDITABLE_CELLS = 4000;
/** Righe più lunghe di così non si considerano righe di tabella (evita lavoro inutile su testi enormi). */
const MAX_LINE_LENGTH = 20000;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

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
		if (i > 0) {
			const m = COMMENT_RE.exec(lines[i - 1]);
			if (m) {
				commentLine = i - 1;
				const c = /header=(#[0-9a-fA-F]{6})/.exec(m[1]);
				if (c) headerColor = c[1].toLowerCase();
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

/** Righe di testo della tabella, con le colonne allineate; il commento del colore, se c'è, va per primo. */
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
	if (HEX_RE.test(table.headerColor)) out.push(`<!-- qnb-table header=${table.headerColor.toLowerCase()} -->`);
	out.push(fmt(head));
	out.push("| " + widths.map((w, c) => separatorCell(table.align[c] || "", w)).join(" | ") + " |");
	for (const row of body) out.push(fmt(row));
	return out;
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
	};
}

// Operazioni sulla struttura. Indice di riga: 0 = intestazione, 1.. = righe di dati.

export function insertColumn(table: QnbTable, at: number): void {
	const pos = Math.max(0, Math.min(at, table.header.length));
	table.header.splice(pos, 0, "");
	table.align.splice(pos, 0, "");
	for (const row of table.rows) row.splice(pos, 0, "");
}

export function deleteColumn(table: QnbTable, col: number): boolean {
	if (table.header.length <= 1 || col < 0 || col >= table.header.length) return false;
	table.header.splice(col, 1);
	table.align.splice(col, 1);
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
	for (const row of table.rows) swap(row);
	return true;
}

/** Inserisce una riga di dati nella posizione `at` (1 = subito sotto l'intestazione). */
export function insertRow(table: QnbTable, at: number): void {
	const pos = Math.max(0, Math.min(at - 1, table.rows.length));
	table.rows.splice(pos, 0, new Array<string>(table.header.length).fill(""));
}

export function deleteRow(table: QnbTable, row: number): boolean {
	if (row < 1 || row > table.rows.length) return false;
	table.rows.splice(row - 1, 1);
	return true;
}

export function moveRow(table: QnbTable, row: number, dir: -1 | 1): boolean {
	const a = row - 1;
	const b = a + dir;
	if (a < 0 || b < 0 || a >= table.rows.length || b >= table.rows.length) return false;
	[table.rows[a], table.rows[b]] = [table.rows[b], table.rows[a]];
	return true;
}
