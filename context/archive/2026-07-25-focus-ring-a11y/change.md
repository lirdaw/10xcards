---
change_id: focus-ring-a11y
title: Global focus ring renders no box-shadow on shared controls
status: archived
created: 2026-07-25
updated: 2026-07-25
archived_at: 2026-07-25T19:45:28Z
---

## Notes

Global a11y defect: focus-visible:ring-[3px] on the shared ui components (src/components/ui/input and everything reusing that style) renders no box-shadow, so the focus ring is barely visible, especially on dark backgrounds — it affects every input and button app-wide, so it is a global defect, not a per-view one. Suspected cause to be investigated first: the Tailwind 4 ring configuration in src/styles/global.css is missing the required variables/utilities, so ring-\* never maps to a real box-shadow. Scope: fix the ring configuration globally in one place, do not patch per view. Acceptance: a visible, contrasting focus ring on input/button/select/textarea in both light and dark themes, contrast >= 3:1 (WCAG 1.4.11 / 2.4.11), shown only on :focus-visible and not on mouse click, configured in a single place; satisfies the PRD NFR baseline keyboard accessibility requirement. Out of scope: the element SELECTION model (visible outline for selected rows) which belongs to C10X-16. (source: C10X-22)
