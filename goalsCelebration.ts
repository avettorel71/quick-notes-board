import { App, Modal, setIcon } from "obsidian";
import type QuickNotesBoardPlugin from "./main";
import { t } from "./i18n";
import type { QnbLang } from "./i18n";
import type { GoalPeriod } from "./goals";
import { Fireworks } from "./fireworks";

export interface CelebrationItem {
	name: string;
	period: GoalPeriod;
}

/** Finestra di festeggiamento: grande, al centro dello schermo, con i fuochi d'artificio. Si
 * chiude solo con il pulsante "Congratulazioni" (o con Esc). Se nel frattempo si raggiungono
 * altri obiettivi, vengono aggiunti all'elenco della stessa finestra. */
export class GoalCelebrationModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private items: CelebrationItem[];
	private onGone: () => void;
	private fireworks: Fireworks | null = null;
	private listEl!: HTMLElement;
	private iconEl!: HTMLElement;

	constructor(app: App, plugin: QuickNotesBoardPlugin, items: CelebrationItem[], onGone: () => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.items = items.slice();
		this.onGone = onGone;
	}

	private tr(key: string): string {
		return t(this.lang, key);
	}

	onOpen() {
		this.modalEl.addClass("qnb-goal-celebrate");
		const { contentEl } = this;
		contentEl.empty();

		const canvas = this.modalEl.createEl("canvas", { cls: "qnb-goal-celebrate-canvas" });
		this.modalEl.prepend(canvas);

		const body = contentEl.createDiv({ cls: "qnb-goal-celebrate-body" });
		this.iconEl = body.createDiv({ cls: "qnb-goal-celebrate-icon" });
		body.createDiv({ cls: "qnb-goal-celebrate-title", text: this.tr("goals.reached") });
		this.listEl = body.createDiv({ cls: "qnb-goal-celebrate-list" });
		this.renderItems();

		const btn = body.createEl("button", { cls: "mod-cta qnb-goal-celebrate-btn", text: this.tr("goals.celebrate.button") });
		btn.addEventListener("click", () => this.close());

		this.fireworks = new Fireworks(canvas);
		this.fireworks.start();
	}

	/** Altri obiettivi raggiunti mentre la finestra è già aperta. */
	addItems(items: CelebrationItem[]) {
		this.items.push(...items);
		this.renderItems();
	}

	private renderItems() {
		// La medaglia grande è quella del periodo più lungo tra quelli raggiunti.
		const rank: Record<GoalPeriod, number> = { day: 0, week: 1, month: 2, year: 3 };
		const top = this.items.reduce<GoalPeriod>((best, it) => (rank[it.period] > rank[best] ? it.period : best), "day");
		this.iconEl.className = `qnb-goal-celebrate-icon qnb-goal-tier-${top}`;
		this.iconEl.empty();
		setIcon(this.iconEl, top === "year" ? "trophy" : "medal");
		this.listEl.empty();
		for (const it of this.items) {
			const row = this.listEl.createDiv({ cls: "qnb-goal-celebrate-item" });
			const icon = row.createSpan({ cls: `qnb-goal-tier is-earned qnb-goal-tier-${it.period}` });
			setIcon(icon, it.period === "year" ? "trophy" : "medal");
			row.createSpan({ text: it.name });
		}
	}

	onClose() {
		this.fireworks?.stop();
		this.fireworks = null;
		this.contentEl.empty();
		this.onGone();
	}
}
