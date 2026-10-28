/**
 * Obiettivi personalizzati: logica pura, senza dipendenze da Obsidian.
 *
 * Pensata per essere leggera: non tiene contatori per le azioni che la board già registra
 * (note create = date di creazione delle note, note modificate = registro attività). Il
 * progresso si calcola solo quando serve (finestra aperta o azione appena compiuta), mai in
 * un ciclo periodico, e l'unico dato nuovo salvato sono gli obiettivi, i premi ottenuti e due
 * piccoli contatori giornalieri (note archiviate, pomodori).
 */

export type GoalAction =
	| "create"
	| "modify"
	| "chars"
	| "delete"
	| "archive"
	| "label"
	| "alarm"
	| "alarmOff"
	| "alarmOn"
	| "pomodoro"
	| "activeDay"
	| "moveNote"
	| "resizeNote"
	| "closeNote"
	| "favorite"
	| "emptyTrash"
	| "restoreNote"
	| "search"
	| "tidyUp"
	| "viewActivity"
	| "widget"
	| "alarmRing"
	| "alarmRemove"
	| "labelAdd"
	| "labelRemove"
	| "labelOrganize"
	| "duplicate"
	| "changeCategory";
/** Le azioni che la board non registra altrove e che quindi hanno un contatore giornaliero. */
export type CounterKind = "archive" | "pomodoro" | "delete" | "alarm" | "alarmOff" | "alarmOn" | "moveNote" | "resizeNote" | "closeNote" | "favorite" | "emptyTrash" | "restoreNote" | "search" | "tidyUp" | "viewActivity" | "widget" | "alarmRing" | "alarmRemove" | "labelAdd" | "labelRemove" | "labelOrganize" | "duplicate" | "changeCategory" | "chars" | "label";
export type GoalPeriod = "day" | "week" | "month" | "year";

export const GOAL_ACTIONS: readonly GoalAction[] = [
	"create",
	"modify",
	"chars",
	"delete",
	"archive",
	"label",
	"alarm",
	"alarmOff",
	"alarmOn",
	"pomodoro",
	"activeDay",
	"moveNote",
	"resizeNote",
	"closeNote",
	"favorite",
	"emptyTrash",
	"restoreNote",
	"search",
	"tidyUp",
	"viewActivity",
	"widget",
	"alarmRing",
	"alarmRemove",
	"labelAdd",
	"labelRemove",
	"labelOrganize",
	"duplicate",
	"changeCategory",
];

/** Come le azioni si raggruppano nel menu "Cosa devo fare?": un sottomenu per gruppo. Ogni
 * azione di GOAL_ACTIONS compare in un solo gruppo. */
export const GOAL_ACTION_GROUPS: readonly { id: string; icon: string; actions: readonly GoalAction[] }[] = [
	{ id: "notes", icon: "file-text", actions: ["create", "modify", "chars", "delete", "archive", "favorite", "duplicate", "changeCategory", "moveNote", "resizeNote", "closeNote"] },
	{ id: "labels", icon: "tag", actions: ["label", "labelAdd", "labelRemove", "labelOrganize"] },
	{ id: "alarms", icon: "alarm-clock", actions: ["alarm", "alarmRing", "alarmRemove", "alarmOff", "alarmOn"] },
	{ id: "activity", icon: "activity", actions: ["pomodoro", "activeDay", "emptyTrash", "restoreNote", "search", "tidyUp", "viewActivity", "widget"] },
];
export const GOAL_PERIODS: readonly GoalPeriod[] = ["day", "week", "month", "year"];

/** Valore massimo di "Quante volte?" accettato, per tenere i numeri sensati. */
export const GOAL_MAX_TARGET = 9999999;

export interface Goal {
	id: string;
	/** Nome scelto dall'utente; vuoto = nome automatico. */
	name: string;
	action: GoalAction;
	target: number;
	period: GoalPeriod;
	/** Solo per "create" e "modify": conta solo le note di questa categoria; vuoto = tutte. */
	category: string;
	/** Solo per "label": id dell'etichetta da assegnare; vuoto = una qualsiasi. */
	label: string;
}

