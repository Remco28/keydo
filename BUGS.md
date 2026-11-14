# Known bugs

Faults that are known and not yet fixed. Each says how it was found and how
sure we are. Remove an entry in the commit that fixes it.

## A task's time of day is dropped when its date is changed

- **Rating:** serious if you use due times.
- **What happens:** changing the date of a task that has a due time (`T`,
  `Shift+T`, or the date chooser) sets the new day without the time. Keydo
  never shows times, so nothing on screen says the time is gone.
- **Since:** before the three-pane redesign (D-019).
- **How we know:** read in the code of both versions during the D-019 review
  (13 Nov 2026): the date change sends a day only. Not tried against a real
  Todoist account.

## In Completed, `Enter` reopens the task while the help says it opens details

- **Rating:** medium.
- **What happens:** in the Completed view `Enter` does what `Space` does and
  reopens the selected task. The keyboard map lists `Enter` as "Open details"
  for every list. Reopening cannot be undone with `Z`.
- **Since:** before D-019; the keyboard map repeats the old help's wording.
- **How we know:** read in the code of both versions during the D-019 review.

## Keys that work but are not documented

- **Rating:** low.
- **What happens:** in the list, `Alt` with a letter acts as the plain letter
  (`Alt+C` clears a date, `Alt+T` moves to today). In details, `Shift+T` moves
  the task to tomorrow. Neither is in `docs/keyboard-model.md` or on screen.
- **Since:** before D-019.
- **How we know:** read in the code of both versions during the D-019 review.
