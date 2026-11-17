/**
 * Widget "Workflow": una fila di fasi (colonne) e un'area "Da assegnare" con le schede da
 * distribuire trascinandole nelle fasi. Tutto lo stato sta nel testo del blocco `QNBWidget`
 * della nota (righe `phase:` e `card:`), quindi si salva con la nota e si può copiare con lei.
 *
 * Il modulo non dipende da Obsidian: usa solo il DOM standard (più `setCssProps`, che Obsidian
 * aggiunge agli elementi) e i testi di i18n.ts, così modello e aspetto si possono provare da soli.
 */

import { t } from "./i18n";
import type { QnbLang } from "./i18n";

// ============================== Modello ==============================

export type WorkflowWidth = "narrow" | "medium" | "wide";
export const WORKFLOW_WIDTHS: readonly WorkflowWidth[] = ["narrow", "medium", "wide"];
export const WORKFLOW_WIDTH_PX: Record<WorkflowWidth, number> = { narrow: 140, medium: 180, wide: 240 };

/** Colori proposti (pastello): le fasi li usano a rotazione, le schede partono dal giallo. */
export const WORKFLOW_SWATCHES: readonly string[] = [
	"#ffec99",
	"#b2f2bb",
	"#a5d8ff",
	"#ffd8a8",
	"#d0bfff",
	"#ffc9c9",
	"#99e9f2",
	"#ffffff",
];
const PHASE_COLORS: readonly string[] = ["#b2f2bb", "#a5d8ff", "#ffd8a8", "#d0bfff", "#ffc9c9", "#fff3bf", "#99e9f2", "#fcc2d7"];
export const WORKFLOW_DEFAULT_CARD_COLOR = "#ffec99";

export interface WorkflowPhase {
	name: string;
	color: string;
}

export interface WorkflowCard {
	text: string;
	color: string;
	/** 0 = area "Da assegnare"; 1..n = fase numero n. */
	phase: number;
}

export interface WorkflowModel {
	id: string;
	pool: string;
	width: WorkflowWidth;
	phases: WorkflowPhase[];
	/** L'ordine in elenco è l'ordine a schermo, dentro ogni area. */
	cards: WorkflowCard[];
}

export function phaseColorAt(index: number): string {
	return PHASE_COLORS[((index % PHASE_COLORS.length) + PHASE_COLORS.length) % PHASE_COLORS.length];
}

function validColor(value: string | undefined, fallback: string): string {
	return value && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/** Nel testo di una riga `|` separa i campi e a capo finisce la riga: si scrivono come \p e \n. */
export function encodeWorkflowText(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\p").replace(/\r?\n/g, "\\n");
}

export function decodeWorkflowText(s: string): string {
	return s.replace(/\\(\\|p|n)/g, (_m, c: string) => (c === "p" ? "|" : c === "n" ? "\n" : "\\"));
}

/** Legge il testo del blocco. Le righe non riconosciute vengono ignorate. */
export function parseWorkflow(source: string, lang: QnbLang): WorkflowModel {
	const model: WorkflowModel = {
		id: "",
		pool: t(lang, "widget.template.workflowPool"),
		width: "medium",
		phases: [],
		cards: [],
	};
	const rawCards: { text: string; color: string; phase: number }[] = [];
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();
		if (key === "id") model.id = value;
		else if (key === "pool") model.pool = decodeWorkflowText(value) || model.pool;
		else if (key === "width") {
			if ((WORKFLOW_WIDTHS as readonly string[]).includes(value.toLowerCase())) model.width = value.toLowerCase() as WorkflowWidth;
		} else if (key === "phase") {
			const parts = value.split("|").map((p) => p.trim());
			model.phases.push({
				name: decodeWorkflowText(parts[0] ?? ""),
				color: validColor(parts[1], phaseColorAt(model.phases.length)),
			});
		} else if (key === "card") {
			const parts = value.split("|").map((p) => p.trim());
			const phase = parseInt(parts[2] ?? "0", 10);
			rawCards.push({
				text: decodeWorkflowText(parts[0] ?? ""),
				color: validColor(parts[1], WORKFLOW_DEFAULT_CARD_COLOR),
				phase: Number.isFinite(phase) ? phase : 0,
			});
		}
	}
	for (const c of rawCards) {
		// Una scheda che rimanda a una fase che non esiste torna nell'area "Da assegnare".
		model.cards.push({ ...c, phase: c.phase >= 1 && c.phase <= model.phases.length ? c.phase : 0 });
	}
	return model;
}