/** Contatori di un giorno. "labels" conta le assegnazioni per etichetta (id → volte). */
export interface DayCounters {
	archive?: number;
	pomodoro?: number;
	delete?: number;
	alarm?: number;
	alarmOff?: number;
	alarmOn?: number;
	moveNote?: number;
	resizeNote?: number;
	closeNote?: number;
	favorite?: number;
	emptyTrash?: number;
	restoreNote?: number;
	search?: number;
	tidyUp?: number;
	widget?: number;
	alarmRing?: number;
	alarmRemove?: number;
	labelAdd?: number;
	labelRemove?: number;
	labelOrganize?: number;
	duplicate?: number;
	changeCategory?: number;
	viewActivity?: number;
	chars?: number;
	labels?: Record<string, number>;
}

export interface GoalsState {
	goals: Goal[];
	/** Premi ottenuti: "idObiettivo|chiavePeriodo" → istante (ms). Restano anche se l'obiettivo
	 * viene poi eliminato o cambiato. */
	awards: Record<string, number>;
	/** Ultimo nome noto degli obiettivi eliminati ("idObiettivo" → nome), per leggere lo storico
	 * delle medaglie anche dopo l'eliminazione. */
	names: Record<string, string>;
	/** Azioni che la board non registra altrove: data "YYYY-MM-DD" → conteggi del giorno. */
	counters: Record<string, DayCounters>;
}

/** Quello che serve per calcolare il progresso, letto dalla board così com'è. */
export interface GoalSources {
	notes: readonly { id: string; createdAt: number; category: string; deleted: boolean }[];
	/** Registro attività: giorno → id delle note modificate quel giorno. */
	activityLog: Readonly<Record<string, readonly string[]>>;
}

export function emptyGoalsState(): GoalsState {
	return { goals: [], awards: {}, names: {}, counters: {} };
}

// ===== Date e periodi =====

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

