# Keydo redesign mockup

A clickable, keyboard-driven mockup of a redesigned Keydo. It is a proposal to
react to, not the app: it runs on demo data and never talks to Todoist.

Open `mockup/index.html` in Chrome. No server is needed.

## What changed

- **Three panes that fill the window.** Views and projects on the left, the
  list in the middle, the selected task's details on the right. Details follow
  the cursor, so reading a task no longer needs `Enter`.
- **The key bar.** The bottom strip always shows the keys for where you are
  (list, details, a selection, an editor, a dialog). The on-screen keycap
  presses when you press the real key.
- **Details light up when they have the keyboard.** `Enter` moves the keyboard
  into the details pane: a red line appears on it, its key hints show, and the
  list cursor turns into an outline. `Esc` goes back.
- **Finishing a task feels like something.** The checkbox pops, the title is
  struck through, a few sparks fly, the next rows slide up and the day's
  progress ring advances. Clearing Today gets its own moment.
- **Undo.** Every change except delete shows `Undo Z`.
- **A date chooser with a calendar** you can walk with the arrow keys.
- **A keyboard map** on `?`: the whole keyboard, with what each key does in a
  list and in details.
- **Light and dark themes.** It follows the system; the moon button switches.
- **Colours from the logo.** Navy ink, keycap white and key red replace the
  green. The logo files are used as they are.

## Keys this mockup adds

These are new and need your yes before they go into the keyboard model:

| Key | Does |
| --- | --- |
| `1` to `5` | Go to Today, Upcoming, Priority, Inbox, Completed |
| `Z`, `Ctrl+Z` | Undo the last change |
| `←` / `→` | Collapse / expand a task's subtasks in a list |
| `W` in the date chooser | Next week (Monday) |
| `D` or `→` in the date chooser | Move into the calendar |
| `←` in details | Back to the parent from a subtask |

Everything else follows `docs/keyboard-model.md`.

## Not wired up

`Alt+←` / `Alt+→` (nest and outdent) and `Shift+M` (move under a task) only
show a message. Sound is off until you turn it on with the speaker button.

## Choices that are yours

- **Motion.** Short and purposeful here (110 ms, 200 ms, 480 ms). It can be
  made instant.
- **Sound.** Off by default. A soft two-note chime on completion when on.
- **Red as the accent.** It comes from the logo, and it also marks overdue
  dates and priority 1. Focus rings are navy so a focused field never looks
  like an error.
- **Editing a title** puts the caret at the end and does not select the text.
- **Notes save on `Esc`** as well as on `Ctrl+Enter`.

## Files

- `mockup.css`: every design value is a named variable in the `:root` block.
- `mockup.js`: demo data and behaviour. No dependencies.
- `fonts/InterVariable.woff2`: Inter 4, bundled so text looks the same on every
  machine. SIL Open Font License, see `fonts/LICENSE.txt`.