/** Il testo del blocco (senza le recinzioni) per un modello. */
export function serializeWorkflow(model: WorkflowModel): string {
	const lines = ["type: workflow"];
	if (model.id) lines.push(`id: ${model.id}`);
	lines.push(`pool: ${encodeWorkflowText(model.pool)}`);
	lines.push(`width: ${model.width}`);
	for (const p of model.phases) lines.push(`phase: ${encodeWorkflowText(p.name)} | ${p.color}`);
	for (const c of model.cards) lines.push(`card: ${encodeWorkflowText(c.text)} | ${c.color} | ${c.phase}`);
	return lines.join("\n");
}

/** Testo del blocco di un widget nuovo: area vuota e tre fasi da rinominare. */
export function workflowTemplateLines(lang: QnbLang, id: string): string[] {
	return [
		"type: workflow",
		`id: ${id}`,
		`pool: ${encodeWorkflowText(t(lang, "widget.template.workflowPool"))}`,
		"width: medium",
		`phase: ${encodeWorkflowText(t(lang, "widget.template.workflowPhase1"))} | ${phaseColorAt(0)}`,
		`phase: ${encodeWorkflowText(t(lang, "widget.template.workflowPhase2"))} | ${phaseColorAt(1)}`,
		`phase: ${encodeWorkflowText(t(lang, "widget.template.workflowPhase3"))} | ${phaseColorAt(2)}`,
	];
}

// ---- Operazioni sul modello ----

export function addCard(model: WorkflowModel, text: string): number {
	model.cards.push({ text, color: WORKFLOW_DEFAULT_CARD_COLOR, phase: 0 });
	return model.cards.length - 1;
}

/** Sposta la scheda `index` nell'area `targetPhase`, davanti alla scheda `before` (indice
 * nell'elenco di prima dello spostamento) oppure in fondo se `before` è null. */
export function moveCard(model: WorkflowModel, index: number, targetPhase: number, before: number | null) {
	if (index < 0 || index >= model.cards.length) return;
	const [card] = model.cards.splice(index, 1);
	card.phase = targetPhase;
	let at: number;
	if (before === null || before === index) {
		let last = -1;
		model.cards.forEach((c, i) => {
			if (c.phase === targetPhase) last = i;
		});
		at = last === -1 ? model.cards.length : last + 1;
	} else {
		at = before > index ? before - 1 : before;
	}
	model.cards.splice(at, 0, card);
}

/** Sposta più schede insieme (`indices`, in qualunque ordine) nell'area `targetPhase`, tenendo il loro
 * ordine reciproco, davanti alla scheda `before` (indice di prima dello spostamento, che non deve
 * essere tra quelle spostate) oppure in fondo se `before` è null. */
export function moveCards(model: WorkflowModel, indices: number[], targetPhase: number, before: number | null) {
	const moving = Array.from(new Set(indices))
		.filter((i) => i >= 0 && i < model.cards.length)
		.sort((a, b) => a - b)
		.map((i) => model.cards[i]);
	if (moving.length === 0) return;
	const anchor = before !== null ? model.cards[before] : undefined;
	const rest = model.cards.filter((c) => !moving.includes(c));
	for (const c of moving) c.phase = targetPhase;
	let at = anchor ? rest.indexOf(anchor) : -1;
	if (at === -1) {
		let last = -1;
		rest.forEach((c, i) => {
			if (c.phase === targetPhase) last = i;
		});
		at = last === -1 ? rest.length : last + 1;
	}
	rest.splice(at, 0, ...moving);
	model.cards = rest;
}

export function removeCards(model: WorkflowModel, indices: number[]) {
	const gone = new Set(indices);
	model.cards = model.cards.filter((_c, i) => !gone.has(i));
}

export function removeCard(model: WorkflowModel, index: number) {
	if (index >= 0 && index < model.cards.length) model.cards.splice(index, 1);
}

export function addPhase(model: WorkflowModel, name: string): number {
	model.phases.push({ name, color: phaseColorAt(model.phases.length) });
	return model.phases.length - 1;
}

/** Toglie la fase `index`: le sue schede tornano nell'area "Da assegnare", non si perdono. */
export function removePhase(model: WorkflowModel, index: number) {
	if (index < 0 || index >= model.phases.length) return;
	const num = index + 1;
	for (const c of model.cards) {
		if (c.phase === num) c.phase = 0;
		else if (c.phase > num) c.phase -= 1;
	}
	model.phases.splice(index, 1);
}

/** Sposta la fase `index` davanti alla fase `before` (indice di prima dello spostamento; il numero
 * delle fasi per metterla in fondo), con tutte le sue schede. Le schede delle altre fasi restano dove sono. */