/** Giorno locale "YYYY-MM-DD". */
export function dayKey(ts: number | Date): string {
	const d = typeof ts === "number" ? new Date(ts) : ts;
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export interface PeriodRange {
	key: string;
	/** Da mezzanotte locale del primo giorno (incluso) a quella del giorno dopo l'ultimo (escluso). */
	startMs: number;
	endMs: number;
	startDay: string;
	endDay: string;
}

/** Il periodo (giorno, settimana ISO con inizio il lunedì, mese, anno) che contiene `ts`. */
export function periodRange(period: GoalPeriod, ts: number): PeriodRange {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = d.getMonth();
	const day = d.getDate();
	let start: Date;
	let endExcl: Date;
	let key: string;
	if (period === "day") {
		start = new Date(y, m, day);
		endExcl = new Date(y, m, day + 1);
		key = dayKey(start);
	} else if (period === "week") {
		const back = (d.getDay() + 6) % 7;
		start = new Date(y, m, day - back);
		endExcl = new Date(y, m, day - back + 7);
		// Settimana ISO: appartiene all'anno del suo giovedì.
		const thu = new Date(y, m, day - back + 3);
		const jan1 = new Date(thu.getFullYear(), 0, 1);
		const doy = Math.round((new Date(thu.getFullYear(), thu.getMonth(), thu.getDate()).getTime() - jan1.getTime()) / 86400000);
		key = `${thu.getFullYear()}-W${pad2(Math.floor(doy / 7) + 1)}`;
	} else if (period === "month") {
		start = new Date(y, m, 1);
		endExcl = new Date(y, m + 1, 1);
		key = `${y}-${pad2(m + 1)}`;
	} else {
		start = new Date(y, 0, 1);
		endExcl = new Date(y + 1, 0, 1);
		key = String(y);
	}
	const last = new Date(endExcl.getFullYear(), endExcl.getMonth(), endExcl.getDate() - 1);
	return { key, startMs: start.getTime(), endMs: endExcl.getTime(), startDay: dayKey(start), endDay: dayKey(last) };
}

/** Periodo a cui appartiene una chiave periodo (null se non riconosciuta). */
export function periodOfKey(key: string): GoalPeriod | null {
	if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return "day";
	if (/^\d{4}-W\d{2}$/.test(key)) return "week";
	if (/^\d{4}-\d{2}$/.test(key)) return "month";
	if (/^\d{4}$/.test(key)) return "year";
	return null;
}

export function awardKey(goalId: string, periodKey: string): string {
	return `${goalId}|${periodKey}`;
}

// ===== Progresso =====

export function goalProgress(goal: Goal, range: PeriodRange, src: GoalSources, state: GoalsState): number {
	const cat = goal.action === "create" || goal.action === "modify" ? goal.category : "";
	switch (goal.action) {
		case "create": {
			let n = 0;
			for (const note of src.notes) {
				if (note.deleted || note.createdAt < range.startMs || note.createdAt >= range.endMs) continue;
				if (cat && note.category !== cat) continue;
				n++;
			}
			return n;
		}
		case "modify": {
			const category = new Map<string, string>();
			if (cat) for (const note of src.notes) category.set(note.id, note.category);
			const seen = new Set<string>();
			for (const day of Object.keys(src.activityLog)) {
				if (day < range.startDay || day > range.endDay) continue;
				for (const id of src.activityLog[day]) {
					if (cat && category.get(id) !== cat) continue;
					seen.add(id);
				}
			}
			return seen.size;
		}
		case "label": {
			let n = 0;
			for (const day of Object.keys(state.counters)) {
				if (day < range.startDay || day > range.endDay) continue;
				const labels = state.counters[day].labels;
				if (!labels) continue;
				if (goal.label) n += labels[goal.label] ?? 0;
				else for (const id of Object.keys(labels)) n += labels[id];
			}
			return n;
		}
		case "archive":
		case "pomodoro":
		case "delete":
		case "alarm":
		case "alarmOff":
		case "alarmOn":
		case "moveNote":
		case "resizeNote":
		case "closeNote":
		case "favorite":
		case "emptyTrash":
		case "restoreNote":
		case "search":
		case "tidyUp":
		case "viewActivity":
		case "widget":
		case "alarmRing":
		case "alarmRemove":
		case "labelAdd":
		case "labelRemove":
		case "labelOrganize":
		case "duplicate":
		case "changeCategory":
		case "chars": {
			let n = 0;
			for (const day of Object.keys(state.counters)) {
				if (day < range.startDay || day > range.endDay) continue;
				n += state.counters[day][goal.action] ?? 0;
			}
			return n;
		}
		case "activeDay": {
			const days = new Set<string>();
			for (const day of Object.keys(src.activityLog)) {
				if (day >= range.startDay && day <= range.endDay && src.activityLog[day].length > 0) days.add(day);
			}
			for (const day of Object.keys(state.counters)) {
				if (day < range.startDay || day > range.endDay) continue;
				if (hasActivity(state.counters[day])) days.add(day);
			}
			for (const note of src.notes) {
				if (!note.deleted && note.createdAt >= range.startMs && note.createdAt < range.endMs) days.add(dayKey(note.createdAt));
			}
			return days.size;
		}
	}
}

export interface GoalAwarded {
	goal: Goal;
	periodKey: string;
}

/** Controlla gli obiettivi interessati da `action` (tutti se omessa) nel periodo in corso e
 * assegna il premio a quelli appena raggiunti. Restituisce i nuovi premi. */
export function evaluateGoals(state: GoalsState, src: GoalSources, now: number, actions?: ReadonlySet<GoalAction>): GoalAwarded[] {
	const awarded: GoalAwarded[] = [];
	for (const goal of state.goals) {
		if (actions && !actions.has(goal.action) && goal.action !== "activeDay") continue;
		const range = periodRange(goal.period, now);
		const key = awardKey(goal.id, range.key);
		if (key in state.awards) continue;
		if (goalProgress(goal, range, src, state) >= goal.target) {
			state.awards[key] = now;
			awarded.push({ goal, periodKey: range.key });
		}
	}
	return awarded;
}

function hasActivity(c: DayCounters): boolean {
	return (
		(c.archive ?? 0) > 0 ||
		(c.pomodoro ?? 0) > 0 ||
		(c.delete ?? 0) > 0 ||
		(c.alarm ?? 0) > 0 ||
		(c.alarmOff ?? 0) > 0 ||
		(c.alarmOn ?? 0) > 0 ||
		(c.moveNote ?? 0) > 0 ||
		(c.resizeNote ?? 0) > 0 ||
		(c.closeNote ?? 0) > 0 ||
		(c.favorite ?? 0) > 0 ||
		(c.emptyTrash ?? 0) > 0 ||
		(c.restoreNote ?? 0) > 0 ||
		(c.tidyUp ?? 0) > 0 ||
		(c.widget ?? 0) > 0 ||
		(c.alarmRing ?? 0) > 0 ||
		(c.alarmRemove ?? 0) > 0 ||
		(c.labelAdd ?? 0) > 0 ||
		(c.labelRemove ?? 0) > 0 ||
		(c.labelOrganize ?? 0) > 0 ||
		(c.duplicate ?? 0) > 0 ||
		(c.changeCategory ?? 0) > 0 ||
		(c.chars ?? 0) > 0 ||
		(c.labels !== undefined && Object.keys(c.labels).length > 0)
	);
}

/** Azzera medaglie e serie. Gli obiettivi già raggiunti nel periodo in corso restano segnati
 * come fatti, senza medaglia (valore 0), così non vengono premiati di nuovo subito dopo. */
export function resetMedals(state: GoalsState, src: GoalSources, now: number) {
	state.awards = {};
	for (const goal of state.goals) {
		const range = periodRange(goal.period, now);
		if (goalProgress(goal, range, src, state) >= goal.target) state.awards[awardKey(goal.id, range.key)] = 0;
	}
}

/** Aggiunge `n` al contatore del giorno di `ts`. Per "label", `labelId` è l'etichetta assegnata. */
export function bumpCounter(state: GoalsState, kind: CounterKind, ts: number, n = 1, labelId = "") {
	const key = dayKey(ts);
	const c = state.counters[key] ?? (state.counters[key] = {});
	if (kind === "label") {
		const labels = c.labels ?? (c.labels = {});
		labels[labelId] = (labels[labelId] ?? 0) + n;
		return;
	}
	c[kind] = (c[kind] ?? 0) + n;
}

// ===== Riepilogo, medaglie e serie =====

export interface GoalsSummary {
	/** Premi per periodo: giorno = bronzo, settimana = argento, mese = oro, anno = trofeo. */
	counts: Record<GoalPeriod, number>;
	total: number;
	/** Giorni di fila, fino a oggi, con almeno un obiettivo giornaliero completato. Se oggi non
	 * ne è ancora stato completato nessuno, la serie conta fino a ieri. */
	streak: number;
	bestStreak: number;
}

function prevDay(key: string): string {
	const [y, m, d] = key.split("-").map(Number);
	return dayKey(new Date(y, m - 1, d - 1));
}

export function summarizeGoals(state: GoalsState, now: number): GoalsSummary {
	const counts: Record<GoalPeriod, number> = { day: 0, week: 0, month: 0, year: 0 };
	const days: string[] = [];
	let total = 0;
	for (const k of Object.keys(state.awards)) {
		if (!state.awards[k]) continue; // 0 = obiettivo già raggiunto ma senza medaglia (dopo un azzeramento)
		const period = periodOfKey(k.slice(k.indexOf("|") + 1));
		if (!period) continue;
		counts[period]++;
		total++;
		if (period === "day") days.push(k.slice(k.indexOf("|") + 1));
	}
	const set = new Set(days);
	let streak = 0;
	let cursor = dayKey(now);
	if (!set.has(cursor)) cursor = prevDay(cursor);
	while (set.has(cursor)) {
		streak++;
		cursor = prevDay(cursor);
	}
	let best = 0;
	let run = 0;
	let last = "";
	for (const day of [...set].sort()) {
		run = last && prevDay(day) === last ? run + 1 : 1;
		if (run > best) best = run;
		last = day;
	}
	return { counts, total, streak, bestStreak: best };
}

export interface AwardGroup {
	goalId: string;
	/** Chiavi dei periodi in cui la medaglia è stata ottenuta, dal più recente. */
	periods: { key: string; ts: number }[];
}

/** Medaglie di un livello (giorno, settimana, mese, anno) raggruppate per obiettivo: prima
 * l'obiettivo con più medaglie, a parità quello con la medaglia più recente. */
export function groupAwards(state: GoalsState, period: GoalPeriod): AwardGroup[] {
	const map = new Map<string, AwardGroup>();
	for (const k of Object.keys(state.awards)) {
		const ts = state.awards[k];
		if (!ts) continue;
		const cut = k.indexOf("|");
		const pk = k.slice(cut + 1);
		if (periodOfKey(pk) !== period) continue;
		const id = k.slice(0, cut);
		const g = map.get(id) ?? { goalId: id, periods: [] };
		g.periods.push({ key: pk, ts });
		map.set(id, g);
	}
	const groups = [...map.values()];
	for (const g of groups) g.periods.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : b.ts - a.ts));
	groups.sort((a, b) => b.periods.length - a.periods.length || (b.periods[0].key < a.periods[0].key ? 1 : -1));
	return groups;
}

