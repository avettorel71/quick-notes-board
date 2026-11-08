# Books and Reviews 1.0.8

Maintenance release: code-quality fixes from the Obsidian review.

- Saving readings with an invalid date (for example 31/11, which does not exist) now says so clearly instead of the generic "pages" message.
- *Add reading* now proposes the day after the last recorded reading (never later than today), so no day is skipped when you log readings a day late.
- CSS lint: the two-column layout of the Reading year window now uses `gap` instead of `column-gap` (flagged as a partially supported multicolumn feature).

---

# Books and Reviews 1.0.7

- New **Challenges bar** under the title of *Library* and *Virtual library*: monthly and yearly goals marked **Show in the library bar** (editor flag, or the eye icon in the Month/Year tabs) with medal, name, `done/target` and progress bar. A second flag decides whether a completed goal stays (green ✓) or disappears. Click a cell to open the Goals window on its tab; drag cells to reorder them (saved, default monthly then yearly); the bar can be collapsed, and turned off in *Settings → Goals*. It refreshes with the existing goal check (no timers) and is hidden when there is nothing to show. Cells are as wide as their text (never abbreviated) and the text size is adjustable in *Settings → Goals*. The bar stays fixed at the top while the book list scrolls underneath.
- New **Reading year** window (button after *Library information*, also a command): choose a year with ◄ ► and see books, pages, reading days, average ARL and total spent; pages per month (best month marked) and books per month; stars; genres and most read authors; highlights of the year (best and worst book, longest and shortest, read fastest and slowest, record day, longest reading streak); comparison with the previous year; goal medals earned in the year.
- The Reading year window lays the data out on two columns, so it fits without scrolling on normal screens.
- Editing a goal removes the medal of the period in progress and the "done" state: it is awarded again only if the new target is reached. Past medals are untouched.
- Books count in the year of their end date; pages and reading days come from the daily readings. Books rated but without an end date are reported as not counted.
- **Save as note** writes the summary as a Markdown note in the books folder; an existing note is overwritten only if the plugin generated it.
- The toolbar wraps onto a second line on narrow windows instead of overflowing.
- Nothing runs in the background and nothing new is stored: the summary is computed when you open the window or change year.

---

# Books and Reviews 1.0.6

Maintenance release: code-quality fixes from the Obsidian review.

- Fireworks of the Goals celebration: `requestAnimationFrame` / `cancelAnimationFrame` are now called on `window`, for correct behaviour in pop-out windows.
- Confirmation button in the Goals window: `setDestructive()` replaces the deprecated `setWarning()`.
- **Goals: late entries.** A reading logged after the day (up to 7 days late by default, 0–30 in *Settings → Goals → Grace days*) now earns the medal of the day, week, month or year it belongs to, instead of being ignored. The celebration names that period. Pages stay on their real day, so numbers and streak stay exact.
- A new goal counts only from its creation day (earlier periods never give medals).
- No change to your notes.

---

# Books and Reviews 1.0.5

- New **Goals** feature (button after *Evaluation sets*, also a command): goals for pages read (counted day by day from your reading logs), books finished and reading days, per day, week, month or year, with an optional genre filter.
- Medals (bronze, silver, gold, trophy), streak, milestones, a celebration window with fireworks and the Goal sound (both optional).
- **Records** tab: pages today / week / month / year, averages and record day; longest and shortest book; 1st, 2nd and 3rd most read genre; most expensive book; most stars; highest and lowest ARL.
- Click a medal in the **Medals** tab to see which goals earned it: period, goal name and details, date and time, result. Medals stay explained even if the goal is later deleted or changed.
- Nothing runs in the background: progress is computed only when a book changes or when you open the window. Settings section *Goals* to switch everything off.

---

# Books and Reviews 1.0.4

- «Rate book» remembers the last rating set you chose and preselects it for the next book (books already rated keep their own set).
- New **Price currency** option (Settings › General): Euro (default), USD, GBP, JPY, CHF, CAD, AUD, CNY, INR, BRL or a custom symbol, placed before or after the amount. Number format follows the interface language (Italian default: € 12,50). Display only, no conversion; yen shows no decimals.
- Obsidian review fixes: the settings tab no longer uses the deprecated `display()` (each page re-renders itself, keeping the scroll position); the release workflow publishes GitHub artifact attestations for `main.js`, `manifest.json` and `styles.css`.

---

# Books and Reviews 1.0.3

- Minimum Obsidian version is now **1.13.0** (needed by the declarative settings API used since 1.0.2). No other changes.

---

# Books and Reviews 1.0.2

- Settings use Obsidian 1.13's declarative settings API: the options are searchable in Obsidian's settings search, organised in one page per section. Obsidian versions before 1.13 keep the previous settings screen unchanged.
- Slider values use Obsidian's built-in inline display on 1.13+ (the hover tooltip is kept only on older versions).

---

# Books and Reviews 1.0.1

Maintenance release: code-quality fixes requested by the Obsidian review.

- Uses CSS classes instead of inline styles for show/hide and static styling.
- Default language is read from Obsidian's own locale instead of browser storage.
- Safer typing of frontmatter updates, `instanceof TFile` checks and Obsidian DOM helpers.
- Two CSS lint fixes (`gap` instead of `column-gap`, no `!important`).
- Build: `builtin-modules` replaced by Node's `module.builtinModules`.

---

# Books and Reviews 1.0.0

First public release.

## Highlights
- One note per book, with a library list, search, status filter, sortable and configurable columns, sticky header/footer and totals.
- Structured yes/no reviews grouped by weighted themes → **ARL score 0–10** and **stars** from per-set thresholds.
- Editable **evaluation sets** (bundled: Novels, Essays / Romanzi, Saggi), with a computed **difficulty level**.
- **Score colours** per set (five bands, solid or gradient) on theme bars, ARL values and the library list.
- **Reading log**, reading **progress bar** and **pages-per-day chart** with gradient and tooltips.
- Characters, quotes and annotations, awards, price, return dates, covers (vault, computer, link).
- **Virtual library**: a bookshelf of coloured spines (genre colour, page thickness, title/author/code), drag-and-drop arrangement saved between sessions and one-click sorting by code, reading date or pages.
- **Live ARL and stars** while answering, and a configurable highlight of the **current question**.
- **Image gallery** with optional captions, **pages remaining** in the reading progress, **Library information** window and a visible **← Back** button.
- No books are bundled: the library starts empty with a short welcome; a bilingual **Guide to sets** explains how to build your own.
- English and Italian interface, switchable live; fonts, sizes, colours, widths and bar thicknesses configurable.

## Install
Download `main.js`, `manifest.json` and `styles.css` and copy them into
`<vault>/.obsidian/plugins/books-and-reviews/`, then enable the plugin.