export function reorderPhase(model: WorkflowModel, index: number, before: number) {
	const n = model.phases.length;
	if (index < 0 || index >= n || before < 0 || before > n) return;
	const order = Array.from({ length: n }, (_v, i) => i).filter((i) => i !== index);
	order.splice(before > index ? before - 1 : before, 0, index);
	const newNumber = new Map<number, number>();
	order.forEach((oldIdx, newIdx) => newNumber.set(oldIdx + 1, newIdx + 1));
	model.phases = order.map((oldIdx) => model.phases[oldIdx]);
	for (const c of model.cards) if (c.phase > 0) c.phase = newNumber.get(c.phase) ?? 0;
}

/** Testo nero o bianco, a seconda di quale si legge meglio sul colore dato. */
export function readableOn(hex: string): string {
	const clean = hex.replace("#", "");
	if (clean.length !== 6) return "#ffffff";
	const r = parseInt(clean.substring(0, 2), 16);
	const g = parseInt(clean.substring(2, 4), 16);
	const b = parseInt(clean.substring(4, 6), 16);
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#111111" : "#ffffff";
}

// ============================== Disegno ==============================

export interface WorkflowHost {
	/** Il testo del blocco è cambiato: va scritto nella nota. Torna false se non si è potuto. */
	sourceChanged?(root: HTMLElement, oldSource: string, newSource: string): boolean;
	/** L'utente ha agito sul widget (conta per gli obiettivi). */
	used?(): void;
	/** Gli ultimi colori scelti (i più recenti per primi), condivisi con l'editor delle tabelle. */
	recentColors?(): string[];
	/** Ricorda un colore appena scelto. */
	rememberColor?(hex: string): void;
}

export interface WorkflowContext {
	root: HTMLElement;
	lang: QnbLang;
	source: string;
	host: WorkflowHost;
}

export interface WorkflowBuild {
	root: HTMLElement;
	everyMs: () => number;
	update: (now: number) => void;
}

type CssPropsEl = HTMLElement & { setCssProps(props: Record<string, string>): void };

function setProps(el: HTMLElement, props: Record<string, string>) {
	(el as CssPropsEl).setCssProps(props);
}

/** Distanza tra le schede e spazio fisso attorno ai loro contenitori (vedi styles.css). */
const CARD_GAP = 6;
const BODY_PADDING = 16;
/** Quante schede mostra l'anteprima di una fase trascinata. */
const MAX_PREVIEW_CARDS = 5;

/** Chiude il selettore di colore aperto, se ce n'è uno. */
let closeOpenPopover: (() => void) | null = null;

/** Scheda in corso di trascinamento: serve in memoria perché durante il passaggio sopra le
 * aree il browser non permette di leggere i dati del trascinamento. */
let dragState: { owner: object; kind: "card" | "phase"; index: number; indices: number[] } | null = null;

