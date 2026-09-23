# Keyboard Interaction Model

This is a provisional interaction model. The final bindings should be tested with a small prototype before being treated as commitments.

## Principles

- Every important action has a keyboard path.
- Shortcuts are accelerators, not the only discoverable path.
- The currently focused context determines which commands are valid.
- Single-letter shortcuts do not fire while a text input is being edited.
- The interface always shows the selected item, current view, and pending command state.
- The user can always discover the available actions through a help or command view.

## Suggested global commands

| Binding | Action |
| --- | --- |
| `/` or `Ctrl+K` | Focus search or command input |
| `?` | Show keyboard help |
| `Escape` | Close a panel, cancel a command, or return focus |
| `Ctrl+Enter` | Save and create another item |
| `Enter` | Save or activate the current item |
| `Shift+Enter` | Insert a line break where supported |

The command palette may be used instead of a large number of global shortcuts. The command input should accept both natural-language task capture and slash commands.

## Task-list navigation

| Binding | Action |
| --- | --- |
| `j` / `Down` | Select the next task |
| `k` / `Up` | Select the previous task |
| `g` then a view key | Navigate to a view, such as Today or Inbox |
| `x` | Complete or reopen the selected task |
| `e` | Edit the selected task |
| `Enter` | Open or activate the selected task's detail state |
| `v` | View the selected task's image or larger preview |

The list should retain focus context when tasks are inserted, removed, completed, or reordered.

## Selected-task actions

These should be available as commands even if they also receive shortcut bindings:

- Change priority up or down
- Set due date to Today, Tomorrow, next week, or a chosen date
- Clear due date
- Move to a project
- Move to Inbox
- Add or change a label
- Indent as a subtask
- Outdent to a parent task
- Move up or down among siblings
- Archive or delete the task
- Attach a pasted image
- Open the Markdown description
- Add a comment

A destructive action must have a confirmation or undo path. Moving a task is distinct from deleting it.

## Subtask manipulation

The initial model should distinguish indentation from ordering:

- Indent/outdent changes the task's parent relationship.
- Move up/down changes its order among siblings.
- Moving a task into a project changes its project context.
- Moving a task to Inbox should not be represented as deletion.

These operations should be visually apparent in the list and reflected in the task detail pane.

## Commands

A command is a named operation with a context, input requirements, and result. Examples:

- `/today`
- `/tomorrow`
- `/project`
- `/priority`
- `/attach`
- `/subtask`
- `/search`

The first implementation should favor a small, stable command vocabulary. Commands can later be enhanced with fuzzy matching and aliases.

## Attachment interaction

For the initial Ubuntu workflow:

1. The user copies an annotated screenshot to the operating system clipboard.
2. The user focuses Keydo and presses `Ctrl+V`.
3. Keydo detects the image in the paste event.
4. Keydo uploads it and attaches it to the selected task.
5. The right-side detail pane shows the image immediately after upload completes.
6. A larger viewer is available from the keyboard without leaving the task list.

The interface should show upload progress and a recoverable error if the image is too large, unsupported, or the network request fails.

## Help and discoverability

Keyboard-first does not mean shortcut-only. The help view should list:

- Contextual actions
- Global commands
- Current key bindings
- Available aliases
- Whether a command is available for the selected task

The help view should be searchable and usable without a mouse.
