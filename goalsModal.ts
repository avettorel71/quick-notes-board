import { App, Menu, Modal, Setting, setIcon } from "obsidian";
import type QuickNotesBoardPlugin from "./main";
import { t } from "./i18n";
import type { QnbLang } from "./i18n";
import {
	GOAL_ACTIONS,
	GOAL_MAX_TARGET,
	GOAL_PERIODS,
	MILESTONES,
	awardKey,
	goalProgress,
	milestoneReached,
	newGoalId,
	periodRange,
	summarizeGoals,
	todayStatus,
} from "./goals";
import type { Goal, GoalAction, GoalPeriod } from "./goals";

/** Misura minima della finestra Obiettivi quando la si ridimensiona. */
const GOALS_MIN_W = 420;
const GOALS_MIN_H = 320;

type GoalsTab = GoalPeriod | "medals";

/** Icona della medaglia di un periodo: bronzo (giorno), argento (settimana), oro (mese) e
 * trofeo (anno). Il colore viene dalla classe `qnb-goal-tier-*`. */
function tierIcon(parent: HTMLElement, period: GoalPeriod, extraCls = ""): HTMLElement {
	const el = parent.createSpan({ cls: `qnb-goal-tier qnb-goal-tier-${period} ${extraCls}`.trim() });
	setIcon(el, period === "year" ? "trophy" : "medal");
	return el;
}

/** Finestra Obiettivi: elenco per periodo con avanzamento, creazione e modifica, medaglie.
 * Tutto si calcola una sola volta quando la finestra si apre o cambia scheda. */
