/**
 * Note widget: mini utility (orologio, calendario, conto alla rovescia, cronometro,
 * pomodoro) che si disegnano al posto di un blocco di codice `QNBWidget` dentro una nota.
 *
 * Il modulo non dipende da Obsidian: usa solo il DOM standard (più `setCssProps`, che
 * Obsidian aggiunge agli elementi) e i testi di i18n.ts, così logica e aspetto si possono
 * provare da soli.
 * Un solo timer (vedi WidgetManager.tick) aggiorna tutti i widget a schermo.
 */

import { t } from "./i18n";
import type { QnbLang } from "./i18n";

export const WIDGET_BLOCK_NAME = "QNBWidget";

export type WidgetType = "clock" | "calendar" | "countdown" | "stopwatch" | "pomodoro";
export const WIDGET_TYPES: readonly WidgetType[] = ["clock", "calendar", "countdown", "stopwatch", "pomodoro"];

// ============================== Testi ==============================

/** Nome di un tipo di widget nella lingua data (per il menu e il titolo della nota). */
export function widgetTypeName(lang: QnbLang, type: WidgetType): string {
	return t(lang, `widget.type.${type}`);
}

function unitLabel(lang: QnbLang, unit: "day" | "hour" | "minute" | "second", n: number): string {
	const [one, many] = t(lang, `widget.unit.${unit}`).split("|");
	return n === 1 ? one : many;
}

// ============================== Parametri ==============================

export type WidgetParams = Record<string, string>;

/** Legge le righe `chiave: valore` del blocco. Le chiavi sono insensibili alle maiuscole;
 * righe vuote e righe che iniziano con # sono ignorate. */
export function parseWidgetParams(source: string): WidgetParams {
	const params: WidgetParams = {};
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();
		if (key) params[key] = value;
	}
	return params;
}

export function paramBool(params: WidgetParams, key: string, fallback: boolean): boolean {
	const v = (params[key] || "").toLowerCase();
	if (["true", "yes", "1", "on", "si", "sì", "vero"].includes(v)) return true;
	if (["false", "no", "0", "off", "falso"].includes(v)) return false;
	return fallback;
}