export interface Milestone {
	id: string;
	kind: "total" | "streak";
	need: number;
}

export const MILESTONES: readonly Milestone[] = [
	{ id: "first", kind: "total", need: 1 },
	{ id: "total10", kind: "total", need: 10 },
	{ id: "total100", kind: "total", need: 100 },
	{ id: "streak3", kind: "streak", need: 3 },
	{ id: "streak7", kind: "streak", need: 7 },
	{ id: "streak30", kind: "streak", need: 30 },
];

export function milestoneReached(m: Milestone, s: GoalsSummary): boolean {
	return (m.kind === "total" ? s.total : s.bestStreak) >= m.need;
}

export interface MilestoneMedal {
	goalId: string;
	periodKey: string;
	period: GoalPeriod;
	ts: number;
}

export interface MilestoneDetail {
	reached: boolean;
	/** Valore attuale (medaglie totali o miglior serie) e valore da raggiungere. */
	current: number;
	need: number;
	/** Totali: la medaglia che ha fatto scattare il traguardo. */
	unlockMedal?: MilestoneMedal;
	/** Serie: ultimo giorno della serie al momento dello sblocco. */
	unlockDay?: string;
	/** Totali: le medaglie che compongono il traguardo, dalla più recente. */
	medals: MilestoneMedal[];
	/** Serie: i giorni della serie, dal più recente, con gli obiettivi giornalieri completati. */
	days: { day: string; goalIds: string[] }[];
}

