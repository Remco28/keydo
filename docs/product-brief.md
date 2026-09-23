# Product Brief

## Problem

Todoist's data model is powerful, but normal task management often requires navigating a view, opening a task, finding a control, and saving a change. That interaction model is particularly slow for people who already know what they want to change.

Keydo should make frequent operations feel like commands on a selected task. The interface should support keyboard-only use without requiring a terminal.

## Target user

A desktop Todoist user who:

- Works primarily with a keyboard
- Captures and reorganizes tasks frequently
- Uses dates, priorities, subtasks, and project organization
- Wants a fast path for common operations
- Does not need collaboration features initially

## Initial experience

The initial interface should contain:

1. A task list or work queue
2. A persistent search/command input
3. A selected-task detail area
4. A rendered Markdown description preview
5. A quick-add path
6. A visible, keyboard-discoverable action set

The initial task interaction is list-first: the user sees tasks, moves the selection with the arrow keys, presses `Space` to complete or reopen a task, and sees the selected task's details on the right. Pressing the right arrow enters the detail editor, where `Tab` moves between fields.

Changes should be optimistic and appear immediately. Todoist synchronization happens in the background, with visible syncing, saved, and error states. Operations may be batched underneath the interface, but the interface should not make the user wait for a network round trip.

## Access model

Keydo is initially a single-user private application. The user reaches it through the TeamRemco launchpad and a Tailscale MagicDNS link. Tailscale is the access boundary, so Keydo does not require a separate username, password, or bearer token.

Todoist OAuth is the only separate authorization. Its tokens must be stored securely and refreshed automatically. Optional Keydo authentication and multi-user accounts are deferred.

## High-priority capabilities

### Task management

- Create tasks
- Complete and reopen tasks
- Change priority up and down
- Move tasks to Today, Tomorrow, or a chosen date
- Move tasks into and out of projects
- Create and delete projects where appropriate
- Create, indent, outdent, reorder, and manage subtasks

### Task context

- Render Markdown descriptions in a side preview
- Search across the locally synchronized task set
- Display task metadata without opening a task dialog
- Attach and view images associated with a task

### Command model

Commands should provide a consistent alternative to a large collection of isolated shortcuts. Initial command candidates include:

- `/attach`
- `/today`
- `/tomorrow`
- `/project`
- `/priority`
- `/subtask`
- `/search`

The command vocabulary is provisional and should be validated through prototypes.

## Attachment workflow

The primary screenshot workflow should rely on the operating system rather than a custom screen-capture implementation:

1. The user invokes the Ubuntu screenshot tool.
2. The user selects an area and annotates the screenshot.
3. The user copies the image to the operating system clipboard.
4. The user focuses Keydo and presses `Ctrl+V`.
5. Keydo detects the pasted image, uploads it, and attaches it to the selected task.
6. The image is displayed in the task detail area and can be opened in a larger viewer.

This workflow is compatible with a browser application because paste events can provide image data without requiring a global screenshot shortcut.

## Free-plan baseline

The initial product should target the Todoist Beginner plan. The important features fit within that plan, including projects, sections, priorities, subtasks, labels, recurring dates, descriptions, comments, and image uploads.

The product should not assume paid-plan-only capabilities such as deadlines, task duration, custom reminders, location reminders, calendar layout, project insights, or full reporting history.

## Non-goals for the first version

- Replacing Todoist's task data model
- A mobile-first touch experience
- Collaboration and assignment workflows
- AI-assisted task management
- A complete clone of every Todoist feature
- A terminal application requirement

## Open questions

- Should deleting a project be supported, or should project removal primarily mean moving tasks to Inbox or archiving a project?
- Should task ordering be optimized for Today, for project structure, or for a user-configurable order?
- Should pasted images become task comments, or should Keydo maintain a separate attachment concept that maps to Todoist comments?
- Should the first release be a hosted web application, a local desktop shell, or a web application packaged for desktop later?