export function paramInt(params: WidgetParams, key: string, fallback: number, min: number, max: number): number {
	const n = parseInt(params[key] || "", 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

// ============================== Utilità DOM ==============================

type CssPropsEl = HTMLElement & { setCssProps: (props: Record<string, string>) => void };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
	return createEl(tag, { cls, text });
}

function setText(el: HTMLElement, text: string) {
	if (el.textContent !== text) el.textContent = text;
}

function setCssVar(el: HTMLElement, name: string, value: string) {
	(el as CssPropsEl).setCssProps({ [name]: value });
}

/** Pulsante del widget. Il clic non deve aprire la modifica della nota, nemmeno con
 * l'opzione "richiedi doppio click". */
function makeButton(label: string, cls: string, onClick: () => void): HTMLButtonElement {
	const btn = h("button", cls, label);
	btn.type = "button";
	btn.addEventListener("click", (evt) => {
		evt.stopPropagation();
		onClick();
	});
	btn.addEventListener("dblclick", (evt) => evt.stopPropagation());
	return btn;
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

export function localeFor(lang: QnbLang): string {
	return lang === "en" ? "en-US" : "it-IT";
}

function capitalize(s: string): string {
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ============================== Orologio ==============================

export function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Prepara le due formattazioni dell'orologio: ora ("HH:MM:SS") e data come
 * "lunedì, ottobre 05, 2026". */
export function makeClockFormatter(
	lang: QnbLang,
	o: { seconds: boolean; hour12: boolean; timeZone?: string }
): (date: Date) => { time: string; date: string } {
	const loc = localeFor(lang);
	const timeOpts: Intl.DateTimeFormatOptions = {
		hour: "2-digit",
		minute: "2-digit",
		hour12: o.hour12,
		timeZone: o.timeZone,
	};
	if (o.seconds) timeOpts.second = "2-digit";
	const timeFmt = new Intl.DateTimeFormat(loc, timeOpts);
	const dateFmt = new Intl.DateTimeFormat(loc, {
		weekday: "long",
		month: "long",
		day: "2-digit",
		year: "numeric",
		timeZone: o.timeZone,
	});
	const part = (parts: Intl.DateTimeFormatPart[], type: string): string =>
		parts.find((p) => (p.type as string) === type)?.value || "";

	return (date: Date) => {
		const tp = timeFmt.formatToParts(date);
		let hour = part(tp, "hour");
		// Alcune versioni di Chrome scrivono "24" a mezzanotte con il formato a 24 ore.
		if (!o.hour12 && hour === "24") hour = "00";
		const pieces = [hour, part(tp, "minute")];
		if (o.seconds) pieces.push(part(tp, "second"));
		let time = pieces.join(":");
		const period = part(tp, "dayPeriod");
		if (period) time += ` ${period}`;

		const dp = dateFmt.formatToParts(date);
		const dateText = `${part(dp, "weekday")}, ${part(dp, "month")} ${part(dp, "day")}, ${part(dp, "year")}`;
		return { time, date: dateText };
	};
}

// ============================== Calendario ==============================

export interface CalendarCell {
	y: number;
	m: number; // 0-11
	d: number;
	inMonth: boolean;
}

/** Griglia di 6 settimane x 7 giorni che contiene il mese dato (sempre 6 righe, così
 * l'altezza del widget non cambia da un mese all'altro). */
export function monthGrid(year: number, month: number, mondayFirst: boolean): CalendarCell[][] {
	const dow = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 = domenica
	const offset = mondayFirst ? (dow + 6) % 7 : dow;
	const start = Date.UTC(year, month, 1 - offset);
	const rows: CalendarCell[][] = [];
	for (let r = 0; r < 6; r++) {
		const row: CalendarCell[] = [];
		for (let c = 0; c < 7; c++) {
			const d = new Date(start + (r * 7 + c) * 86400000);
			row.push({ y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), inMonth: d.getUTCMonth() === month });
		}
		rows.push(row);
	}
	return rows;
}

export function weekdayNames(lang: QnbLang, mondayFirst: boolean): string[] {
	const fmt = new Intl.DateTimeFormat(localeFor(lang), { weekday: "short", timeZone: "UTC" });
	// 5 gennaio 2026 è un lunedì, 4 gennaio una domenica.
	const startDay = mondayFirst ? 5 : 4;
	const names: string[] = [];
	for (let i = 0; i < 7; i++) names.push(capitalize(fmt.format(new Date(Date.UTC(2026, 0, startDay + i)))));
	return names;
}

export function monthTitle(lang: QnbLang, year: number, month: number): string {
	const fmt = new Intl.DateTimeFormat(localeFor(lang), { month: "long", year: "numeric", timeZone: "UTC" });
	return capitalize(fmt.format(new Date(Date.UTC(year, month, 1))));
}

/** "AAAA-MM" → {year, month 0-11}, oppure null se non valido. */
export function parseMonthParam(value: string): { year: number; month: number } | null {
	const m = /^(\d{4})-(\d{1,2})$/.exec(value.trim());
	if (!m) return null;
	const month = parseInt(m[2], 10);
	if (month < 1 || month > 12) return null;
	return { year: parseInt(m[1], 10), month: month - 1 };
}

// ============================== Conto alla rovescia ==============================

/** "AAAA-MM-GG" oppure "AAAA-MM-GG HH:MM[:SS]" (ora locale) → istante in ms, o null. */
export function parseTarget(value: string): number | null {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
	if (!m) return null;
	const [y, mo, d] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
	const [hh, mi, ss] = [parseInt(m[4] || "0", 10), parseInt(m[5] || "0", 10), parseInt(m[6] || "0", 10)];
	const date = new Date(y, mo - 1, d, hh, mi, ss);
	// Rifiuta le date che il calendario "aggiusterebbe" da sole (es. 31 febbraio).
	if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
	if (hh > 23 || mi > 59 || ss > 59) return null;
	return date.getTime();
}

export function countdownParts(
	targetMs: number,
	nowMs: number
): { done: boolean; days: number; hours: number; minutes: number; seconds: number } {
	const rem = targetMs - nowMs;
	if (rem <= 0) return { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
	const total = Math.floor(rem / 1000);
	return {
		done: false,
		days: Math.floor(total / 86400),
		hours: Math.floor((total % 86400) / 3600),
		minutes: Math.floor((total % 3600) / 60),
		seconds: total % 60,
	};
}

// ============================== Cronometro ==============================

export interface StopwatchState {
	running: boolean;
	/** Istante (ms) in cui è partito o ripartito l'ultima volta; valido se running. */
	startedAt: number;
	/** Tempo già trascorso (ms) prima dell'ultima partenza. */
	accumulated: number;
	/** Tempi totali (ms) di ogni giro, in ordine. */
	laps: number[];
}

export const MAX_LAPS = 100;
const LAPS_SHOWN = 5;

export function stopwatchInitial(): StopwatchState {
	return { running: false, startedAt: 0, accumulated: 0, laps: [] };
}

export function stopwatchElapsed(s: StopwatchState, now: number): number {
	return s.accumulated + (s.running ? Math.max(0, now - s.startedAt) : 0);
}

export function stopwatchStart(s: StopwatchState, now: number): StopwatchState {
	return s.running ? s : { ...s, running: true, startedAt: now };
}

export function stopwatchPause(s: StopwatchState, now: number): StopwatchState {
	return s.running ? { ...s, running: false, accumulated: stopwatchElapsed(s, now), startedAt: 0 } : s;
}

export function stopwatchLap(s: StopwatchState, now: number): StopwatchState {
	if (!s.running) return s;
	return { ...s, laps: [...s.laps, stopwatchElapsed(s, now)].slice(-MAX_LAPS) };
}

/** "MM:SS.d" sotto l'ora, "H:MM:SS.d" da un'ora in su (d = decimi di secondo). */
export function formatStopwatch(ms: number): string {
	const tenths = Math.floor(Math.max(0, ms) / 100);
	const totalSec = Math.floor(tenths / 10);
	const tenth = tenths % 10;
	const sec = totalSec % 60;
	const min = Math.floor(totalSec / 60) % 60;
	const hrs = Math.floor(totalSec / 3600);
	return hrs > 0 ? `${hrs}:${pad2(min)}:${pad2(sec)}.${tenth}` : `${pad2(min)}:${pad2(sec)}.${tenth}`;
}

export function isStopwatchState(x: unknown): x is StopwatchState {
	if (!x || typeof x !== "object") return false;
	const s = x as Record<string, unknown>;
	return (
		typeof s.running === "boolean" &&
		typeof s.startedAt === "number" &&
		typeof s.accumulated === "number" &&
		Array.isArray(s.laps) &&
		s.laps.every((n) => typeof n === "number")
	);
}

// ============================== Pomodoro ==============================

export type PomodoroPhase = "work" | "break" | "longbreak";

export interface PomodoroConfig {
	/** Durate in minuti. */
	work: number;
	brk: number;
	longBreak: number;
	/** Pomodori di lavoro prima della pausa lunga. */
	cycles: number;
	label: string;
}

export interface PomodoroState {
	phase: PomodoroPhase;
	running: boolean;
	/** Istante (ms) di fine della fase; valido se running. */
	endsAt: number;
	/** Tempo che manca alla fine della fase (ms); valido se in pausa. */
	remainingMs: number;
	/** Pomodori di lavoro completati nel ciclo corrente (0 .. cycles-1). */
	cycle: number;
	/** Pomodori completati in totale. */
	completed: number;
	config: PomodoroConfig;
}

export function phaseMs(cfg: PomodoroConfig, phase: PomodoroPhase): number {
	const minutes = phase === "work" ? cfg.work : phase === "break" ? cfg.brk : cfg.longBreak;
	return minutes * 60000;
}

export function pomodoroInitial(cfg: PomodoroConfig): PomodoroState {
	return { phase: "work", running: false, endsAt: 0, remainingMs: phaseMs(cfg, "work"), cycle: 0, completed: 0, config: cfg };
}

export function pomodoroStart(s: PomodoroState, now: number): PomodoroState {
	return s.running ? s : { ...s, running: true, endsAt: now + s.remainingMs };
}

export function pomodoroPause(s: PomodoroState, now: number): PomodoroState {
	return s.running ? { ...s, running: false, remainingMs: Math.max(0, s.endsAt - now), endsAt: 0 } : s;
}

/** Passa alla fase successiva, sempre in pausa (aspetta "Avvia"). `finished` è vero se la
 * fase è arrivata a zero: solo allora un periodo di lavoro conta come pomodoro completato.
 * Dopo `cycles` pomodori completati la pausa è quella lunga. Saltando un lavoro si va alla
 * pausa normale senza contarlo. */
export function pomodoroAdvance(s: PomodoroState, finished: boolean): PomodoroState {
	let phase: PomodoroPhase = "work";
	let cycle = s.cycle;
	let completed = s.completed;
	if (s.phase === "work") {
		phase = "break";
		if (finished) {
			completed += 1;
			cycle += 1;
			if (cycle >= s.config.cycles) {
				phase = "longbreak";
				cycle = 0;
			}
		}
	}
	return { ...s, phase, cycle, completed, running: false, endsAt: 0, remainingMs: phaseMs(s.config, phase) };
}

/** Se la fase in corso è finita, la chiude e ritorna il nuovo stato. */
export function pomodoroTick(
	s: PomodoroState,
	now: number
): { state: PomodoroState; ended: PomodoroPhase | null; endedAt: number } {
	if (s.running && now >= s.endsAt) return { state: pomodoroAdvance(s, true), ended: s.phase, endedAt: s.endsAt };
	return { state: s, ended: null, endedAt: 0 };
}

function sameConfig(a: PomodoroConfig, b: PomodoroConfig): boolean {
	return a.work === b.work && a.brk === b.brk && a.longBreak === b.longBreak && a.cycles === b.cycles && a.label === b.label;
}

/** Applica a uno stato salvato la configurazione scritta ora nel blocco. La durata della
 * fase in corso cambia solo se è ferma e intatta; altrimenti la nuova vale dalla fase dopo. */
export function pomodoroSyncConfig(s: PomodoroState, cfg: PomodoroConfig): PomodoroState {
	if (sameConfig(s.config, cfg)) return s;
	const untouched = !s.running && s.remainingMs === phaseMs(s.config, s.phase);
	return {
		...s,
		config: cfg,
		cycle: Math.min(s.cycle, cfg.cycles - 1),
		remainingMs: untouched ? phaseMs(cfg, s.phase) : s.remainingMs,
	};
}

export function isPomodoroState(x: unknown): x is PomodoroState {
	if (!x || typeof x !== "object") return false;
	const s = x as Record<string, unknown>;
	const c = s.config as Record<string, unknown> | undefined;
	return (
		(s.phase === "work" || s.phase === "break" || s.phase === "longbreak") &&
		typeof s.running === "boolean" &&
		typeof s.endsAt === "number" &&
		typeof s.remainingMs === "number" &&
		typeof s.cycle === "number" &&
		typeof s.completed === "number" &&
		!!c &&
		typeof c.work === "number" &&
		typeof c.brk === "number" &&
		typeof c.longBreak === "number" &&
		typeof c.cycles === "number" &&
		typeof c.label === "string"
	);
}

/** "MM:SS" (arrotondato per eccesso al secondo: 0:00.4 mostra ancora 00:01). */
export function formatCountdownClock(ms: number): string {
	const total = Math.ceil(Math.max(0, ms) / 1000);
	return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

// ============================== Stato salvato ==============================

/** Stato dei widget che ne hanno bisogno (cronometro, pomodoro). Con `id` nel blocco lo
 * stato è "persistente" e finisce in data.json; senza `id` vive solo in memoria. */
export class WidgetStateStore {
	private persisted = new Map<string, unknown>();
	private volatile = new Map<string, unknown>();

	load(raw: unknown) {
		this.persisted.clear();
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) this.persisted.set(k, v);
	}

	toJSON(): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		this.persisted.forEach((v, k) => {
			out[k] = v;
		});
		return out;
	}

	get(key: string, persistent: boolean): unknown {
		return (persistent ? this.persisted : this.volatile).get(key);
	}

	set(key: string, persistent: boolean, value: unknown) {
		(persistent ? this.persisted : this.volatile).set(key, value);
	}

	entries(): { key: string; persistent: boolean; value: unknown }[] {
		const list: { key: string; persistent: boolean; value: unknown }[] = [];
		this.persisted.forEach((value, key) => list.push({ key, persistent: true, value }));
		this.volatile.forEach((value, key) => list.push({ key, persistent: false, value }));
		return list;
	}
}

// ============================== Modello nuova nota ==============================

export function newWidgetId(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Testo del blocco con i valori predefiniti, scritto in una nota nuova creata come widget. */
export function widgetTemplate(type: WidgetType, lang: QnbLang, now: Date = new Date()): string {
	let lines: string[];
	switch (type) {
		case "clock":
			lines = ["type: clock", "seconds: true", "hour12: false", "date: true"];
			break;
		case "calendar":
			lines = ["type: calendar", "weekstart: monday"];
			break;
		case "countdown": {
			const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
			const target = `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())} 09:00`;
			lines = ["type: countdown", `label: ${t(lang, "widget.template.countdownLabel")}`, `target: ${target}`];
			break;
		}
		case "stopwatch":
			lines = ["type: stopwatch", `id: ${newWidgetId("sw")}`, "laps: true"];
			break;
		case "pomodoro":
			lines = ["type: pomodoro", `id: ${newWidgetId("pomo")}`, "work: 25", "break: 5", "longbreak: 15", "cycles: 4"];
			break;
	}
	return "```" + WIDGET_BLOCK_NAME + "\n" + lines.join("\n") + "\n```\n";
}

// ============================== Disegno dei widget ==============================

export interface WidgetHost {
	lang(): QnbLang;
	/** Linea sopra e sotto i widget (tranne il calendario): colore e spessore in pixel, oppure
	 * null se l'opzione è spenta. */
	accentLines(): { color: string; width: number } | null;
	/** Salva su disco lo stato persistente. */
	persist(): void;
	/** Una fase del pomodoro è finita (suono e avviso li gestisce il plugin). */
	notifyPomodoro(info: { label: string; ended: PomodoroPhase; next: PomodoroPhase; endedAt: number; late: boolean }): void;
}

interface WidgetContext {
	root: HTMLElement;
	params: WidgetParams;
	lang: QnbLang;
	source: string;
	store: WidgetStateStore;
	host: WidgetHost;
}

interface WidgetInstance {
	root: HTMLElement;
	/** Ogni quanti ms va aggiornato. */
	everyMs: () => number;
	update: (now: number) => void;
}

type WidgetBuild = WidgetInstance | { error: string };

function stateKey(ctx: WidgetContext, type: WidgetType): { key: string; persistent: boolean } {
	const id = (ctx.params.id || "").trim();
	return id ? { key: `${type}:${id}`, persistent: true } : { key: `${type}~${ctx.source.trim()}`, persistent: false };
}

function addLabel(ctx: WidgetContext) {
	if (ctx.params.label) ctx.root.appendChild(h("div", "qnb-widget-label", ctx.params.label));
}

function buildClock(ctx: WidgetContext): WidgetBuild {
	const { params, lang, root } = ctx;
	const timeZone = (params.timezone || "").trim();
	if (timeZone && !isValidTimeZone(timeZone)) return { error: t(lang, "widget.error.badTimezone", { tz: timeZone }) };
	const format = makeClockFormatter(lang, {
		seconds: paramBool(params, "seconds", true),
		hour12: paramBool(params, "hour12", false),
		timeZone: timeZone || undefined,
	});
	const showDate = paramBool(params, "date", true);

	root.classList.add("qnb-widget-clock");
	addLabel(ctx);
	const timeEl = root.appendChild(h("div", "qnb-widget-clock-time"));
	const dateEl = showDate ? root.appendChild(h("div", "qnb-widget-clock-date")) : null;
	if (timeZone) root.appendChild(h("div", "qnb-widget-clock-zone", timeZone));

	return {
		root,
		everyMs: () => 250,
		update: (now) => {
			const out = format(new Date(now));
			setText(timeEl, out.time);
			if (dateEl) setText(dateEl, out.date);
		},
	};
}

function buildCalendar(ctx: WidgetContext): WidgetBuild {
	const { params, lang, root } = ctx;
	const mondayFirst = (params.weekstart || "monday").toLowerCase() !== "sunday";
	const today = new Date();
	let viewYear = today.getFullYear();
	let viewMonth = today.getMonth();
	if (params.month) {
		const parsed = parseMonthParam(params.month);
		if (!parsed) return { error: t(lang, "widget.error.badMonth") };
		viewYear = parsed.year;
		viewMonth = parsed.month;
	}

	root.classList.add("qnb-widget-calendar");
	const header = root.appendChild(h("div", "qnb-widget-cal-header"));
	const prevBtn = header.appendChild(makeButton("‹", "qnb-widget-cal-nav", () => shift(-1)));
	prevBtn.setAttribute("aria-label", t(lang, "widget.prevMonth"));
	const titleBtn = header.appendChild(makeButton("", "qnb-widget-cal-title", () => goToToday()));
	titleBtn.setAttribute("aria-label", t(lang, "widget.today"));
	const nextBtn = header.appendChild(makeButton("›", "qnb-widget-cal-nav", () => shift(1)));
	nextBtn.setAttribute("aria-label", t(lang, "widget.nextMonth"));

	const weekRow = root.appendChild(h("div", "qnb-widget-cal-week"));
	const names = weekdayNames(lang, mondayFirst);
	names.forEach((name, i) => {
		const weekend = mondayFirst ? i >= 5 : i === 0 || i === 6;
		weekRow.appendChild(h("div", "qnb-widget-cal-weekday" + (weekend ? " qnb-widget-cal-weekend" : ""), name));
	});
	const gridEl = root.appendChild(h("div", "qnb-widget-cal-grid"));

	let drawnTodayKey = "";
	const todayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

	function draw(now: Date) {
		drawnTodayKey = todayKey(now);
		setText(titleBtn, monthTitle(lang, viewYear, viewMonth));
		gridEl.textContent = "";
		for (const row of monthGrid(viewYear, viewMonth, mondayFirst)) {
			row.forEach((cell, col) => {
				let cls = "qnb-widget-cal-day";
				if (!cell.inMonth) cls += " qnb-widget-cal-out";
				if (mondayFirst ? col >= 5 : col === 0 || col === 6) cls += " qnb-widget-cal-weekend";
				if (cell.y === now.getFullYear() && cell.m === now.getMonth() && cell.d === now.getDate()) cls += " qnb-widget-cal-today";
				gridEl.appendChild(h("div", cls, String(cell.d)));
			});
		}
	}
	function shift(delta: number) {
		const d = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
		viewYear = d.getUTCFullYear();
		viewMonth = d.getUTCMonth();
		draw(new Date());
	}
	function goToToday() {
		const now = new Date();
		viewYear = now.getFullYear();
		viewMonth = now.getMonth();
		draw(now);
	}
	draw(today);

	return {
		root,
		everyMs: () => 30000,
		// Cambia il giorno a mezzanotte: ridisegna per spostare l'evidenziazione di oggi.
		update: (now) => {
			const d = new Date(now);
			if (todayKey(d) !== drawnTodayKey) draw(d);
		},
	};
}

function buildCountdown(ctx: WidgetContext): WidgetBuild {
	const { params, lang, root } = ctx;
	if (!params.target) return { error: t(lang, "widget.error.missingTarget") };
	const targetMs = parseTarget(params.target);
	if (targetMs === null) return { error: t(lang, "widget.error.badTarget") };
	const showSeconds = paramBool(params, "seconds", true);
	const doneText = params.done || t(lang, "widget.expired");

	root.classList.add("qnb-widget-countdown");
	addLabel(ctx);

	const unitsEl = root.appendChild(h("div", "qnb-widget-cd-units"));
	const units: { key: "days" | "hours" | "minutes" | "seconds"; unit: "day" | "hour" | "minute" | "second"; num: HTMLElement; lbl: HTMLElement }[] = [];
	const defs: { key: "days" | "hours" | "minutes" | "seconds"; unit: "day" | "hour" | "minute" | "second" }[] = [
		{ key: "days", unit: "day" },
		{ key: "hours", unit: "hour" },
		{ key: "minutes", unit: "minute" },
	];
	if (showSeconds) defs.push({ key: "seconds", unit: "second" });
	for (const def of defs) {
		const box = unitsEl.appendChild(h("div", "qnb-widget-cd-unit"));
		units.push({ ...def, num: box.appendChild(h("div", "qnb-widget-cd-num")), lbl: box.appendChild(h("div", "qnb-widget-cd-lbl")) });
	}
	const doneEl = root.appendChild(h("div", "qnb-widget-cd-done", doneText));
	doneEl.hidden = true;

	const target = new Date(targetMs);
	const hasTime = /[ T]\d/.test(params.target);
	const dayFmt = new Intl.DateTimeFormat(localeFor(lang), { day: "numeric", month: "long", year: "numeric" });
	const timeFmt = new Intl.DateTimeFormat(localeFor(lang), { hour: "2-digit", minute: "2-digit" });
	root.appendChild(h("div", "qnb-widget-cd-target", hasTime ? `${dayFmt.format(target)}, ${timeFmt.format(target)}` : dayFmt.format(target)));

	return {
		root,
		everyMs: () => 250,
		update: (now) => {
			const p = countdownParts(targetMs, now);
			unitsEl.hidden = p.done;
			doneEl.hidden = !p.done;
			if (p.done) return;
			for (const u of units) {
				const n = p[u.key];
				setText(u.num, u.key === "days" ? String(n) : pad2(n));
				setText(u.lbl, unitLabel(lang, u.unit, n));
			}
		},
	};
}

function buildStopwatch(ctx: WidgetContext): WidgetBuild {
	const { params, lang, root, store, host } = ctx;
	const showLaps = paramBool(params, "laps", true);
	const k = stateKey(ctx, "stopwatch");
	const read = (): StopwatchState => {
		const v = store.get(k.key, k.persistent);
		return isStopwatchState(v) ? v : stopwatchInitial();
	};
	const write = (s: StopwatchState) => {
		store.set(k.key, k.persistent, s);
		if (k.persistent) host.persist();
	};

	root.classList.add("qnb-widget-stopwatch");
	addLabel(ctx);
	const timeEl = root.appendChild(h("div", "qnb-widget-sw-time"));
	const buttons = root.appendChild(h("div", "qnb-widget-buttons"));
	const toggleBtn = buttons.appendChild(makeButton("", "mod-cta qnb-widget-btn", () => {
		const s = read();
		write(s.running ? stopwatchPause(s, Date.now()) : stopwatchStart(s, Date.now()));
		refresh(Date.now());
	}));
	const lapBtn = showLaps
		? buttons.appendChild(makeButton(t(lang, "widget.lap"), "qnb-widget-btn", () => {
				write(stopwatchLap(read(), Date.now()));
				refresh(Date.now());
			}))
		: null;
	const resetBtn = buttons.appendChild(makeButton(t(lang, "widget.reset"), "qnb-widget-btn", () => {
		write(stopwatchInitial());
		refresh(Date.now());
	}));
	const lapsEl = showLaps ? root.appendChild(h("div", "qnb-widget-laps")) : null;
	let drawnLaps = -1;

	function refresh(now: number) {
		const s = read();
		const elapsed = stopwatchElapsed(s, now);
		setText(timeEl, formatStopwatch(elapsed));
		setText(toggleBtn, t(lang, s.running ? "widget.pause" : elapsed > 0 ? "widget.resume" : "widget.start"));
		resetBtn.disabled = !s.running && elapsed === 0;
		if (lapBtn) lapBtn.disabled = !s.running;
		if (lapsEl && drawnLaps !== s.laps.length) {
			drawnLaps = s.laps.length;
			lapsEl.textContent = "";
			const first = Math.max(0, s.laps.length - LAPS_SHOWN);
			for (let i = s.laps.length - 1; i >= first; i--) {
				const row = lapsEl.appendChild(h("div", "qnb-widget-lap"));
				row.appendChild(h("span", "qnb-widget-lap-n", t(lang, "widget.lapLine", { n: String(i + 1) })));
				row.appendChild(h("span", "qnb-widget-lap-split", formatStopwatch(s.laps[i] - (i > 0 ? s.laps[i - 1] : 0))));
				row.appendChild(h("span", "qnb-widget-lap-total", formatStopwatch(s.laps[i])));
			}
		}
	}
	refresh(Date.now());

	return {
		root,
		// Con il cronometro in marcia servono i decimi di secondo.
		everyMs: () => (read().running ? 100 : 1000),
		update: refresh,
	};
}

function buildPomodoro(ctx: WidgetContext): WidgetBuild {
	const { params, lang, root, store, host } = ctx;
	const cfg: PomodoroConfig = {
		work: paramInt(params, "work", 25, 1, 600),
		brk: paramInt(params, "break", 5, 1, 600),
		longBreak: paramInt(params, "longbreak", 15, 1, 600),
		cycles: paramInt(params, "cycles", 4, 1, 12),
		label: params.label || "",
	};
	const k = stateKey(ctx, "pomodoro");
	const read = (): PomodoroState => {
		const v = store.get(k.key, k.persistent);
		return isPomodoroState(v) ? v : pomodoroInitial(cfg);
	};
	const write = (s: PomodoroState) => {
		store.set(k.key, k.persistent, s);
		if (k.persistent) host.persist();
	};
	// Allinea lo stato salvato a quanto scritto ora nel blocco (durate, etichetta); si
	// scrive su disco solo se qualcosa è cambiato, non a ogni ridisegno della nota.
	const existing = store.get(k.key, k.persistent);
	const synced = isPomodoroState(existing) ? pomodoroSyncConfig(existing, cfg) : pomodoroInitial(cfg);
	if (synced !== existing) write(synced);

	root.classList.add("qnb-widget-pomodoro");
	addLabel(ctx);
	const phaseEl = root.appendChild(h("div", "qnb-widget-pomo-phase"));
	const timeEl = root.appendChild(h("div", "qnb-widget-pomo-time"));
	const progress = root.appendChild(h("div", "qnb-widget-progress"));
	const bar = progress.appendChild(h("div", "qnb-widget-progress-bar"));
	const dotsEl = root.appendChild(h("div", "qnb-widget-pomo-dots"));
	const doneEl = root.appendChild(h("div", "qnb-widget-pomo-completed"));
	const buttons = root.appendChild(h("div", "qnb-widget-buttons"));
	const toggleBtn = buttons.appendChild(makeButton("", "mod-cta qnb-widget-btn", () => {
		const s = read();
		write(s.running ? pomodoroPause(s, Date.now()) : pomodoroStart(s, Date.now()));
		refresh(Date.now());
	}));
	buttons.appendChild(makeButton(t(lang, "widget.reset"), "qnb-widget-btn", () => {
		write(pomodoroInitial(read().config));
		refresh(Date.now());
	}));
	buttons.appendChild(makeButton(t(lang, "widget.skip"), "qnb-widget-btn", () => {
		write(pomodoroAdvance(read(), false));
		refresh(Date.now());
	}));

	let drawnDots = "";
	let drawnProgress = "";
	let drawnPhase = "";

	function refresh(now: number) {
		const s = read();
		const total = phaseMs(s.config, s.phase);
		const remaining = s.running ? Math.max(0, s.endsAt - now) : s.remainingMs;
		setText(timeEl, formatCountdownClock(remaining));
		setText(phaseEl, t(lang, `widget.pomodoro.${s.phase}`));
		if (drawnPhase !== s.phase) {
			drawnPhase = s.phase;
			root.classList.remove("qnb-widget-pomo-work", "qnb-widget-pomo-break", "qnb-widget-pomo-longbreak");
			root.classList.add(`qnb-widget-pomo-${s.phase}`);
		}
		const pct = `${(Math.min(1, Math.max(0, 1 - remaining / total)) * 100).toFixed(1)}%`;
		if (pct !== drawnProgress) {
			drawnProgress = pct;
			setCssVar(bar, "--qnb-progress", pct);
		}
		const filled = s.phase === "longbreak" ? s.config.cycles : s.cycle;
		const dotsKey = `${filled}/${s.config.cycles}`;
		if (dotsKey !== drawnDots) {
			drawnDots = dotsKey;
			dotsEl.textContent = "";
			for (let i = 0; i < s.config.cycles; i++) dotsEl.appendChild(h("span", "qnb-widget-pomo-dot" + (i < filled ? " qnb-widget-pomo-dot-on" : "")));
		}
		setText(doneEl, t(lang, "widget.pomodoro.completed", { n: String(s.completed) }));
		const untouched = !s.running && s.remainingMs === total;
		setText(toggleBtn, t(lang, s.running ? "widget.pause" : untouched ? "widget.start" : "widget.resume"));
	}
	refresh(Date.now());

	return { root, everyMs: () => 250, update: refresh };
}

const BUILDERS: Record<WidgetType, (ctx: WidgetContext) => WidgetBuild> = {
	clock: buildClock,
	calendar: buildCalendar,
	countdown: buildCountdown,
	stopwatch: buildStopwatch,
	pomodoro: buildPomodoro,
};

// ============================== Gestione ==============================

/** Crea i widget a partire dal testo dei blocchi `QNBWidget` e li tiene aggiornati con un
 * unico timer. I widget il cui elemento non è più nella pagina (nota ridisegnata o
 * chiusa) vengono dimenticati da soli. Le fasi del pomodoro vengono chiuse qui, anche se
 * nessun widget è a schermo: così l'avviso arriva a board chiusa. */
export class WidgetManager {
	readonly store = new WidgetStateStore();
	private entries = new Set<{ inst: WidgetInstance; createdAt: number; lastRun: number }>();

	constructor(private host: WidgetHost) {}

	/** Disegna il widget descritto da `source` dentro `container`. */
	render(source: string, container: HTMLElement) {
		const lang = this.host.lang();
		const params = parseWidgetParams(source);
		const root = container.appendChild(h("div", "qnb-widget"));
		const type = (params.type || "").trim().toLowerCase();

		let error = "";
		let built: WidgetBuild | null = null;
		if (!type) error = t(lang, "widget.error.noType");
		else if (!(WIDGET_TYPES as readonly string[]).includes(type)) {
			error = t(lang, "widget.error.unknownType", { type, list: WIDGET_TYPES.join(", ") });
		} else {
			built = BUILDERS[type as WidgetType]({ root, params, lang, source, store: this.store, host: this.host });
			if ("error" in built) error = built.error;
		}

		if (error || !built || "error" in built) {
			root.className = "qnb-widget qnb-widget-error";
			root.textContent = "";
			root.appendChild(h("div", "qnb-widget-error-text", error));
			return;
		}
		const lines = type !== "calendar" ? this.host.accentLines() : null;
		if (lines) {
			root.classList.add("qnb-widget-lines");
			setCssVar(root, "--qnb-widget-line-color", lines.color);
			setCssVar(root, "--qnb-widget-line-width", `${lines.width}px`);
		}
		const now = Date.now();
		this.entries.add({ inst: built, createdAt: now, lastRun: now });
		built.update(now);
	}

	/** Da richiamare più volte al secondo (ogni 100 ms). */
	tick(now: number = Date.now()) {
		this.processPomodoros(now);
		for (const entry of Array.from(this.entries)) {
			const { inst } = entry;
			if (!inst.root.isConnected) {
				// Appena creato può non essere ancora nella pagina: gli si dà qualche secondo.
				if (now - entry.createdAt > 3000) this.entries.delete(entry);
				continue;
			}
			if (now - entry.lastRun < inst.everyMs()) continue;
			entry.lastRun = now;
			try {
				inst.update(now);
			} catch (e) {
				console.error("Quick Notes Board: errore in un widget", e);
				this.entries.delete(entry);
			}
		}
	}

	private processPomodoros(now: number) {
		for (const { key, persistent, value } of this.store.entries()) {
			if (!key.startsWith("pomodoro") || !isPomodoroState(value)) continue;
			const r = pomodoroTick(value, now);
			if (!r.ended) continue;
			this.store.set(key, persistent, r.state);
			if (persistent) this.host.persist();
			this.host.notifyPomodoro({
				label: value.config.label,
				ended: r.ended,
				next: r.state.phase,
				endedAt: r.endedAt,
				late: now - r.endedAt > 10000,
			});
		}
	}
}