/** Cosa ha portato a un traguardo: per i totali le medaglie in ordine di data, per le serie i giorni di fila. */
export function milestoneDetail(state: GoalsState, m: Milestone): MilestoneDetail {
	const all: MilestoneMedal[] = [];
	const byDay = new Map<string, string[]>();
	for (const k of Object.keys(state.awards)) {
		const ts = state.awards[k];
		if (!ts) continue;
		const cut = k.indexOf("|");
		const periodKey = k.slice(cut + 1);
		const period = periodOfKey(periodKey);
		if (!period) continue;
		const goalId = k.slice(0, cut);
		all.push({ goalId, periodKey, period, ts });
		if (period === "day") (byDay.get(periodKey) ?? byDay.set(periodKey, []).get(periodKey)!).push(goalId);
	}
	const detail: MilestoneDetail = { reached: false, current: 0, need: m.need, medals: [], days: [] };
	if (m.kind === "total") {
		all.sort((a, b) => a.ts - b.ts);
		detail.current = all.length;
		detail.reached = all.length >= m.need;
		if (detail.reached) {
			detail.unlockMedal = all[m.need - 1];
			detail.medals = all.slice(0, m.need).reverse();
		}
		return detail;
	}
	// Serie: prima sequenza di giorni consecutivi lunga almeno `need` (altrimenti la migliore).
	const sorted = [...byDay.keys()].sort();
	const runs: string[][] = [];
	let cur: string[] = [];
	for (const day of sorted) {
		if (cur.length > 0 && prevDay(day) === cur[cur.length - 1]) cur.push(day);
		else {
			if (cur.length > 0) runs.push(cur);
			cur = [day];
		}
	}
	if (cur.length > 0) runs.push(cur);
	const best = runs.reduce((n, r) => Math.max(n, r.length), 0);
	detail.current = best;
	detail.reached = best >= m.need;
	if (detail.reached) {
		const run = runs.find((r) => r.length >= m.need) as string[];
		detail.unlockDay = run[m.need - 1];
		detail.days = run
			.slice()
			.reverse()
			.map((day) => ({ day, goalIds: byDay.get(day) ?? [] }));
	}
	return detail;
}

