/**
 * Strumenti per le finestre: spostarle trascinando il titolo e ridimensionarle dall'angolo.
 * Solo DOM, nessuna dipendenza da Obsidian. Le finestre sono centrate: lo spostamento usa
 * `left`/`top` (mai `transform`, che Obsidian usa per l'animazione di apertura) e il
 * ridimensionamento cambia la misura del doppio del movimento del mouse, perché la finestra
 * cresce da entrambi i lati.
 */

const DRAG_IGNORE = "button, input, select, textarea, a, .clickable-icon, .qnb-table-edit-grip";
/** Quanta parte della finestra deve restare sempre dentro lo schermo (px). */
const KEEP_VISIBLE = 80;

function clamp(v: number, min: number, max: number): number {
	return Math.min(Math.max(v, min), max);
}

/** Permette di spostare la finestra trascinando un suo elemento (`handleSelector`, cercato
 * al momento del clic, quindi va bene anche se il titolo viene ridisegnato). Non parte dai
 * pulsanti e dai campi, e la finestra non esce mai dallo schermo. Chiamare una volta sola. */
export function enableModalDrag(modalEl: HTMLElement, handleSelector: string) {
	if (getComputedStyle(modalEl).position === "static") modalEl.classList.add("qnb-window-movable");
	modalEl.addEventListener("mousedown", (evt: MouseEvent) => {
		if (evt.button !== 0) return;
		const target = evt.target as HTMLElement | null;
		if (!target) return;
		const handle = target.closest(handleSelector);
		if (!handle || !modalEl.contains(handle) || target.closest(DRAG_IGNORE)) return;
		evt.preventDefault();

		const startX = evt.clientX;
		const startY = evt.clientY;
		const baseLeft = parseFloat(modalEl.style.left) || 0;
		const baseTop = parseFloat(modalEl.style.top) || 0;
		const rect = modalEl.getBoundingClientRect();
		const minDx = KEEP_VISIBLE - rect.right;
		const maxDx = window.innerWidth - KEEP_VISIBLE - rect.left;
		const minDy = -rect.top;
		const maxDy = window.innerHeight - 40 - rect.top;
		let moved = false;

		const onMove = (m: MouseEvent) => {
			// Tasto rilasciato fuori dalla finestra senza mouseup: chiude il gesto.
			if (m.buttons === 0) {
				onUp();
				return;
			}
			const dx = clamp(m.clientX - startX, minDx, maxDx);
			const dy = clamp(m.clientY - startY, minDy, maxDy);
			if (Math.abs(m.clientX - startX) > 3 || Math.abs(m.clientY - startY) > 3) moved = true;
			modalEl.style.left = `${baseLeft + dx}px`;
			modalEl.style.top = `${baseTop + dy}px`;
		};
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			if (!moved) return;
			// Rilasciare il mouse fuori dalla finestra genera un clic sullo sfondo, che chiuderebbe
			// la finestra: dopo un trascinamento quel clic viene scartato.
			const swallow = (e: Event) => {
				e.stopPropagation();
				e.preventDefault();
			};
			window.addEventListener("click", swallow, true);
			window.setTimeout(() => window.removeEventListener("click", swallow, true), 50);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	});
}

export interface ResizeOptions {
	minW: number;
	minH: number;
	/** Richiamata a fine gesto con la misura finale (per ricordarla). */
	onDone?: (width: number, height: number) => void;
}

/** Aggiunge in basso a destra la maniglia per allargare e allungare la finestra. */
export function addModalResizeGrip(modalEl: HTMLElement, opts: ResizeOptions): HTMLElement {
	const grip = modalEl.createDiv({ cls: "qnb-table-edit-grip" });
	grip.addEventListener("mousedown", (evt: MouseEvent) => {
		evt.preventDefault();
		evt.stopPropagation();
		const startX = evt.clientX;
		const startY = evt.clientY;
		const startW = modalEl.offsetWidth;
		const startH = modalEl.offsetHeight;
		const maxW = Math.floor(window.innerWidth * 0.98);
		const maxH = Math.floor(window.innerHeight * 0.96);
		let started = false;

		const onMove = (m: MouseEvent) => {
			if (m.buttons === 0) {
				onUp();
				return;
			}
			// Solo al primo movimento: un semplice clic sulla maniglia non deve cambiare nulla.
			if (!started) {
				started = true;
				modalEl.style.width = `${startW}px`;
				modalEl.style.height = `${startH}px`;
				modalEl.addClass("is-resized");
			}
			const w = clamp(startW + (m.clientX - startX) * 2, opts.minW, maxW);
			const h = clamp(startH + (m.clientY - startY) * 2, opts.minH, maxH);
			modalEl.style.width = `${w}px`;
			modalEl.style.height = `${h}px`;
		};
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			opts.onDone?.(modalEl.offsetWidth, modalEl.offsetHeight);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	});
	return grip;
}
