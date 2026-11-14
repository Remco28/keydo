# Interface decisions

The design values live in the two `:root` blocks at the top of the `<style>`
in `index.html`: colours by role for the light and the dark theme, five text
sizes, a 4 px spacing scale, corner radii, control sizes and three durations.
Nothing below those blocks states a colour or a text size directly. Keyboard
bindings are documented in `keyboard-model.md`; product decisions are
recorded in `decision-log.md` (the layout is D-019).

These are the choices that are taste rather than rule. Keep to them, and add
to this list when a new one is made.

- **Colours come from the logo.** Navy ink, keycap white, key red. One accent
  (red), which also marks overdue dates and priority 1. Focus rings are navy,
  so a focused field never looks like an error. Project dots use Todoist's
  own project colours.
- **Keycaps.** Every key named on screen is a `kbd` drawn as a keycap, and it
  presses when the real key is pressed. A `kbd` carries `data-k` with the
  key's name so the press can find it.
- **Motion is short and purposeful:** 110 ms for hover and press, 200 ms for
  panes, dialogs and rows, 480 ms for the completion moment. All of it is
  skipped under reduced motion.
- **Sound is off by default.** When on, a soft chime marks a completion.
- **Icons** are outline, 1.75 stroke, 16 px, from the inline sprite at the top
  of `<body>`.
- **One highlight at a time.** The list cursor is a tinted row with a red bar.
  While details have the keyboard it becomes an outline, and the details pane
  carries the red line instead.
- **Words.** Complete and Reopen. Clear date. Details. Subtask. Screenshot.
  Go to. Move. New task. Priority 1 to Priority 4.
- Pressing `/` outside an editor focuses search and selects the whole query,
  so typing replaces it and Backspace clears it. Focusing search with the
  mouse keeps normal text editing behavior.
- Pressing `T` in details selects the whole title, so typing replaces it,
  as `/` does for a search.
- A message that offers Undo stays for as long as the offer does.
- A date in another year shows its year.
- The font is Inter, bundled under `assets/fonts` and served by Keydo itself,
  so text looks the same on every machine and no request leaves for a font
  host.
- Keydo only writes to Todoist in ways Todoist documents, or that it has long
  used against the real account. It does not try to reproduce what the full
  Todoist app does (repeating tasks, an undoable delete).