/** Obiettivi giornalieri di oggi: quanti sono già completati e quanti sono in tutto. */
export function todayStatus(state: GoalsState, now: number): { done: number; total: number } {
	const today = dayKey(now);
	let done = 0;
	let total = 0;
	for (const goal of state.goals) {
		if (goal.period !== "day") continue;
		total++;
		if (awardKey(goal.id, today) in state.awards) done++;
	}
	return { done, total };
}

// ===== Validazione dei dati letti da disco =====

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

const LEGACY_ACTIONS: Record<string, GoalAction> = { moveWindow: "moveNote", resizeWindow: "resizeNote", closeWindow: "closeNote" };

/** Rende utilizzabili i dati letti da data.json: scarta ciò che non è valido, senza errori. */
export function normalizeGoalsState(raw: unknown): GoalsState {
	const state = emptyGoalsState();
	if (!isRecord(raw)) return state;
	if (Array.isArray(raw.goals)) {
		const ids = new Set<string>();
		for (const g of raw.goals) {
			if (!isRecord(g) || typeof g.id !== "string" || !g.id || ids.has(g.id)) continue;
			// Nomi usati in una versione di prova per le stesse azioni: l'obiettivo si conserva.
			const action = LEGACY_ACTIONS[String(g.action)] ?? g.action;
			if (!GOAL_ACTIONS.includes(action as GoalAction) || !GOAL_PERIODS.includes(g.period as GoalPeriod)) continue;
			const target = Math.round(Number(g.target));
			if (!Number.isFinite(target) || target < 1) continue;
			ids.add(g.id);
			state.goals.push({
				id: g.id,
				name: typeof g.name === "string" ? g.name : "",
				action: action as GoalAction,
				period: g.period as GoalPeriod,
				target: Math.min(target, GOAL_MAX_TARGET),
				category: typeof g.category === "string" ? g.category : "",
				label: typeof g.label === "string" ? g.label : "",
			});
		}
	}
	if (isRecord(raw.awards)) {
		for (const [k, v] of Object.entries(raw.awards)) {
			if (typeof v === "number" && Number.isFinite(v)) state.awards[k] = v;
		}
	}
	if (isRecord(raw.names)) {
		for (const [id, v] of Object.entries(raw.names)) {
			if (typeof v === "string" && v) state.names[id] = v.slice(0, 200);
		}
	}
	if (isRecord(raw.counters)) {
		for (const [day, c] of Object.entries(raw.counters)) {
			if (!isRecord(c)) continue;
			const entry: DayCounters = {};
			for (const kind of ["archive", "pomodoro", "delete", "alarm", "alarmOff", "alarmOn", "moveNote", "resizeNote", "closeNote", "favorite", "emptyTrash", "restoreNote", "search", "tidyUp", "viewActivity", "widget", "alarmRing", "alarmRemove", "labelAdd", "labelRemove", "labelOrganize", "duplicate", "changeCategory", "chars"] as const) {
				const v = c[kind];
				if (typeof v === "number" && v > 0) entry[kind] = v;
			}
			if (isRecord(c.labels)) {
				const labels: Record<string, number> = {};
				for (const [id, v] of Object.entries(c.labels)) if (typeof v === "number" && v > 0) labels[id] = v;
				if (Object.keys(labels).length > 0) entry.labels = labels;
			}
			state.counters[day] = entry;
		}
	}
	return state;
}

export function newGoalId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
