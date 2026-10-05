/**
 * Novità mostrate nella finestra "What's new" dopo un aggiornamento. Dati e logica pura,
 * senza dipendenze da Obsidian. Ogni voce ha lo stesso testo della cronologia versioni
 * del README: vanno aggiornati insieme a ogni release.
 */

export interface ChangelogEntry {
	version: string;
	/** Testo in Markdown, mostrato così com'è. */
	markdown: string;
}

/** Dalla più recente alla più vecchia. */
export const CHANGELOG: readonly ChangelogEntry[] = [
	{
		version: "1.1.1",
		markdown: "- Fixed: code-quality warnings flagged by Obsidian's automated review — no behavior change for users.",
	},
	{
		version: "1.1.0",
		markdown: "- New: **Note widgets** — small live tools inside a note. In the New note window, the **Widget** toggle (right under the title) shows a dropdown to choose the type, and the note is created ready to use. There are five widgets: **Clock** (time and date, in any time zone), **Calendar** (month view with month navigation), **Countdown** (days, hours, minutes and seconds to a date), **Stopwatch** (with laps) and **Pomodoro** (work and break cycles). A widget is written in the note as a `QNBWidget` code block with a few `option: value` lines, so you can also create or adjust them by hand. See the **Note widgets** section of the README for every option.\n  - Stopwatch and Pomodoro keep their state when they have an `id`, even if you close the board or Obsidian.\n  - At the end of each Pomodoro phase a notification appears and a sound plays, even with the board closed. You can choose your own sound in **Settings → Sound effects → Widgets → Pomodoro phase end**; left empty, the alarm sound plays.\n  - The buttons inside a widget never open the note for editing.\n  - Clock, Countdown, Stopwatch and Pomodoro have a light-blue accent line above and below them. In Settings, the **Widget accent lines** toggle (on by default) turns it off, and you can choose its color and its thickness (1 to 8 pixels).\n- New: **What's new window.** After Quick Notes Board is updated, a window opens once with the news of the new version (if you skip several versions, those of all of them open together). It never appears on a fresh install, and never again for the same version.\n  - The window lists the whole version history, newest first: the new versions are open, the older ones are collapsed — click a version to expand it.\n  - In Settings, the **What's new after an update** toggle (on by default) turns it off; the **Show what's new** button next to it reopens the window whenever you like, with the version you have installed open.\n  - The same action is available from the command palette as **Quick Notes Board: Show what's new**, so you can also give it a keyboard shortcut.\n  - The text is written in English.\n- New: the Alarms list has a new **Last alarm** column, right after Repetitions, showing the **date and time each alarm last rang**. It is saved with the note and reset only when you remove the alarm.\n- New: **skipped alarm times are now reported.** If Obsidian was not running when a time of today's alarm came due, the time is skipped as before, but the \"Missed reminders\" window now lists it the next time you open the board, instead of leaving you wondering whether it rang.",
	},
	{
		version: "1.0.9",
		markdown: "- Fixed: **\"Skip Saturday and Sunday\" was ignored when postponing an alarm.** With the option on, both **\"Postpone to next alarm\"** (in the note's alarm panel) and **\"Postpone to next schedule\"** (in the dialog of a ringing alarm) could still move the alarm onto a Saturday or a Sunday. In that case the alarm never rang at all: it stayed silent over the weekend, and by Monday its deadline had already passed. Now, if the next date falls on a weekend, the alarm is moved on to the following Monday.\n  - Example: a daily alarm postponed on a Friday now goes to Monday (it used to go to Saturday).\n  - Works with every repeat type: daily, weekly, monthly and yearly.\n  - The gap between reminder start date and alarm date stays the same, and so do the times.\n  - With a monthly or yearly repeat, if the date lands on a weekend the alarm moves to Monday, and the following repeats are counted from that Monday.\n  - With the option off, nothing changes: weekends are valid dates as before.\n- Fixed: for alarms with **multiple times in the same day** and \"Skip Saturday and Sunday\" on, Saturdays and Sundays no longer show up among the missed alarms, and when the alarm moves on to the next day it never stops on a weekend.\n- Improved: the two postpone buttons now behave exactly the same way.",
	},
	{
		version: "1.0.8",
		markdown: "- Fixed: three code-quality warnings flagged by Obsidian's automated review (unsafe type handling and a couple of unhandled async calls) — no behavior change for users.",
	},
	{
		version: "1.0.7",
		markdown: "- New: **Archive** and **Trash** buttons in the note's info panel (right-click the title), next to Duplicate note — always act on that specific note, even with other notes selected elsewhere. Meant to make the note header's own Archive/Trash icons safe to hide for a cleaner title bar: with these here, both actions stay one right-click away either way.\n- Improved: notes scrolled out of the visible area of the board are no longer rendered or animated by the browser until you scroll back to them — helps on crowded boards, especially with several animated category gradients running at once.\n- New: **Title bar animation** toggle for category gradients, with a 1-10 second duration — makes the gradient slide back and forth instead of staying still. Off by default; a plain CSS animation with no background timer, skipped when your system's \"reduce motion\" is on. A further toggle restricts the animation to when you're hovering the note, editing it, or dragging it, instead of always.\n\n- New: **Duplicate note** button in the note's info panel (right-click the title), left of Close — a full copy of the note, placed right next to the original.\n- Fixed: with **Compact icons** on, the note title stayed visually cut off even once the icons had faded away, because they kept reserving their full width. The hidden icon row now collapses to no width as well, so the title expands to use the freed space.\n- New: optional **background gradient** for categories. In Settings → Categories, right after the colors, a **Background gradient** toggle turns the note title bar of that category from a single color into a gradient running from the category color to an end color you choose, in one of six directions (left→right, right→left, top→bottom, bottom→top, and the two 45° diagonals). A live preview bar under the category colors — always visible, for a single color too — shows the result while you adjust colors, icon or gradient. With the toggle off nothing changes at all; turning it off doesn't erase the end color and direction, so they come back when you turn it on again. Title and icon text color are chosen from the average of the two colors — override it with the category's title color if a very light-to-dark gradient makes it hard to read.\n- New: **quick snooze** for alarms. When an alarm rings, a proper **dialog window** now opens (instead of the dark notification) with the note's name, a duration dropdown (1–5, 10, 15, 20, 25, 30, 45 minutes, 1 hour) and **Snooze** and **Stop** buttons; the alarm icon of a ringing note opens the same choices as a menu. The last duration used is preselected next time, snoozes survive a restart, the alarm list shows when a snoozed alarm resumes, and a snooze that would go past midnight moves the alarm to the next available day.\n- Improved: stopping or snoozing an alarm from the note's icon now also closes its dialog, and a second dialog can no longer pile up for the same note.\n- New: the alarm dialog gets a **\"Postpone to next schedule\"** button for alarms that repeat (daily, weekly, monthly, yearly) — the same action as the note's own alarm panel, without having to open it.",
	},
	{
		version: "1.0.6",
		markdown: "- New: **Reorder** has a sixth mode, **cascade**: notes stacked oldest-to-newest with only their title bars showing, like overlapping windows.",
	},
	{
		version: "1.0.5",
		markdown: "- Fix: the Board Activity window's **\"Show modified notes\"** toggle now remembers its state between openings, the same way **\"Hide days with no activity\"** already did.\n- Improved: clicking into a note's text to edit it now places the cursor precisely on headings, quotes, bullet/task lists, tables and inline formatting (bold, italic, strikethrough, highlight, inline code), not just on plain text as before. For tables, the header/data separator row (`| :--: | ... |`) — invisible once rendered, and of unpredictable length since its dashes can be padded to any width — is now read back from the actual note text instead of guessed, so rows after the header land exactly. Links, wiki-links, deeply nested/numbered lists and fenced code blocks keep the previous, best-effort behavior — never worse than before, just not yet exact.",
	},
	{
		version: "1.0.4",
		markdown: "New features for the Alarms list and the Board Activity charts.\n\n- New: the Alarms list has a new **Repetitions** column, right after \"Time left\", showing how many times each alarm has rung. The counter increases every time the alarm fires (notification and sound), is saved together with the note in the data file, survives restarts, and is reset only when the alarm is removed from the note. Existing alarms start from 0.\n- New: the Board Activity window has a **\"Hide days with no activity\"** toggle (bottom-left, opposite the Close button). When on, both charts show only the days where something was actually done; the choice is remembered between openings.\n- New: the Board Activity window has a **\"Show modified notes\"** toggle that replaces the \"notes created per day\" chart with **notes modified per day**, based on a new persistent daily activity log (so edits to already-existing notes are finally counted, each note once per day).",
	},
	{
		version: "1.0.3",
		markdown: "Bug fixes and a new feature for multi-time daily reminders.\n\n- Fixed a CSS warning flagged by Obsidian's plugin review (`:has()` selector, which can cause performance issues) — replaced with an explicit class with no behavior change.\n- Fixed the category button and its group-expand arrow having slightly different heights, which made their shared border not line up cleanly.\n- Fixed an inconsistency where the active/inactive border color didn't match between a category button and its group-expand arrow — both now behave identically: white border while inactive, category-colored border and background while active.\n- Fixed cursor placement when clicking inside a note's rendered text to switch to edit mode: on notes with several lines, the cursor could land on the wrong line entirely, because line/paragraph breaks in the rendered text weren't being counted. It now lands on the correct line; minor precision may still be off by a few characters on lines that contain markdown formatting (bold, links, etc.).\n- New: a dedicated \"Missed reminders\" window. If one or more scheduled alarm times passed while Obsidian was closed, this window lists what was missed, shown the next time you open the board (instead of a quick, easy-to-miss popup notification).\n- New: reminders with multiple daily times now automatically advance to the next scheduled day once every time for the current day has passed, instead of going silent forever — shown in the \"Missed reminders\" window together with what was missed. This also catches up correctly if Obsidian hasn't been opened for several days in a row, and re-checks every time the board is opened (not just the first time each day), so a day that finishes being missed later on is still caught.\n- Added a promotional image at the top of the README (`Screenshot00.jpg`) — no code changes.",
	},
	{
		version: "1.0.2",
		markdown: "Bug fixes and visual polish, no new features.\n\n- Fixed note resizing from the left edge: after moving (dragging) a note and then resizing it from its left handle, the left border could stay stuck in place instead of moving, while the right border moved instead — caused by a positioning inconsistency between dragging and resizing. Dragging now uses the same positioning method as resizing, so this can no longer happen.\n- Fixed the Alarms list's \"time remaining\" countdown showing \"0d 0h 0m\" for alarms less than a minute away (most noticeable with multiple daily times set only a few minutes apart) — now shows \"Less than 1 minute\" instead.\n- Fixed the toolbar's Trash/Archive buttons showing their icon stacked above the text instead of beside it.\n- Fixed the small arrow that expands a category's groups/subgroups losing its icon after the above fix.\n- Fixed the categories row sitting too close to the toolbar's top border, and the group-expand arrow visually overlapping the category button next to it — both are now properly spaced and cleanly merged into a single control.\n- Category buttons in the toolbar now use a fixed white border/text color while inactive, for consistent readability regardless of the category's own color (which some users found hard to read); active categories are unaffected and still show their own color as before.\n- Added a GitHub Actions workflow that automatically builds, attests, and publishes a release (with `main.js`, `manifest.json`, `styles.css`) whenever a version tag is pushed.",
	},
	{
		version: "1.0.1",
		markdown: "Maintenance release: no user-facing feature changes, but requires **Obsidian 1.13.0** or later (was 1.7.2).\n\n- Settings now use Obsidian's new declarative settings API, so every option is findable from the global Settings search.\n- Fixed a bug where, with multiple daily alarm times on the same note, reopening Obsidian after one time had already passed (but before the next) could trigger a sound/notification at an unrelated, unexpected moment instead of staying silent until the next scheduled time.\n- Fixed the Alarms list's \"time remaining\" countdown for notes with multiple daily times: it now counts down to the next upcoming time instead of staying anchored to the first one of the day (which showed \"Overdue\" as soon as that first alarm had rung, even with a later one still pending).\n- Various internal fixes flagged by Obsidian's plugin review (deprecated API usage, minor code cleanup) — no behavior change.",
	},
	{
		version: "1.0.0",
		markdown: "First public release. Highlights include:\n\n- **Labels**: a flat, cross-cutting tagging system independent from categories/groups, with multi-select assignment, colored dots on notes, and an intersecting (AND) filter row in the toolbar.\n- **Note Explorer**: a searchable, collapsible overview of every note organized by category → group → subgroup.\n- **Board Structure diagram**: a read-only flowchart visualizing the whole category/group/subgroup hierarchy.",
	},
];

/** Confronta due versioni "x.y.z": negativo se a < b, 0 se uguali, positivo se a > b.
 * Parti mancanti o non numeriche valgono 0, così un valore strano non rompe nulla. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
		const d = (pa[i] || 0) - (pb[i] || 0);
		if (d !== 0) return d;
	}
	return 0;
}

/** Voci da mostrare: tutte quelle più nuove dell'ultima versione vista, fino alla versione
 * installata compresa. Se l'ultima vista è sconosciuta (chi aggiorna da una versione
 * precedente a questa funzione) solo quella della versione installata. */
export function pendingChangelog(lastSeen: string, current: string): ChangelogEntry[] {
	if (!lastSeen) return CHANGELOG.filter((e) => e.version === current);
	return CHANGELOG.filter(
		(e) => compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, current) <= 0
	);
}

/** Solo la voce della versione installata (per il pulsante e il comando manuali). */
export function currentChangelog(current: string): ChangelogEntry[] {
	const own = CHANGELOG.filter((e) => e.version === current);
	return own.length > 0 ? own : CHANGELOG.slice(0, 1);
}
