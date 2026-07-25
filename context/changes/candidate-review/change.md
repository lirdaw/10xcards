---
change_id: candidate-review
title: Review generated candidates — accept, edit, or reject (single and bulk)
status: implementing
created: 2026-07-25
updated: 2026-07-25
archived_at: null
---

## Notes

Close the generation loop: after AI generation the user reviews candidates in state `generated` and can accept, edit, or reject each one — individually or in bulk (FR-005); accepted cards move to state `accepted` and become part of the deck available for study (FR-006, US-01); the bulk path must not bypass the per-card control that produces the acceptance-rate metric. Prerequisite S-04 (generation) is shipped. PRD refs: US-01, FR-005, FR-006. (source: C10X-8)
