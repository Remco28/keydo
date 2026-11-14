# Known bugs

Faults that are known and not yet fixed. Each says how it was found and how
sure we are. Remove an entry in the commit that fixes it.

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

## Two saves at once in one window can make the second fail

- **Rating:** medium.
- **What happens:** a save that starts while another save in the same window
  holds the order lock borrows that lock instead of taking its own. If the
  first save finishes first, the second is refused by the server and reports
  a failed save (edits to titles and notes are kept and retried). The delete
  that is now sent 12 seconds after `Delete` makes the overlap a little more
  likely, for example while notes are being typed.
- **Since:** before D-019.
- **How we know:** read in the code of both versions during the D-019 review
  (second round). Not reproduced.

## The selection bar counts a task that has left the list

- **Rating:** low.
- **What happens:** select two tasks, then complete one of them on its own
  (click its circle): it leaves the list, but the bar still says
  "2 selected". (`Space` now completes the whole selection, so it no longer
  leads here.)
- **Since:** before D-019.
- **How we know:** reproduced on both versions during the D-019 review.
