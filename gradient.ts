/**
 * Sfumatura di sfondo (opzionale) per la barra del titolo delle note di una categoria.
 * Modulo privo di dipendenze da Obsidian, così la logica si può provare da sola.
 *
 * Il colore di inizio è sempre il colore ordinario della categoria (`color`): tutto il
 * resto del plugin continua a usare solo quello e non si accorge della sfumatura. Con la
 * sfumatura spenta (o incompleta) il risultato è identico a quello di sempre.
 */

export type QnbGradientDirection =
	| "to-right"
	| "to-left"
	| "to-bottom"
	| "to-top"
	| "diag-down-right"
	| "diag-down-left";

/** Gli orientamenti selezionabili, nell'ordine del menu. Le due diagonali usano un angolo
 * fisso di 45° e non "corner to corner": su una barra larga e bassa come quella del titolo,
 * la diagonale da angolo ad angolo risulterebbe quasi verticale e non si noterebbe. */
export const GRADIENT_DIRECTIONS: { value: QnbGradientDirection; css: string; labelKey: string }[] = [
	{ value: "to-right", css: "to right", labelKey: "settings.categories.gradient.dir.toRight" },
	{ value: "to-left", css: "to left", labelKey: "settings.categories.gradient.dir.toLeft" },
	{ value: "to-bottom", css: "to bottom", labelKey: "settings.categories.gradient.dir.toBottom" },
	{ value: "to-top", css: "to top", labelKey: "settings.categories.gradient.dir.toTop" },
	{ value: "diag-down-right", css: "135deg", labelKey: "settings.categories.gradient.dir.diagDownRight" },
	{ value: "diag-down-left", css: "225deg", labelKey: "settings.categories.gradient.dir.diagDownLeft" },
];

export const DEFAULT_GRADIENT_DIRECTION: QnbGradientDirection = "to-right";

// ===== ANIMAZIONE SFUMATURA (inizio) =====
export const MIN_GRADIENT_ANIMATION_SECONDS = 1;
export const MAX_GRADIENT_ANIMATION_SECONDS = 10;
export const DEFAULT_GRADIENT_ANIMATION_SECONDS = 3;

/** Ripulisce un valore letto dal file dati: fuori dai limiti 1-10, non numerico o assente
 * torna il valore predefinito. Un numero con decimali viene arrotondato all'intero più
 * vicino, perché il controllo nel pannello lavora solo per passi interi. */
export function normalizeGradientAnimationSeconds(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_GRADIENT_ANIMATION_SECONDS;
	const rounded = Math.round(value);
	if (rounded < MIN_GRADIENT_ANIMATION_SECONDS || rounded > MAX_GRADIENT_ANIMATION_SECONDS) {
		return DEFAULT_GRADIENT_ANIMATION_SECONDS;
	}
	return rounded;
}
// ===== ANIMAZIONE SFUMATURA (fine) =====

/** Ripulisce un valore letto dal file dati: se non è un orientamento noto, torna quello
 * predefinito, così un file modificato a mano non rompe il rendering. */
export function normalizeGradientDirection(value: unknown): QnbGradientDirection {
	return GRADIENT_DIRECTIONS.some((d) => d.value === value)
		? (value as QnbGradientDirection)
		: DEFAULT_GRADIENT_DIRECTION;
}

