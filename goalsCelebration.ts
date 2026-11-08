import { setIcon } from "obsidian";
import { t } from "./i18n";
import type { QnbLang } from "./i18n";
import type { GoalPeriod } from "./goals";
import { Fireworks } from "./fireworks";

export interface CelebrationItem {
	name: string;
	period: GoalPeriod;
}

/** Festa per UN obiettivo raggiunto: un livello sopra tutto, con lo sfondo sfocato (non una finestra di
 * Obsidian), mostrato solo mentre la board è davanti, con medaglia, nome, fuochi d'artificio e il pulsante "Congratulazioni". Esiste solo
 * finché la board è davanti: `hide` la toglie senza darla per fatta, `onDone` scatta solo quando
 * si preme il pulsante (o Invio / Esc). */
export class GoalCelebration {
	private overlay: HTMLElement | null = null;
	private fireworks: Fireworks | null = null;

	constructor(
		readonly host: HTMLElement,
		private item: CelebrationItem,
		private lang: QnbLang,
		private onDone: () => void
	) {}

	show() {
		if (this.overlay) return;
		// Sta sopra a tutto (anche alle altre finestre) e sfoca ciò che c'è dietro; resta comunque
		// legata alla board: la crea e la toglie il plugin solo mentre la board è davanti.
		const overlay = this.host.ownerDocument.body.createDiv({ cls: "qnb-goal-celebrate-overlay" });
		overlay.setAttr("tabindex", "-1");
		this.overlay = overlay;
		const canvas = overlay.createEl("canvas", { cls: "qnb-goal-celebrate-canvas" });
		const card = overlay.createDiv({ cls: "qnb-goal-celebrate-card" });
		const body = card.createDiv({ cls: "qnb-goal-celebrate-body" });
		const icon = body.createDiv({ cls: `qnb-goal-celebrate-icon qnb-goal-tier-${this.item.period}` });
		setIcon(icon, this.item.period === "year" ? "trophy" : "medal");
		body.createDiv({ cls: "qnb-goal-celebrate-title", text: t(this.lang, "goals.reached") });
		body.createDiv({ cls: "qnb-goal-celebrate-name", text: this.item.name });
		const btn = body.createEl("button", { cls: "mod-cta qnb-goal-celebrate-btn", text: t(this.lang, "goals.celebrate.button") });
		btn.addEventListener("click", () => this.done());
		// Esc ed Invio chiudono questa festa; non arrivano alla board.
		overlay.addEventListener("keydown", (evt) => {
			if (evt.key !== "Escape" && evt.key !== "Enter") return;
			evt.preventDefault();
			evt.stopPropagation();
			this.done();
		});
		// Un clic sulla board dietro non deve passare attraverso la festa.
		overlay.addEventListener("mousedown", (evt) => evt.stopPropagation());
		// Il focus resta qui finché la festa è aperta: se esce (clic fuori, Tab) torna al pulsante.
		overlay.addEventListener("focusout", () => {
			window.setTimeout(() => {
				if (this.overlay === overlay && overlay.isConnected && !overlay.contains(overlay.ownerDocument.activeElement)) {
					btn.focus({ preventScroll: true });
				}
			}, 0);
		});
		overlay.addEventListener("mousedown", () => window.setTimeout(() => btn.focus({ preventScroll: true }), 0));
		this.fireworks = new Fireworks(canvas);
		this.fireworks.start();
		btn.focus({ preventScroll: true });
	}

	/** Toglie la festa dallo schermo senza considerarla fatta. */
	hide() {
		this.fireworks?.stop();
		this.fireworks = null;
		this.overlay?.remove();
		this.overlay = null;
	}

	private done() {
		this.hide();
		this.onDone();
	}
}