export function buildWorkflow(ctx: WorkflowContext): WorkflowBuild {
	const { root, lang, host } = ctx;
	const doc = root.ownerDocument;
	const owner = {};
	let currentSource = ctx.source;
	const model = parseWorkflow(ctx.source, lang);
	let pendingEdit: { kind: "card" | "phase" | "pool"; index: number } | null = null;
	let lastHeight = "";
	/** Schede selezionate (indici nell'elenco): solo visivo, si azzera a ogni modifica. */
	const selected = new Set<number>();
	let anchor = -1;
	let selBox: HTMLElement | null = null;

	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
		const e = doc.createElement(tag);
		if (cls) e.className = cls;
		if (text !== undefined) e.textContent = text;
		return e;
	};

	root.classList.add("qnb-widget-workflow");
	// Un clic dentro il widget non deve far entrare la nota in modifica.
	for (const type of ["click", "dblclick", "mousedown"]) root.addEventListener(type, (evt) => evt.stopPropagation());

	const scroll = make("div", "qnb-wf-scroll");
	root.appendChild(scroll);

	const onEscape = (evt: KeyboardEvent) => {
		const target = evt.target as HTMLElement | null;
		if (evt.key !== "Escape" || target?.matches("input, textarea")) return;
		if (!root.isConnected) {
			doc.removeEventListener("keydown", onEscape, true);
			return;
		}
		if (selected.size > 0) clearSelection();
	};
	doc.addEventListener("keydown", onEscape, true);
	// Un clic nello spazio vuoto (non su una scheda o un pulsante) toglie la selezione.
	scroll.addEventListener("click", (evt) => {
		if (!(evt.target as HTMLElement).closest(".qnb-wf-card, button, .qnb-wf-edit")) clearSelection();
	});

	function commit() {
		selected.clear();
		anchor = -1;
		const next = serializeWorkflow(model);
		if (next !== currentSource) {
			host.sourceChanged?.(root, currentSource, next);
			currentSource = next;
			host.used?.();
		}
		draw();
	}

	/** Pulsante a due tempi: il primo clic chiede conferma, il secondo esegue. */
	function confirmButton(glyph: string, title: string, onConfirm: () => void, cls = "qnb-wf-btn qnb-wf-btn-danger"): HTMLButtonElement {
		const btn = make("button", cls, glyph);
		btn.title = title;
		let armed = false;
		let timer = 0;
		btn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			if (armed) {
				window.clearTimeout(timer);
				onConfirm();
				return;
			}
			armed = true;
			btn.textContent = t(lang, "widget.workflow.sure");
			btn.classList.add("qnb-wf-btn-armed");
			timer = window.setTimeout(() => {
				armed = false;
				btn.textContent = glyph;
				btn.classList.remove("qnb-wf-btn-armed");
			}, 3000);
		});
		return btn;
	}

	function iconButton(glyph: string, title: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
		const btn = make("button", "qnb-wf-btn", glyph);
		btn.title = title;
		btn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			onClick(btn);
		});
		return btn;
	}

	function openColorPopover(anchor: HTMLElement, current: string, onPick: (hex: string) => void) {
		closeOpenPopover?.();
		const pop = doc.body.appendChild(make("div", "qnb-wf-pop"));
		const row = pop.appendChild(make("div", "qnb-wf-pop-row"));
		const choose = (hex: string) => {
			close();
			host.rememberColor?.(hex);
			onPick(hex);
		};
		const close = () => {
			pop.remove();
			doc.removeEventListener("mousedown", onOutside, true);
			doc.removeEventListener("keydown", onKey, true);
			if (closeOpenPopover === close) closeOpenPopover = null;
		};
		const onOutside = (evt: MouseEvent) => {
			if (!pop.contains(evt.target as Node)) close();
		};
		const onKey = (evt: KeyboardEvent) => {
			if (evt.key === "Escape") close();
		};
		// Prima gli ultimi colori scelti, poi quelli proposti (senza doppioni).
		const shown: string[] = [];
		for (const hex of [...(host.recentColors?.() ?? []), ...WORKFLOW_SWATCHES]) {
			const h = hex.toLowerCase();
			if (/^#[0-9a-f]{6}$/.test(h) && !shown.includes(h)) shown.push(h);
		}
		for (const hex of shown) {
			// Un div e non un button: il tema di Obsidian colora i pulsanti e coprirebbe il colore.
			const sw = row.appendChild(make("div", "qnb-wf-swatch"));
			sw.title = hex;
			setProps(sw, { "--qnb-wf-color": hex });
			if (hex === current.toLowerCase()) sw.classList.add("qnb-wf-swatch-on");
			sw.addEventListener("click", () => choose(hex));
		}
		const custom = pop.appendChild(make("label", "qnb-wf-pop-custom", t(lang, "widget.workflow.customColor")));
		const input = custom.appendChild(make("input"));
		input.type = "color";
		input.value = validColor(current, WORKFLOW_DEFAULT_CARD_COLOR);
		input.addEventListener("change", () => choose(input.value.toLowerCase()));
		const rect = anchor.getBoundingClientRect();
		const view = doc.defaultView ?? window;
		setProps(pop, {
			left: `${Math.max(4, Math.min(rect.left, view.innerWidth - 230))}px`,
			top: `${Math.max(4, Math.min(rect.bottom + 4, view.innerHeight - 110))}px`,
		});
		doc.addEventListener("mousedown", onOutside, true);
		doc.addEventListener("keydown", onKey, true);
		closeOpenPopover = close;
	}

	/** Sostituisce `target` con un campo di testo; Invio o uscita dal campo confermano, Esc annulla. */
	function editInline(target: HTMLElement, current: string, multiline: boolean, onDone: (value: string | null) => void) {
		const field: HTMLInputElement | HTMLTextAreaElement = multiline ? make("textarea", "qnb-wf-edit") : make("input", "qnb-wf-edit");
		field.value = current;
		if (field instanceof HTMLInputElement) field.type = "text";
		target.replaceWith(field);
		const fit = () => {
			if (!(field instanceof HTMLTextAreaElement)) return;
			setProps(field, { height: "auto" });
			setProps(field, { height: `${field.scrollHeight}px` });
		};
		let finished = false;
		const finish = (value: string | null) => {
			if (finished) return;
			finished = true;
			onDone(value);
		};
		field.addEventListener("keydown", (raw: Event) => {
			const evt = raw as KeyboardEvent;
			evt.stopPropagation();
			if (evt.key === "Enter" && !(multiline && evt.shiftKey)) {
				evt.preventDefault();
				finish(field.value);
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				finish(null);
			}
		});
		field.addEventListener("input", fit);
		field.addEventListener("blur", () => finish(field.value));
		field.focus();
		field.select();
		fit();
	}

	// ---- Trascinamento ----

	/** Indice (nell'elenco delle schede) della scheda davanti a cui cadrebbe il rilascio, o null per "in fondo". */
	function dropBefore(body: HTMLElement, clientY: number): number | null {
		const cards = Array.from(body.querySelectorAll<HTMLElement>(".qnb-wf-card"));
		for (const c of cards) {
			if (dragState?.kind === "card" && dragState.indices.includes(Number(c.dataset.idx))) continue;
			const r = c.getBoundingClientRect();
			if (clientY < r.top + r.height / 2) return Number(c.dataset.idx);
		}
		return null;
	}

	function clearDropMarks() {
		scroll.querySelectorAll(".qnb-wf-over, .qnb-wf-drop-before, .qnb-wf-drop-end, .qnb-wf-drop-left, .qnb-wf-drop-right").forEach((e) => {
			e.classList.remove("qnb-wf-over", "qnb-wf-drop-before", "qnb-wf-drop-end", "qnb-wf-drop-left", "qnb-wf-drop-right");
		});
	}

	/** Indice della fase davanti a cui cadrebbe una fase trascinata sopra la colonna `phaseNum`
	 * (la colonna "Da assegnare" conta come "in testa"). */
	function phaseDropBefore(col: HTMLElement, phaseNum: number, clientX: number): number {
		if (phaseNum === 0) return 0;
		const r = col.getBoundingClientRect();
		return clientX < r.left + r.width / 2 ? phaseNum - 1 : phaseNum;
	}

	function wireDropArea(col: HTMLElement, body: HTMLElement, phaseNum: number) {
		const mine = () => dragState !== null && dragState.owner === owner;
		col.addEventListener("dragover", (evt) => {
			if (!mine() || !dragState) return;
			evt.preventDefault();
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
			clearDropMarks();
			if (dragState.kind === "phase") {
				const before = phaseDropBefore(col, phaseNum, evt.clientX);
				if (phaseNum === 0) col.classList.add("qnb-wf-drop-right");
				else col.classList.add(before === phaseNum - 1 ? "qnb-wf-drop-left" : "qnb-wf-drop-right");
				return;
			}
			col.classList.add("qnb-wf-over");
			const before = dropBefore(body, evt.clientY);
			if (before === null) body.classList.add("qnb-wf-drop-end");
			else body.querySelector(`.qnb-wf-card[data-idx="${before}"]`)?.classList.add("qnb-wf-drop-before");
		});
		col.addEventListener("dragleave", (evt) => {
			if (!col.contains(evt.relatedTarget as Node | null)) clearDropMarks();
		});
		col.addEventListener("drop", (evt) => {
			if (!mine() || !dragState) return;
			evt.preventDefault();
			const { kind, index, indices } = dragState;
			const phaseBefore = phaseDropBefore(col, phaseNum, evt.clientX);
			const before = kind === "card" ? dropBefore(body, evt.clientY) : null;
			dragState = null;
			clearDropMarks();
			if (kind === "phase") reorderPhase(model, index, phaseBefore);
			else moveCards(model, indices, phaseNum, before);
			commit();
		});
	}

	// ---- Parti del disegno ----

	function clearSelection() {
		if (selected.size === 0) return;
		selected.clear();
		refreshSelection();
	}

	/** Aggiorna il contorno delle schede selezionate e il pannello con le azioni sulla selezione. */
	function refreshSelection() {
		scroll.querySelectorAll<HTMLElement>(".qnb-wf-card").forEach((c) => {
			c.classList.toggle("qnb-wf-selected", selected.has(Number(c.dataset.idx)));
		});
		if (!selBox) return;
		selBox.textContent = "";
		if (selected.size === 0) {
			selBox.classList.add("qnb-wf-hidden");
			return;
		}
		selBox.classList.remove("qnb-wf-hidden");
		const n = selected.size;
		selBox.appendChild(make("div", "qnb-wf-sel-count", t(lang, "widget.workflow.selected", { n: String(n) })));
		const colorBtn = selBox.appendChild(make("button", "qnb-wf-add", `🎨 ${t(lang, "widget.workflow.color")}`));
		colorBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			openColorPopover(colorBtn, "", (hex) => {
				for (const i of selected) if (model.cards[i]) model.cards[i].color = hex;
				commit();
			});
		});
		selBox.appendChild(
			confirmButton(
				`✕ ${t(lang, "widget.workflow.removeSelected")}`,
				t(lang, "widget.workflow.removeSelected"),
				() => {
					removeCards(model, Array.from(selected));
					commit();
				},
				"qnb-wf-add qnb-wf-add-danger"
			)
		);
		const clearBtn = selBox.appendChild(make("button", "qnb-wf-add qnb-wf-add-quiet", t(lang, "widget.workflow.deselect")));
		clearBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			clearSelection();
		});
	}

	function drawCard(body: HTMLElement, index: number) {
		const card = model.cards[index];
		const el = body.appendChild(make("div", "qnb-wf-card"));
		el.dataset.idx = String(index);
		el.draggable = true;
		setProps(el, { "--qnb-wf-color": card.color, "--qnb-wf-ink": readableOn(card.color) });
		const text = el.appendChild(make("div", "qnb-wf-card-text", card.text));
		text.title = t(lang, "widget.workflow.editHint");
		text.addEventListener("dblclick", (evt) => {
			evt.stopPropagation();
			startCardEdit(el, index);
		});
		const tools = el.appendChild(make("div", "qnb-wf-tools"));
		tools.appendChild(
			iconButton("🎨", t(lang, "widget.workflow.color"), (btn) =>
				openColorPopover(btn, card.color, (hex) => {
					card.color = hex;
					commit();
				})
			)
		);
		tools.appendChild(
			confirmButton("✕", t(lang, "widget.workflow.removeCard"), () => {
				removeCard(model, index);
				commit();
			})
		);
		if (selected.has(index)) el.classList.add("qnb-wf-selected");
		el.addEventListener("mousedown", (evt) => {
			if (evt.shiftKey) evt.preventDefault(); // con Maiusc non si seleziona il testo
		});
		el.addEventListener("click", (evt) => {
			evt.stopPropagation();
			if ((evt.target as HTMLElement).closest("button, .qnb-wf-edit")) return;
			if (evt.ctrlKey || evt.metaKey) {
				if (selected.has(index)) selected.delete(index);
				else selected.add(index);
				anchor = index;
			} else if (evt.shiftKey && anchor >= 0 && model.cards[anchor]?.phase === card.phase) {
				const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
				model.cards.forEach((c, i) => {
					if (i >= from && i <= to && c.phase === card.phase) selected.add(i);
				});
			} else if (evt.shiftKey) {
				selected.add(index);
				anchor = index;
			} else {
				// Un clic semplice toglie la selezione, come in Esplora risorse.
				selected.clear();
				anchor = index;
			}
			refreshSelection();
		});
		el.addEventListener("dragstart", (evt) => {
			evt.stopPropagation(); // non deve trascinare anche la fase che lo contiene
			// Se la scheda è tra le selezionate si trascinano tutte, altrimenti solo lei.
			const moving = selected.has(index) ? Array.from(selected).sort((a, b) => a - b) : [index];
			if (!selected.has(index)) clearSelection();
			dragState = { owner, kind: "card", index, indices: moving };
			evt.dataTransfer?.setData("text/plain", moving.map((i) => model.cards[i]?.text ?? "").join("\n"));
			if (evt.dataTransfer) {
				evt.dataTransfer.effectAllowed = "move";
				if (moving.length > 1) {
					// Anteprima: tutte le schede portate, una sotto l'altra, nell'ordine in cui arriveranno.
					// Se non stanno in altezza si dispongono su due colonne; oltre, le ultime si riassumono in "+N".
					const stack = doc.body.appendChild(make("div", "qnb-wf-drag-stack"));
					const items: HTMLElement[] = moving.flatMap((i) => {
						const c = model.cards[i];
						if (!c) return [];
						const item = make("div", "qnb-wf-card qnb-wf-stack-layer-flat", c.text);
						setProps(item, { "--qnb-wf-color": c.color, "--qnb-wf-ink": readableOn(c.color) });
						return [item];
					});
					const list = stack.appendChild(make("div", "qnb-wf-drag-list"));
					for (const item of items) list.appendChild(item);
					const more = make("div", "qnb-wf-drag-phase-more");
					const maxHeight = Math.max(160, (doc.defaultView?.innerHeight ?? 800) * 0.85);
					const layout = (cols: number) => {
						setProps(stack, { width: `${el.offsetWidth * cols + (cols - 1) * 6}px` });
						setProps(list, { "grid-template-columns": `repeat(${cols}, 1fr)` });
					};
					layout(1);
					if (stack.offsetHeight > maxHeight) layout(2);
					let shown = items.length;
					while (stack.offsetHeight > maxHeight && shown > 2) {
						items[--shown].remove();
						more.textContent = `+${items.length - shown}`;
						if (!more.isConnected) stack.appendChild(more);
					}
					stack.appendChild(make("div", "qnb-wf-stack-count", String(moving.length)));
					evt.dataTransfer.setDragImage(stack, 20, 16);
					window.setTimeout(() => stack.remove(), 0);
				}
			}
			for (const i of moving) scroll.querySelector(`.qnb-wf-card[data-idx="${i}"]`)?.classList.add("qnb-wf-dragging");
		});
		el.addEventListener("dragend", (evt) => {
			evt.stopPropagation();
			dragState = null;
			scroll.querySelectorAll(".qnb-wf-dragging").forEach((e) => e.classList.remove("qnb-wf-dragging"));
			clearDropMarks();
		});
	}

	function startCardEdit(cardEl: HTMLElement, index: number) {
		const textEl = cardEl.querySelector<HTMLElement>(".qnb-wf-card-text");
		if (!textEl) return;
		cardEl.draggable = false;
		const ownCol = cardEl.closest<HTMLElement>(".qnb-wf-col");
		if (ownCol) ownCol.draggable = false;
		editInline(textEl, model.cards[index].text, true, (value) => {
			if (value !== null && value.trim() !== "") model.cards[index].text = value.trim();
			commit();
		});
	}

	function startNameEdit(titleEl: HTMLElement, current: string, onName: (name: string) => void) {
		const ownCol = titleEl.closest<HTMLElement>(".qnb-wf-col");
		if (ownCol) ownCol.draggable = false;
		editInline(titleEl, current, false, (value) => {
			if (value !== null && value.trim() !== "") onName(value.trim());
			commit();
		});
	}

	function countOf(phaseNum: number): number {
		return model.cards.filter((c) => c.phase === phaseNum).length;
	}

	function drawColumn(phaseNum: number): HTMLElement {
		const isPool = phaseNum === 0;
		const phase = isPool ? null : model.phases[phaseNum - 1];
		const col = scroll.appendChild(make("div", "qnb-wf-col " + (isPool ? "qnb-wf-pool" : "qnb-wf-phase")));
		if (phase) setProps(col, { "--qnb-wf-color": phase.color, "--qnb-wf-ink": readableOn(phase.color) });
		const head = col.appendChild(make("div", "qnb-wf-head"));
		const name = isPool ? model.pool : phase?.name ?? "";
		const title = head.appendChild(make("div", "qnb-wf-title", `${name} (${countOf(phaseNum)})`));
		title.title = t(lang, "widget.workflow.renameHint");
		title.addEventListener("click", (evt) => {
			evt.stopPropagation();
			startNameEdit(title, name, (value) => {
				if (isPool) model.pool = value;
				else if (phase) phase.name = value;
			});
		});
		if (phase) {
			const tools = head.appendChild(make("div", "qnb-wf-tools qnb-wf-tools-head"));
			const i = phaseNum - 1;
			// L'intera fase si trascina (con le sue schede) per cambiarne la posizione.
			col.draggable = true;
			head.title = t(lang, "widget.workflow.dragPhaseHint");
			col.addEventListener("dragstart", (evt) => {
				dragState = { owner, kind: "phase", index: i, indices: [] };
				evt.dataTransfer?.setData("text/plain", phase.name);
				if (evt.dataTransfer) {
					evt.dataTransfer.effectAllowed = "move";
					// Anteprima compatta e completa: titolo e prime schede. L'immagine automatica del
					// browser copia solo la parte di colonna visibile sullo schermo, tagliata.
					const preview = doc.body.appendChild(make("div", "qnb-wf-drag-phase"));
					setProps(preview, {
						width: `${col.offsetWidth}px`,
						"--qnb-wf-color": phase.color,
						"--qnb-wf-ink": readableOn(phase.color),
					});
					preview.appendChild(make("div", "qnb-wf-drag-phase-head", `${phase.name} (${countOf(phaseNum)})`));
					const list = preview.appendChild(make("div", "qnb-wf-drag-phase-body"));
					const mine = model.cards.filter((c) => c.phase === phaseNum);
					for (const c of mine.slice(0, MAX_PREVIEW_CARDS)) {
						const item = list.appendChild(make("div", "qnb-wf-card qnb-wf-stack-layer-flat", c.text));
						setProps(item, { "--qnb-wf-color": c.color, "--qnb-wf-ink": readableOn(c.color) });
					}
					if (mine.length > MAX_PREVIEW_CARDS) list.appendChild(make("div", "qnb-wf-drag-phase-more", `+${mine.length - MAX_PREVIEW_CARDS}`));
					evt.dataTransfer.setDragImage(preview, 20, 14);
					window.setTimeout(() => preview.remove(), 0);
				}
				col.classList.add("qnb-wf-dragging");
			});
			col.addEventListener("dragend", () => {
				dragState = null;
				col.classList.remove("qnb-wf-dragging");
				clearDropMarks();
			});
			tools.appendChild(
				iconButton("🎨", t(lang, "widget.workflow.color"), (btn) =>
					openColorPopover(btn, phase.color, (hex) => {
						phase.color = hex;
						commit();
					})
				)
			);
			tools.appendChild(
				confirmButton("✕", t(lang, "widget.workflow.removePhase"), () => {
					removePhase(model, i);
					commit();
				})
			);
		}
		const body = col.appendChild(make("div", "qnb-wf-body"));
		model.cards.forEach((c, idx) => {
			if (c.phase === phaseNum) drawCard(body, idx);
		});
		if (isPool) {
			const foot = col.appendChild(make("div", "qnb-wf-foot"));
			const add = foot.appendChild(make("button", "qnb-wf-add", t(lang, "widget.workflow.addCard")));
			add.addEventListener("click", (evt) => {
				evt.stopPropagation();
				const idx = addCard(model, t(lang, "widget.workflow.newCard"));
				pendingEdit = { kind: "card", index: idx };
				commit();
			});
		}
		wireDropArea(col, body, phaseNum);
		return col;
	}

	function draw() {
		closeOpenPopover?.();
		const left = scroll.scrollLeft;
		scroll.textContent = "";
		setProps(root, { "--qnb-wf-w": `${WORKFLOW_WIDTH_PX[model.width]}px` });
		drawColumn(0);
		for (let i = 1; i <= model.phases.length; i++) drawColumn(i);

		const side = scroll.appendChild(make("div", "qnb-wf-side"));
		const addPhaseBtn = side.appendChild(make("button", "qnb-wf-add", t(lang, "widget.workflow.addPhase")));
		addPhaseBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			const idx = addPhase(model, t(lang, "widget.workflow.newPhase"));
			pendingEdit = { kind: "phase", index: idx };
			commit();
		});
		const widthBtn = side.appendChild(make("button", "qnb-wf-add qnb-wf-add-quiet", `↔ ${t(lang, `widget.workflow.width.${model.width}`)}`));
		widthBtn.title = t(lang, "widget.workflow.widthHint");
		widthBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			model.width = WORKFLOW_WIDTHS[(WORKFLOW_WIDTHS.indexOf(model.width) + 1) % WORKFLOW_WIDTHS.length];
			commit();
		});
		selBox = side.appendChild(make("div", "qnb-wf-selbox qnb-wf-hidden"));
		refreshSelection();
		scroll.scrollLeft = left;
		lastHeight = "";

		const edit = pendingEdit;
		pendingEdit = null;
		if (edit?.kind === "card") {
			const cardEl = scroll.querySelector<HTMLElement>(`.qnb-wf-card[data-idx="${edit.index}"]`);
			if (cardEl) startCardEdit(cardEl, edit.index);
		} else if (edit?.kind === "phase") {
			const title = scroll.querySelectorAll<HTMLElement>(".qnb-wf-phase .qnb-wf-title")[edit.index];
			const phase = model.phases[edit.index];
			if (title && phase) startNameEdit(title, phase.name, (name) => (phase.name = name));
		}
		fitHeights();
		root.ownerDocument.defaultView?.requestAnimationFrame(fitHeights);
	}

	/** Tutte le aree, "Da assegnare" compresa, hanno la stessa altezza: quella che servirebbe per
	 * contenere tutte le schede in una sola area. Il totale non cambia spostando le schede, quindi
	 * le aree restano ferme mentre si trascina. */
	function fitHeights() {
		if (!root.isConnected) return;
		const cols = Array.from(scroll.querySelectorAll<HTMLElement>(".qnb-wf-col"));
		if (cols.length === 0) return;
		let cards = 0;
		let cardsHeight = 0;
		scroll.querySelectorAll<HTMLElement>(".qnb-wf-card").forEach((c) => {
			cards++;
			cardsHeight += c.offsetHeight + CARD_GAP;
		});
		let chrome = 0;
		for (const col of cols) {
			const head = col.querySelector<HTMLElement>(".qnb-wf-head");
			const foot = col.querySelector<HTMLElement>(".qnb-wf-foot");
			chrome = Math.max(chrome, (head?.offsetHeight ?? 0) + (foot?.offsetHeight ?? 0) + BODY_PADDING);
		}
		const value = `${Math.round(chrome + Math.max(cardsHeight, cards === 0 ? 60 : 0))}px`;
		if (value === lastHeight) return;
		lastHeight = value;
		setProps(root, { "--qnb-wf-h": value });
	}

	draw();
	return { root, everyMs: () => 500, update: () => fitHeights() };
}

// ============================== Salvataggio nella nota ==============================

/** Nel testo di una nota sostituisce il blocco `QNBWidget` che contiene `oldSource` con `newSource`.
 * Torna null se il blocco non si trova. */
export function replaceWidgetBlock(content: string, oldSource: string, newSource: string): string | null {
	const re = /(```qnbwidget[^\n]*\n)([\s\S]*?)(\n?```)/gi;
	const wanted = oldSource.trim();
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		if (m[2].trim() !== wanted) continue;
		const start = m.index + m[1].length;
		return content.slice(0, start) + newSource.replace(/\s+$/, "") + content.slice(start + m[2].length);
	}
	return null;
}
