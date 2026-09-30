/**
 * Posticipo rapido ("snooze") degli allarmi: elenco delle durate selezionabili e calcolo
 * della scadenza. Modulo volutamente privo di dipendenze da Obsidian, così la logica
 * (in particolare il caso "il posticipo supera la mezzanotte") si può provare da sola.
 */

/** Durate selezionabili, in minuti, nell'ordine in cui compaiono nel menu. */
export const SNOOZE_OPTIONS_MINUTES: readonly number[] = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 45, 60];

/** Durata proposta quando non ne è mai stata usata una. */
export const DEFAULT_SNOOZE_MINUTES = 10;

/** Ripulisce un valore letto da impostazioni/dati: se non è una delle durate ammesse
 * torna quella predefinita, così un file dati modificato a mano non rompe il menu. */
export function normalizeSnoozeMinutes(value: unknown): number {
	return typeof value === "number" && SNOOZE_OPTIONS_MINUTES.includes(value)
		? value
		: DEFAULT_SNOOZE_MINUTES;
}

/** Etichetta leggibile: 1 → "1 minuto", 10 → "10 minuti", 60 → "1 ora". `tr` risolve
 * le chiavi di traduzione (una per singolare/plurale dei minuti e una per l'ora). */
export function formatSnoozeLabel(
	minutes: number,
	tr: (key: string, vars?: Record<string, string>) => string
): string {
	if (minutes === 60) return tr("snooze.oneHour");
	return minutes === 1
		? tr("snooze.oneMinute")
		: tr("snooze.minutes", { count: String(minutes) });
}

/** Stessa data di calendario locale (giorno, mese, anno) per due istanti. */
function sameLocalDay(aMs: number, bMs: number): boolean {
	const a = new Date(aMs);
	const b = new Date(bMs);
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** Calcola fino a quando posticipare. `crossesMidnight` è vero se la scadenza cade in un
 * giorno diverso da quello di partenza: chi chiama decide cosa fare (per un allarme la
 * cui finestra finisce oggi, altrimenti non suonerebbe mai più). La scadenza è
 * arrotondata al secondo, la precisione con cui viene salvata sulla nota. */
export function computeSnooze(
	nowMs: number,
	minutes: number
): { untilMs: number; crossesMidnight: boolean } {
	const untilMs = Math.round((nowMs + minutes * 60000) / 1000) * 1000;
	return { untilMs, crossesMidnight: !sameLocalDay(nowMs, untilMs) };
}

/** Ora locale "HH:MM" di un istante (per i messaggi e la lista allarmi). */
export function formatClock(ms: number): string {
	const d = new Date(ms);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