export class GoalsModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private tab: GoalsTab = "day";
	private bodyEl!: HTMLElement;
	private tabButtons = new Map<GoalsTab, HTMLElement>();
	/** Obiettivo in attesa di una seconda pressione su "Elimina" (evita cancellazioni per errore). */
	private armedDeleteId: string | null = null;
	private armTimer: number | null = null;

	constructor(app: App, plugin: QuickNotesBoardPlugin) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.plugin.playSound("dialog-goals");
		this.modalEl.addClass("qnb-goals-modal");
		const { goalsWindowWidth: sw, goalsWindowHeight: sh } = this.plugin.settings;
		if (sw >= GOALS_MIN_W && sh >= GOALS_MIN_H) {
			this.modalEl.addClass("is-resized");
			this.modalEl.setCssStyles({
				width: `${Math.min(sw, Math.floor(window.innerWidth * 0.98))}px`,
				height: `${Math.min(sh, Math.floor(window.innerHeight * 0.96))}px`,
			});
		}
		const { contentEl } = this;
		contentEl.empty();
		// Mette al passo gli obiettivi con quello che è già stato fatto, prima di mostrarli.
		this.plugin.checkGoalsNow();

		const head = contentEl.createDiv({ cls: "qnb-goals-head" });
		new Setting(head).setName(this.tr("goals.title")).setHeading();
		const newBtn = head.createEl("button", { cls: "mod-cta qnb-goals-new" });
		setIcon(newBtn.createSpan({ cls: "qnb-btn-icon" }), "plus");
		newBtn.createSpan({ text: this.tr("goals.new") });
		newBtn.addEventListener("click", () => this.openEditor(null));

		const tabs = contentEl.createDiv({ cls: "qnb-goals-tabs" });
		const order: GoalsTab[] = ["day", "week", "month", "year", "medals"];
		for (const tab of order) {
			const btn = tabs.createEl("button", { cls: "qnb-goals-tab", text: this.tr(`goals.tab.${tab}`) });
			btn.addEventListener("click", () => {
				this.tab = tab;
				this.render();
			});
			this.tabButtons.set(tab, btn);
		}

		this.bodyEl = contentEl.createDiv({ cls: "qnb-goals-body" });
		const footer = contentEl.createDiv({ cls: "qnb-goals-footer" });
		const manageBtn = footer.createEl("button", { text: this.tr("goals.manage") });
		manageBtn.addEventListener("click", (evt) => this.openManageMenu(evt));
		const closeBtn = footer.createEl("button", { text: this.tr("trash.close") });
		closeBtn.addEventListener("click", () => this.close());
		this.render();
		this.addResizeGrip();
	}

	/** Maniglia in basso a destra: allarga e allunga la finestra (che è centrata, quindi il
	 * cambio di misura è doppio rispetto al mouse) e ricorda la misura per la volta dopo. */
	private addResizeGrip() {
		const grip = this.modalEl.createDiv({ cls: "qnb-table-edit-grip" });
		grip.addEventListener("mousedown", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			const startX = evt.clientX;
			const startY = evt.clientY;
			const startW = this.modalEl.offsetWidth;
			const startH = this.modalEl.offsetHeight;
			const maxW = Math.floor(window.innerWidth * 0.98);
			const maxH = Math.floor(window.innerHeight * 0.96);
			this.modalEl.addClass("is-resized");

			const onMove = (moveEvt: MouseEvent) => {
				// Tasto rilasciato fuori dalla finestra senza mouseup: chiude il gesto.
				if (moveEvt.buttons === 0) {
					onUp();
					return;
				}
				const w = Math.min(Math.max(GOALS_MIN_W, startW + (moveEvt.clientX - startX) * 2), maxW);
				const h = Math.min(Math.max(GOALS_MIN_H, startH + (moveEvt.clientY - startY) * 2), maxH);
				this.modalEl.setCssStyles({ width: `${w}px`, height: `${h}px` });
			};
			const onUp = () => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				void this.plugin.setGoalsWindowSize(this.modalEl.offsetWidth, this.modalEl.offsetHeight);
			};
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		});
	}

	onClose() {
		if (this.armTimer !== null) window.clearTimeout(this.armTimer);
		this.contentEl.empty();
	}

	private render() {
		for (const [tab, btn] of this.tabButtons) btn.toggleClass("is-active", tab === this.tab);
		this.bodyEl.empty();
		this.armedDeleteId = null;
		if (this.tab === "medals") this.renderMedals();
		else this.renderGoals(this.tab);
	}

	private renderGoals(period: GoalPeriod) {
		const now = Date.now();
		const state = this.plugin.goals;
		const range = periodRange(period, now);
		const goals = state.goals.filter((g) => g.period === period);

		if (period === "day") {
			const status = todayStatus(state, now);
			const summary = this.bodyEl.createDiv({ cls: "qnb-goals-summary" });
			const sum = summarizeGoals(state, now);
			summary.createSpan({
				text:
					status.total > 0 && status.done === status.total
						? this.tr("goals.allDone")
						: this.tr("goals.todaySummary", { done: String(status.done), total: String(status.total) }),
			});
			summary.createSpan({ cls: "qnb-goals-streak", text: this.tr("goals.streak", { n: String(sum.streak) }) });
		} else {
			const daysLeft = Math.ceil((range.endMs - now) / 86400000);
			this.bodyEl.createDiv({
				cls: "qnb-goals-summary",
				text: daysLeft <= 1 ? this.tr("goals.remaining.today") : this.tr("goals.remaining.days", { n: String(daysLeft - 1) }),
			});
		}

		if (goals.length === 0) {
			this.bodyEl.createEl("p", { cls: "setting-item-description qnb-goals-empty", text: this.tr("goals.empty") });
			return;
		}

		const src = { notes: this.plugin.notes, activityLog: this.plugin.activityLog };
		const list = this.bodyEl.createDiv({ cls: "qnb-goals-list" });
		for (const goal of goals) {
			const value = goalProgress(goal, range, src, state);
			const done = awardKey(goal.id, range.key) in state.awards || value >= goal.target;
			const row = list.createDiv({ cls: "qnb-goal-row" + (done ? " is-done" : "") });

			const status = row.createSpan({ cls: "qnb-goal-status" });
			setIcon(status, done ? "check-circle-2" : "circle");

			const main = row.createDiv({ cls: "qnb-goal-main" });
			main.createDiv({ cls: "qnb-goal-name", text: this.plugin.goalDisplayName(goal) });
			const scope = this.plugin.goalScopeText(goal);
			if (goal.name || scope) {
				const parts = [this.tr(`goals.action.${goal.action}`), `${goal.target} ${this.tr(`goals.per.${goal.period}`)}`];
				if (scope) parts.push(scope);
				main.createDiv({ cls: "qnb-goal-sub", text: parts.join(" · ") });
			}
			const bar = main.createDiv({ cls: "qnb-goal-bar" });
			const fill = bar.createDiv({ cls: "qnb-goal-bar-fill" });
			fill.setCssStyles({ width: `${Math.min(100, Math.round((value / goal.target) * 100))}%` });

			row.createSpan({ cls: "qnb-goal-count", text: `${value}/${goal.target}` });
			tierIcon(row, goal.period, done ? "is-earned" : "");

			const actions = row.createDiv({ cls: "qnb-goal-actions" });
			const edit = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": this.tr("goals.edit") } });
			setIcon(edit, "pencil");
			edit.addEventListener("click", () => this.openEditor(goal));
			const del = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": this.tr("goals.delete") } });
			setIcon(del, "trash-2");
			del.addEventListener("click", () => this.onDelete(goal, del));
		}
	}

	/** Menu "Gestisci": eliminare gli obiettivi o azzerare i progressi, sempre con conferma. */
	private openManageMenu(evt: MouseEvent) {
		const state = this.plugin.goals;
		const sum = summarizeGoals(state, Date.now());
		const inTab = this.tab === "medals" ? 0 : state.goals.filter((g) => g.period === this.tab).length;
		const menu = new Menu();
		if (this.tab !== "medals") {
			menu.addItem((item) =>
				item
					.setTitle(this.tr("goals.manage.deleteTab"))
					.setIcon("trash-2")
					.setDisabled(inTab === 0)
					.onClick(() =>
						this.confirm(this.tr("goals.confirm.deleteTab", { tab: this.tr(`goals.tab.${this.tab}`), n: String(inTab) }), async () => {
							await this.plugin.deleteGoals(this.tab as GoalPeriod);
						})
					)
			);
		}
		menu.addItem((item) =>
			item
				.setTitle(this.tr("goals.manage.deleteAll"))
				.setIcon("trash-2")
				.setDisabled(state.goals.length === 0)
				.onClick(() =>
					this.confirm(this.tr("goals.confirm.deleteAll", { n: String(state.goals.length) }), async () => {
						await this.plugin.deleteGoals(null);
					})
				)
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.tr("goals.manage.resetMedals"))
				.setIcon("rotate-ccw")
				.setDisabled(sum.total === 0)
				.onClick(() =>
					this.confirm(this.tr("goals.confirm.resetMedals", { n: String(sum.total) }), async () => {
						await this.plugin.resetGoalMedals();
					})
				)
		);
		menu.addItem((item) =>
			item
				.setTitle(this.tr("goals.manage.resetAll"))
				.setIcon("eraser")
				.setDisabled(state.goals.length === 0 && sum.total === 0)
				.onClick(() =>
					this.confirm(
						this.tr("goals.confirm.resetAll", { goals: String(state.goals.length), medals: String(sum.total) }),
						async () => {
							await this.plugin.resetAllGoals();
						}
					)
				)
		);
		menu.showAtMouseEvent(evt);
	}

	private confirm(message: string, action: () => Promise<void>) {
		new GoalConfirmModal(this.app, this.lang, message, () => {
			void action().then(() => this.render());
		}).open();
	}

	private onDelete(goal: Goal, btn: HTMLElement) {
		if (this.armedDeleteId !== goal.id) {
			this.armedDeleteId = goal.id;
			btn.addClass("is-armed");
			btn.setAttribute("aria-label", this.tr("goals.deleteConfirm"));
			if (this.armTimer !== null) window.clearTimeout(this.armTimer);
			this.armTimer = window.setTimeout(() => {
				this.armedDeleteId = null;
				this.armTimer = null;
				btn.removeClass("is-armed");
				btn.setAttribute("aria-label", this.tr("goals.delete"));
			}, 3000);
			return;
		}
		void this.plugin.saveGoalList(this.plugin.goals.goals.filter((g) => g.id !== goal.id)).then(() => this.render());
	}

	private openEditor(goal: Goal | null) {
		new GoalEditModal(this.app, this.plugin, goal, (saved) => {
			const list = this.plugin.goals.goals.slice();
			const idx = list.findIndex((g) => g.id === saved.id);
			if (idx >= 0) list[idx] = saved;
			else list.push(saved);
			this.tab = saved.period;
			void this.plugin.saveGoalList(list).then(() => this.render());
		}).open();
	}

	private renderMedals() {
		const sum = summarizeGoals(this.plugin.goals, Date.now());

		const tiles = this.bodyEl.createDiv({ cls: "qnb-goals-tiles" });
		for (const period of GOAL_PERIODS) {
			const tile = tiles.createDiv({ cls: "qnb-goals-tile" });
			tierIcon(tile, period, sum.counts[period] > 0 ? "is-earned" : "");
			tile.createDiv({ cls: "qnb-goals-tile-count", text: String(sum.counts[period]) });
			tile.createDiv({ cls: "qnb-goals-tile-label", text: this.tr(`goals.medals.${period}`) });
		}

		const streaks = this.bodyEl.createDiv({ cls: "qnb-goals-summary" });
		streaks.createSpan({ text: this.tr("goals.streak", { n: String(sum.streak) }) });
		streaks.createSpan({ cls: "qnb-goals-streak", text: this.tr("goals.bestStreak", { n: String(sum.bestStreak) }) });

		this.bodyEl.createEl("h4", { text: this.tr("goals.milestones") });
		const grid = this.bodyEl.createDiv({ cls: "qnb-goals-milestones" });
		for (const m of MILESTONES) {
			const reached = milestoneReached(m, sum);
			const cell = grid.createDiv({ cls: "qnb-goals-milestone" + (reached ? " is-reached" : "") });
			setIcon(cell.createSpan({ cls: "qnb-goals-milestone-icon" }), reached ? (m.kind === "streak" ? "flame" : "award") : "lock");
			cell.createSpan({ text: this.tr(`goals.milestone.${m.id}`) });
		}
		this.bodyEl.createEl("p", { cls: "setting-item-description", text: this.tr("goals.medals.note") });
	}
}

