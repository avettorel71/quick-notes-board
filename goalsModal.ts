import { App, Menu, Modal, Setting, setIcon } from "obsidian";
import type QuickNotesBoardPlugin from "./main";
import { addModalResizeGrip, enableModalDrag } from "./windowTools";
import { t } from "./i18n";
import { localeFor } from "./widgets";
import type { QnbLang } from "./i18n";
import {
	GOAL_ACTION_GROUPS,
	GOAL_MAX_TARGET,
	GOAL_PERIODS,
	MILESTONES,
	awardKey,
	groupAwards,
	goalProgress,
	milestoneDetail,
	milestoneReached,
	newGoalId,
	periodRange,
	summarizeGoals,
	todayStatus,
} from "./goals";
import type { Goal, GoalAction, GoalPeriod, Milestone } from "./goals";

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
	/** Livello di medaglia aperto nella scheda Medaglie (null = riepilogo). */
	private medalTier: GoalPeriod | null = null;
	/** Traguardo aperto nella scheda Medaglie (null = riepilogo). */
	private milestone: Milestone | null = null;
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
				this.medalTier = null;
				this.milestone = null;
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
		// Si ridimensiona dall'angolo in basso a destra (la misura è ricordata) e si sposta
		// trascinando il titolo.
		addModalResizeGrip(this.modalEl, {
			minW: GOALS_MIN_W,
			minH: GOALS_MIN_H,
			onDone: (w, h) => void this.plugin.setGoalsWindowSize(w, h),
		});
		enableModalDrag(this.modalEl, ".qnb-goals-head");
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
		if (this.medalTier) {
			this.renderMedalDetail(this.medalTier);
			return;
		}
		if (this.milestone) {
			this.renderMilestoneDetail(this.milestone);
			return;
		}
		const sum = summarizeGoals(this.plugin.goals, Date.now());

		const tiles = this.bodyEl.createDiv({ cls: "qnb-goals-tiles" });
		for (const period of GOAL_PERIODS) {
			const count = sum.counts[period];
			const tile = tiles.createDiv({ cls: "qnb-goals-tile" + (count > 0 ? " is-clickable" : "") });
			if (count > 0) {
				tile.setAttribute("role", "button");
				tile.setAttribute("tabindex", "0");
				tile.setAttribute("aria-label", this.tr("goals.medals.open", { name: this.tr(`goals.medals.${period}`) }));
				const open = () => {
					this.medalTier = period;
					this.render();
				};
				tile.addEventListener("click", open);
				tile.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						open();
					}
				});
			}
			tierIcon(tile, period, count > 0 ? "is-earned" : "");
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
			cell.addClass("is-clickable");
			cell.setAttribute("role", "button");
			cell.setAttribute("tabindex", "0");
			const open = () => {
				this.milestone = m;
				this.render();
			};
			cell.addEventListener("click", open);
			cell.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					open();
				}
			});
		}
		this.bodyEl.createEl("p", { cls: "setting-item-description", text: this.tr("goals.medals.note") });
	}

	/** Medaglie di un livello, raggruppate per obiettivo, con i periodi in cui sono state ottenute. */
	private renderMedalDetail(period: GoalPeriod) {
		const state = this.plugin.goals;
		const groups = groupAwards(state, period);
		const total = groups.reduce((n, g) => n + g.periods.length, 0);

		const head = this.bodyEl.createDiv({ cls: "qnb-goals-detail-head" });
		const back = head.createEl("button", { cls: "qnb-goals-back" });
		setIcon(back.createSpan({ cls: "qnb-btn-icon" }), "arrow-left");
		back.createSpan({ text: this.tr("goals.medals.back") });
		back.addEventListener("click", () => {
			this.medalTier = null;
			this.render();
		});
		const title = head.createDiv({ cls: "qnb-goals-detail-title" });
		tierIcon(title, period, "is-earned");
		title.createSpan({ text: `${this.tr(`goals.medals.${period}`)}: ${total}` });

		if (groups.length === 0) {
			this.bodyEl.createEl("p", { cls: "setting-item-description qnb-goals-empty", text: this.tr("goals.medals.none") });
			return;
		}
		const list = this.bodyEl.createDiv({ cls: "qnb-goals-detail" });
		for (const g of groups) {
			const goal = state.goals.find((x) => x.id === g.goalId);
			const name = this.goalNameOf(g.goalId);
			const block = list.createDiv({ cls: "qnb-goals-detail-goal" });
			const row = block.createDiv({ cls: "qnb-goals-detail-row" });
			row.createSpan({ cls: "qnb-goals-detail-name", text: name || this.tr("goals.medals.deleted") });
			if (name && !goal) row.createSpan({ cls: "qnb-goals-detail-deleted", text: this.tr("goals.medals.deletedTag") });
			row.createSpan({ cls: "qnb-goals-detail-times", text: `× ${g.periods.length}` });
			const periods = block.createDiv({ cls: "qnb-goals-detail-periods" });
			for (const p of g.periods) {
				periods.createDiv({
					cls: "qnb-goals-detail-period",
					text: this.periodLabel(p.key, period),
					attr: { title: new Date(p.ts).toLocaleString(localeFor(this.lang)) },
				});
			}
		}
	}

	/** Nome di un obiettivo, anche se eliminato (ultimo nome salvato); "" se non si sa più. */
	private goalNameOf(goalId: string): string {
		const state = this.plugin.goals;
		const goal = state.goals.find((x) => x.id === goalId);
		return goal ? this.plugin.goalDisplayName(goal) : (state.names[goalId] ?? "");
	}

	private goalLabelOf(goalId: string): string {
		const name = this.goalNameOf(goalId);
		if (!name) return this.tr("goals.medals.deleted");
		return this.plugin.goals.goals.some((x) => x.id === goalId) ? name : `${name} ${this.tr("goals.medals.deletedTag")}`;
	}

	/** Dettaglio di un traguardo: quando è scattato e cosa l'ha prodotto; se è bloccato, il progresso. */
	private renderMilestoneDetail(m: Milestone) {
		const d = milestoneDetail(this.plugin.goals, m);
		const loc = localeFor(this.lang);

		const head = this.bodyEl.createDiv({ cls: "qnb-goals-detail-head" });
		const back = head.createEl("button", { cls: "qnb-goals-back" });
		setIcon(back.createSpan({ cls: "qnb-btn-icon" }), "arrow-left");
		back.createSpan({ text: this.tr("goals.medals.back") });
		back.addEventListener("click", () => {
			this.milestone = null;
			this.render();
		});
		const title = head.createDiv({ cls: "qnb-goals-detail-title" });
		setIcon(title.createSpan({ cls: "qnb-goals-milestone-icon" }), d.reached ? (m.kind === "streak" ? "flame" : "award") : "lock");
		title.createSpan({ text: this.tr(`goals.milestone.${m.id}`) });

		const box = this.bodyEl.createDiv({ cls: "qnb-goals-detail" });
		if (!d.reached) {
			box.createDiv({ cls: "qnb-goals-detail-sub", text: this.tr("goals.ms.locked") });
			const bar = box.createDiv({ cls: "qnb-goal-bar qnb-goals-ms-bar" });
			bar.createDiv({ cls: "qnb-goal-bar-fill" }).setCssStyles({ width: `${Math.min(100, Math.round((d.current / d.need) * 100))}%` });
			box.createDiv({ text: `${d.current} / ${d.need}` });
			box.createDiv({
				cls: "qnb-goals-detail-sub",
				text: this.tr(m.kind === "streak" ? "goals.ms.missingDays" : "goals.ms.missingMedals", { n: String(d.need - d.current) }),
			});
			return;
		}

		if (m.kind === "total" && d.unlockMedal) {
			const u = d.unlockMedal;
			box.createDiv({
				cls: "qnb-goals-detail-sub",
				text: this.tr("goals.ms.unlockedOn", { date: new Date(u.ts).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" }) }),
			});
			box.createDiv({
				cls: "qnb-goals-detail-sub",
				text: this.tr("goals.ms.withMedal", { n: String(d.need), goal: this.goalLabelOf(u.goalId), period: this.periodLabel(u.periodKey, u.period) }),
			});
			box.createEl("h4", { text: this.tr("goals.ms.medalsList", { n: String(d.medals.length) }) });
			for (const med of d.medals) {
				const row = box.createDiv({ cls: "qnb-goals-detail-row qnb-goals-ms-row", attr: { title: new Date(med.ts).toLocaleString(loc) } });
				tierIcon(row, med.period, "is-earned");
				row.createSpan({ cls: "qnb-goals-detail-name", text: this.goalLabelOf(med.goalId) });
				row.createSpan({ cls: "qnb-goals-detail-times", text: this.periodLabel(med.periodKey, med.period) });
			}
			return;
		}

		box.createDiv({ cls: "qnb-goals-detail-sub", text: this.tr("goals.ms.unlockedDay", { date: this.periodLabel(d.unlockDay ?? "", "day") }) });
		box.createEl("h4", { text: this.tr("goals.ms.daysList", { n: String(d.days.length) }) });
		for (const day of d.days) {
			const row = box.createDiv({ cls: "qnb-goals-detail-row qnb-goals-ms-row" });
			row.createSpan({ cls: "qnb-goals-detail-name", text: this.periodLabel(day.day, "day") });
			row.createSpan({ cls: "qnb-goals-detail-times", text: day.goalIds.map((id) => this.goalLabelOf(id)).join(", ") });
		}
	}

	/** Periodo in forma leggibile: "lun 26 ott 2026", "Settimana 43 · 2026", "ottobre 2026", "2026". */
	private periodLabel(key: string, period: GoalPeriod): string {
		const loc = localeFor(this.lang);
		if (period === "day") {
			const [y, m, d] = key.split("-").map(Number);
			return new Date(y, m - 1, d).toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
		}
		if (period === "week") {
			const [y, w] = key.split("-W");
			return this.tr("goals.medals.weekLabel", { n: String(Number(w)), year: y });
		}
		if (period === "month") {
			const [y, m] = key.split("-").map(Number);
			return new Date(y, m - 1, 1).toLocaleDateString(loc, { month: "long", year: "numeric" });
		}
		return key;
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
	private actionBtnEl!: HTMLElement;

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
			.addButton((btn) => {
				this.actionBtnEl = btn.buttonEl;
				this.actionBtnEl.addClass("qnb-goal-action-btn");
				this.renderActionButton();
				btn.onClick((evt) => this.openActionMenu(evt));
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

	/** Nome dell'azione con il suo gruppo: "Allarmi › Disattivare una sveglia". */
	private actionLabel(action: GoalAction): string {
		const group = GOAL_ACTION_GROUPS.find((g) => g.actions.includes(action));
		const name = this.tr(`goals.action.${action}`);
		return group ? `${this.tr(`goals.group.${group.id}`)} › ${name}` : name;
	}

	private renderActionButton() {
		this.actionBtnEl.empty();
		this.actionBtnEl.createSpan({ cls: "qnb-goal-action-text", text: this.actionLabel(this.draft.action) });
		setIcon(this.actionBtnEl.createSpan({ cls: "qnb-btn-icon" }), "chevron-down");
	}

	private setAction(action: GoalAction) {
		this.draft.action = action;
		this.renderActionButton();
		this.categoryRow.settingEl.toggleClass("is-hidden", !this.usesCategory());
		this.labelRow.settingEl.toggleClass("is-hidden", this.draft.action !== "label");
		this.targetRow.setName(this.tr(`goals.edit.target.${this.draft.action}`));
		this.updatePreview();
	}

	/** Menu a cascata: un sottomenu per gruppo (Note, Etichette, Allarmi, Attività). Se questa
	 * versione di Obsidian non ha i sottomenu, le stesse voci compaiono in un unico menu,
	 * divise per gruppo. */
	private openActionMenu(evt: MouseEvent) {
		const addLeaf = (menu: Menu, action: GoalAction, titlePrefix = "") => {
			menu.addItem((item) =>
				item
					.setTitle(titlePrefix + this.tr(`goals.action.${action}`))
					.setChecked(this.draft.action === action)
					.onClick(() => this.setAction(action))
			);
		};

		let nested = true;
		const menu = new Menu();
		for (const group of GOAL_ACTION_GROUPS) {
			menu.addItem((item) => {
				item.setTitle(this.tr(`goals.group.${group.id}`)).setIcon(group.icon);
				const setSubmenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu;
				if (typeof setSubmenu !== "function") {
					nested = false;
					return;
				}
				const submenu = setSubmenu.call(item);
				for (const action of group.actions) addLeaf(submenu, action);
			});
		}
		if (nested) {
			menu.showAtMouseEvent(evt);
			return;
		}
		const flat = new Menu();
		GOAL_ACTION_GROUPS.forEach((group, i) => {
			if (i > 0) flat.addSeparator();
			for (const action of group.actions) addLeaf(flat, action, `${this.tr(`goals.group.${group.id}`)} › `);
		});
		flat.showAtMouseEvent(evt);
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
					.setDestructive()
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
