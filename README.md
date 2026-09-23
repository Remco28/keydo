# Keydo

Keydo is a desktop-first, keyboard-first task workspace designed around Todoist. It aims to make common task operations fast and direct while preserving Todoist as the system of record.

## Why Keydo

Todoist provides a capable task model, but many useful operations require opening views, dialogs, or editors. Keydo is intended to make the common operations available from a selected task or command input:

- Add and move tasks without navigating through task dialogs
- Change priority and due date with one action
- Search and filter the local task set quickly
- Preview Markdown descriptions beside the task list
- Create and manage subtasks with direct keyboard commands
- Attach screenshots by pasting them from the operating system clipboard
- Use command-based actions for less frequent operations

## Product principles

- **Keyboard first:** Every important operation has a discoverable keyboard path.
- **Todoist remains authoritative:** Keydo does not introduce a competing task model.
- **Fast by default:** The shortest interaction should be the normal path, not a special power-user path.
- **Visible context:** The selected task, its description, and its attachments should be visible without opening a modal.
- **Safe destructive actions:** Deletion should be distinguishable from moving, archiving, and completing.
- **Desktop scope first:** The primary target is a desktop browser; mobile is not an initial design constraint.

## Current status

This repository contains product and architecture documentation only. Implementation has not started.

## Documentation

- [Product brief](docs/product-brief.md)
- [Todoist capability assessment](docs/todoist-capabilities.md)
- [Keyboard interaction model](docs/keyboard-model.md)
- [Architecture proposal](docs/architecture.md)
- [Decision log](docs/decision-log.md)