/** Creazione e modifica di un obiettivo: cosa fare, quante volte e in che periodo. */
export class GoalEditModal extends Modal {
	private plugin: QuickNotesBoardPlugin;
	private lang: QnbLang;
	private draft: Goal;
	private isNew: boolean;
	private onSave: (goal: Goal) => void;
	private previewEl!: HTMLElement;
	private errorEl!: HTMLElement;
	private categoryRow!: Setting;
	private labelRow!: Setting;
	private targetRow!: Setting;

	constructor(app: App, plugin: QuickNotesBoardPlugin, goal: Goal | null, onSave: (goal: Goal) => void) {
		super(app);
		this.plugin = plugin;
		this.lang = plugin.settings.language;
		this.isNew = !goal;
		this.draft = goal ? { ...goal } : { id: newGoalId(), name: "", action: "create", target: 5, period: "day", category: "", label: "" };
		this.onSave = onSave;
	}

	private tr(key: string, vars?: Record<string, string>): string {
		return t(this.lang, key, vars);
	}

	onOpen() {
		this.modalEl.addClass("qnb-goal-edit-modal");
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(this.tr(this.isNew ? "goals.edit.titleNew" : "goals.edit.titleEdit")).setHeading();

		new Setting(contentEl)
			.setName(this.tr("goals.edit.name"))
			.addText((text) =>
				text
					.setPlaceholder(this.tr("goals.edit.namePlaceholder"))
					.setValue(this.draft.name)
					.onChange((v) => {
						this.draft.name = v.trim();
						this.updatePreview();
					})
			);

		new Setting(contentEl)
			.setName(this.tr("goals.edit.action"))
			.addDropdown((dd) => {
				for (const a of GOAL_ACTIONS) dd.addOption(a, this.tr(`goals.action.${a}`));
				dd.setValue(this.draft.action).onChange((v) => {
					this.draft.action = v as GoalAction;
					this.categoryRow.settingEl.toggleClass("is-hidden", !this.usesCategory());
					this.labelRow.settingEl.toggleClass("is-hidden", this.draft.action !== "label");
					this.targetRow.setName(this.tr(`goals.edit.target.${this.draft.action}`));
					this.updatePreview();
				});
			});

		this.targetRow = new Setting(contentEl)
			.setName(this.tr(`goals.edit.target.${this.draft.action}`))
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = String(GOAL_MAX_TARGET);
				text.setValue(String(this.draft.target)).onChange((v) => {
					const n = Math.round(Number(v));
					this.draft.target = Number.isFinite(n) ? n : 0;
					this.updatePreview();
				});
				text.inputEl.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						this.save();
					}
				});
			});

		new Setting(contentEl)
			.setName(this.tr("goals.edit.period"))
			.addDropdown((dd) => {
				for (const p of GOAL_PERIODS) dd.addOption(p, this.tr(`goals.period.${p}`));
				dd.setValue(this.draft.period).onChange((v) => {
					this.draft.period = v as GoalPeriod;
					this.updatePreview();
				});
			});

		this.categoryRow = new Setting(contentEl)
			.setName(this.tr("goals.edit.category"))
			.addDropdown((dd) => {
				dd.addOption("", this.tr("goals.edit.allCategories"));
				for (const c of this.plugin.settings.categories) dd.addOption(c.name, c.name);
				// Una categoria poi eliminata o rinominata non deve far sparire il valore salvato.
				if (this.draft.category && !this.plugin.settings.categories.some((c) => c.name === this.draft.category)) {
					dd.addOption(this.draft.category, this.draft.category);
				}
				dd.setValue(this.draft.category).onChange((v) => {
					this.draft.category = v;
					this.updatePreview();
				});
			});
		this.categoryRow.settingEl.toggleClass("is-hidden", !this.usesCategory());

		this.labelRow = new Setting(contentEl)
			.setName(this.tr("goals.edit.label"))
			.addDropdown((dd) => {
				dd.addOption("", this.tr("goals.edit.anyLabel"));
				for (const l of this.plugin.settings.labels) dd.addOption(l.id, l.name);
				// Un'etichetta poi eliminata non deve far sparire il valore salvato.
				if (this.draft.label && !this.plugin.settings.labels.some((l) => l.id === this.draft.label)) {
					dd.addOption(this.draft.label, this.tr("goals.edit.deletedLabel"));
				}
				dd.setValue(this.draft.label).onChange((v) => {
					this.draft.label = v;
					this.updatePreview();
				});
			});
		this.labelRow.settingEl.toggleClass("is-hidden", this.draft.action !== "label");

		this.previewEl = contentEl.createEl("p", { cls: "setting-item-description qnb-goal-preview" });
		this.errorEl = contentEl.createEl("p", { cls: "qnb-goal-error" });
		this.updatePreview();

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText(this.tr("goals.edit.cancel")).onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText(this.tr(this.isNew ? "goals.edit.create" : "goals.edit.save"))
					.setCta()
					.onClick(() => this.save())
			);
	}

	onClose() {
		this.contentEl.empty();
	}

	private usesCategory(): boolean {
		return this.draft.action === "create" || this.draft.action === "modify";
	}

	private updatePreview() {
		const scope = this.plugin.goalScopeText({
			...this.draft,
			category: this.usesCategory() ? this.draft.category : "",
			label: this.draft.action === "label" ? this.draft.label : "",
		});
		const name = this.plugin.goalDisplayName(this.draft);
		this.previewEl.setText(this.tr("goals.edit.preview", { name: scope ? `${name} · ${scope}` : name }));
		this.errorEl.setText("");
	}

	private save() {
		const target = Math.round(this.draft.target);
		if (!Number.isFinite(target) || target < 1 || target > GOAL_MAX_TARGET) {
			this.errorEl.setText(this.tr("goals.edit.invalid", { max: String(GOAL_MAX_TARGET) }));
			return;
		}
		const goal: Goal = {
			...this.draft,
			target,
			category: this.usesCategory() ? this.draft.category : "",
			label: this.draft.action === "label" ? this.draft.label : "",
		};
		this.onSave(goal);
		this.close();
	}
}

/** Conferma prima di eliminare o azzerare: mostra cosa succede e quanti elementi coinvolge. */
class GoalConfirmModal extends Modal {
	constructor(
		app: App,
		private lang: QnbLang,
		private message: string,
		private onConfirm: () => void
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("qnb-goal-confirm-modal");
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setName(t(this.lang, "goals.confirm.title")).setHeading();
		contentEl.createEl("p", { text: this.message });
		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText(t(this.lang, "goals.edit.cancel")).onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText(t(this.lang, "goals.confirm.yes"))
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