/** True per un colore esadecimale completo "#rrggbb" (quello prodotto dal selettore colore). */
export function isHexColor(value: unknown): value is string {
	return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Colore medio dei due estremi, "#rrggbb". Serve a scegliere il colore del testo. */
export function mixHexColors(a: string, b: string): string {
	const channel = (hex: string, from: number) => parseInt(hex.substring(from, from + 2), 16);
	const mix = (from: number) =>
		Math.round((channel(a, from) + channel(b, from)) / 2)
			.toString(16)
			.padStart(2, "0");
	return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** Il valore CSS `linear-gradient(...)` per i due colori e l'orientamento dati. */
export function buildGradientCss(start: string, end: string, direction: QnbGradientDirection): string {
	const css = GRADIENT_DIRECTIONS.find((d) => d.value === direction)?.css ?? "to right";
	return `linear-gradient(${css}, ${start}, ${end})`;
}

export interface CategoryBackgroundFields {
	color: string;
	gradientEnabled?: boolean;
	gradientEndColor?: string;
	gradientDirection?: QnbGradientDirection;
	// ===== ANIMAZIONE SFUMATURA (inizio) — per rimuovere tutta la funzione, cercare
	// ovunque questo stesso marcatore in tutti i file e togliere ciò che racchiude. =====
	/** Se true (e la sfumatura è accesa e valida), la barra scorre avanti e indietro tra
	 * i due colori invece di restare ferma. Di per sé non fa nulla se la sfumatura non è
	 * attiva: stesso principio della sfumatura rispetto al colore singolo. */
	gradientAnimated?: boolean;
	/** Durata di un passaggio completo (da un estremo all'altro), in secondi: 1-10. */
	gradientAnimationSeconds?: number;
	/** Se true, l'animazione parte solo mentre passi il mouse sulla nota, la modifichi o la
	 * trascini: da ferma appena la lasci. Se false (o assente), anima sempre. Non ha
	 * effetto se `gradientAnimated` non è vero. */
	gradientAnimateHoverOnly?: boolean;
	// ===== ANIMAZIONE SFUMATURA (fine) =====
}

export interface ResolvedCategoryBackground {
	/** Colore singolo: quello di sempre. Resta sempre impostato, anche con la sfumatura,
	 * come colore di riserva se l'immagine non si applicasse. */
	color: string;
	/** `linear-gradient(...)` da applicare come immagine di sfondo, oppure null se la
	 * sfumatura è spenta o non valida (in quel caso non cambia nulla rispetto a prima). */
	image: string | null;
	/** Colore su cui calcolare il contrasto del testo: il colore singolo, oppure la media
	 * dei due estremi quando c'è la sfumatura. */
	contrastBase: string;
	// ===== ANIMAZIONE SFUMATURA (inizio) =====
	/** True solo se la sfumatura è attiva, valida, E l'animazione è accesa. Se false, chi
	 * consuma questo valore non deve aggiungere né classi né variabili di animazione. */
	animated: boolean;
	/** Durata di un passaggio, in secondi, già normalizzata (1-10). Significativa solo
	 * quando `animated` è true. */
	animationSeconds: number;
	/** True se l'animazione (quando attiva) deve partire solo su passaggio del mouse,
	 * modifica o trascinamento, invece che sempre. Significativa solo quando `animated`
	 * è true. */
	animateHoverOnly: boolean;
	// ===== ANIMAZIONE SFUMATURA (fine) =====
}

/** Decide come colorare lo sfondo di una categoria. La sfumatura si applica solo se è
 * accesa E entrambi i colori sono validi: in ogni altro caso il risultato coincide con
 * quello che il plugin dava prima che la sfumatura esistesse. */
export function resolveCategoryBackground(cat: CategoryBackgroundFields): ResolvedCategoryBackground {
	if (cat.gradientEnabled === true && isHexColor(cat.color) && isHexColor(cat.gradientEndColor)) {
		const direction = normalizeGradientDirection(cat.gradientDirection);
		return {
			color: cat.color,
			image: buildGradientCss(cat.color, cat.gradientEndColor, direction),
			contrastBase: mixHexColors(cat.color, cat.gradientEndColor),
			// ===== ANIMAZIONE SFUMATURA (inizio) =====
			animated: cat.gradientAnimated === true,
			animationSeconds: normalizeGradientAnimationSeconds(cat.gradientAnimationSeconds),
			// Significativo solo se l'animazione stessa è accesa: forzato a falso altrimenti,
			// così chi legge questo campo non deve prima controllare `animated` per essere
			// al sicuro da un valore fuorviante.
			animateHoverOnly: cat.gradientAnimated === true && cat.gradientAnimateHoverOnly === true,
			// ===== ANIMAZIONE SFUMATURA (fine) =====
		};
	}
	// ===== ANIMAZIONE SFUMATURA (inizio) — senza sfumatura valida, animated è sempre
	// false: non ha senso animare un colore singolo, e nessuno deve poterlo attivare. =====
	return {
		color: cat.color,
		image: null,
		contrastBase: cat.color,
		animated: false,
		animationSeconds: DEFAULT_GRADIENT_ANIMATION_SECONDS,
		animateHoverOnly: false,
	};
	// ===== ANIMAZIONE SFUMATURA (fine) =====
}

/** Colore finale proposto la prima volta che si accende la sfumatura, così l'effetto si
 * vede subito: il colore di inizio schiarito (o scurito, se è già chiaro) del 40%. */
export function defaultGradientEndColor(start: string): string {
	if (!isHexColor(start)) return "#ffffff";
	const r = parseInt(start.substring(1, 3), 16);
	const g = parseInt(start.substring(3, 5), 16);
	const b = parseInt(start.substring(5, 7), 16);
	const isLight = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
	return blend(start, isLight ? "#000000" : "#ffffff", 0.4);
}

/** Mescola `a` con `b`: `amount` 0 = solo a, 1 = solo b. */
function blend(a: string, b: string, amount: number): string {
	const channel = (hex: string, from: number) => parseInt(hex.substring(from, from + 2), 16);
	const mix = (from: number) =>
		Math.round(channel(a, from) * (1 - amount) + channel(b, from) * amount)
			.toString(16)
			.padStart(2, "0");
	return `#${mix(1)}${mix(3)}${mix(5)}`;
}
