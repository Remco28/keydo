# Todoist Capability Assessment

Assessment date: 2026-09-23

This document records the Todoist capabilities relevant to Keydo's initial design. The product should verify current account limits and permissions before implementation because Todoist can change plan availability and API behavior.

## Supported baseline capabilities

### Tasks

- Create, read, update, move, complete, reopen, and delete tasks
- Task content and Markdown-capable descriptions
- Projects, sections, labels, and priorities
- Subtasks through parent task relationships
- Due dates, recurring due dates, and agenda ordering
- Reordering among siblings
- Task URLs and synchronization metadata

### Organization

- Personal projects and nested projects
- Sections within projects
- Personal labels
- Saved filter views, subject to the account plan
- Search by project, section, and label name
- Task filtering by supported Todoist query criteria

### Context and collaboration

- Task comments
- File attachments on comments
- Comments containing Markdown and links
- Shared projects and collaborators
- Activity logs
- Completed-task history

### Search and capture

- Quick Add from natural-language input
- Task filter queries
- Local search can be implemented from the synchronized task set even when saved server-side filters are limited

## Useful for Keydo

| Keydo behavior | Todoist support | Notes |
| --- | --- | --- |
| Quick priority change | Supported | Update the task priority directly |
| Change due date | Supported | Update due-date fields or use natural-language parsing |
| Today/Tomorrow views | Supported | These are views over task due dates |
| Project create/move/archive/delete | Supported | Deletion is destructive and should be treated separately |
| Subtask nesting | Supported | Subtasks are tasks with a parent relationship |
| Subtask reordering | Supported | Sibling ordering can be updated |
| Markdown description preview | Supported by data model | Rendering is performed by Keydo |
| Quick search | Supported | Use local search and/or the task filter API |
| Image paste and upload | Supported | Upload the file, then attach it to a task comment |
| Command-based actions | Supported | Keydo maps commands to API operations |

## Free-plan considerations

The current Beginner plan is expected to support:

- Up to 5 personal projects
- Sections, subtasks, subprojects, and labels
- Due dates and times
- Priorities and recurring dates
- Task descriptions and comments
- Image/file uploads
- Automatic reminders
- Up to 3 custom filter views
- 1 week of activity history

The current published limits and restrictions include:

- Image/file attachments limited to 5 MB for the plan
- One file attachment per comment
- Up to 300 active tasks per project
- Up to 20 sections per project

Features that may require a paid plan include:

- Deadlines
- Task duration and time-blocking
- Custom reminders
- Location reminders
- Recurring reminders
- Calendar layout
- Project insights
- Full reporting history

Keydo should therefore use due dates, priorities, sections, subtasks, descriptions, comments, and uploads as foundational features.

## API shape

Keydo should use both parts of Todoist's API:

### Sync

Use Sync as the primary state-transport layer for a desktop application. It supports:

- Full initial synchronization
- Incremental synchronization through a sync token
- Batched writes
- Optimistic temporary IDs
- Collaboration and live-notification resources

### REST

Use REST for operations where it is the clearer or only available interface, including:

- Quick Add
- Task filter queries
- Completed-task history
- Project, section, and label name search
- File uploads
- Detailed activity and productivity data
- Template import and export

## Attachment details

Todoist attachments are represented on comments rather than as a general-purpose arbitrary field on a task. A likely Keydo flow is:

1. Receive a pasted image from the browser.
2. Upload the image through the Todoist upload API.
3. Create or update a task comment referencing the uploaded file.
4. Store the returned attachment metadata in the local synchronized state.
5. Display the image in the task detail pane.

The application should show a fallback file link if an image cannot be rendered.

## Security and account boundaries

- A personal project may use a personal API token for local-only use.
- A multi-user application should use OAuth rather than personal tokens.
- Access and refresh tokens must not be stored in browser-readable application data.
- The application should request only the scopes needed for the implemented features.
- Project deletion and task deletion should be separately permissioned operations.

## Sources

- [Todoist API overview](https://developer.todoist.com/api/v1/)
- [Todoist authorization guide](https://developer.todoist.com/api/v1/#tag/Authorization)
- [Todoist pricing](https://www.todoist.com/pricing)
- [Todoist usage limits](https://www.todoist.com/help/todoist/get-started/usage-limits-in-todoist-e5rcSY)
