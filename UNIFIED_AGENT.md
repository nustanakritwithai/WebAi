# Unified Agent · Phase 1 UI

## Scope

Phase 1 adds a single-agent task-flow distinction in the existing WebAi page. The UI now exposes separate controls for continuing the current task and starting a new task, and shows the current task ID/status plus the browser task folder.

## Actual data flow

1. `index.html` renders `Continue current task`, `New Task`, and a task-context strip. The strip has UI-only fields for the current task state and current task folder.
2. `main-ui-v2.js` binds the controls after the existing page is loaded. `Continue current task` only scrolls to the current task area and focuses the task input.
3. `window.WebAiNewTask()` is installed by `main-ui-v2.js` only when no callback already exists. It emits `webai:new-task` with the previous task ID and source metadata, then returns focus to the task area.
4. `app-core.js` owns task-state reset for both `#clearTaskBtn` and `webai:new-task`. The UI does not reimplement task reset.
5. `workspace.js` remains the owner of browser workspace persistence. The New Task flow does not call a workspace delete method, so existing browser workspace files are not deleted.
6. `main-ui-v2.js` observes the existing task ID, task status, and workspace-folder DOM fields and mirrors them into the task-context strip. It does not create a second task state store.

## Phase 1 acceptance criteria

- The current-task area visibly distinguishes `Continue current task` from `New Task`.
- Clicking `Continue current task` keeps the current task context and focuses the task input.
- Clicking `New Task` invokes `window.WebAiNewTask()`.
- The New Task callback emits `webai:new-task` and reuses the existing Clear control for task-state reset.
- Starting a new task does not invoke a browser workspace file or folder deletion API.
- The UI displays the current task ID/status when available and displays the current task folder when workspace state provides it.
- Browser Agent state reset has one owner in `app-core.js`; workspace files are unchanged.

## Verification

- JavaScript syntax is checked with Node's `--check` command for `main-ui-v2.js`.
- Static checks confirm the New Task callback, custom event, existing Clear-control reuse, and absence of workspace deletion calls in the Phase 1 UI files.
