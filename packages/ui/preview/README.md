# packages/ui — static previews

Self-contained HTML previews that demonstrate component aesthetics without a build step.
Open any file directly in a browser (`file://`) — the design tokens are inlined.

## Files

- **`state-view.html`** — frappe-gantt-inspired view of `_state.json`. Demonstrates the
  `Swimlane` / `TaskBar` / `DependencyArrow` primitives rendering capability data
  bucketed by category, with status-driven fills (compliant / partial / non-compliant /
  manual-review) and hover popovers for evidence detail.

## What these are *not*

These are not Storybook. They're cheap visual spikes — when the aesthetic lands,
the React primitives in `src/components/{swimlane,task-bar,dependency-arrow}/`
are the things that ship to consumers (`apps/portal`, `apps/admin`, etc.).
