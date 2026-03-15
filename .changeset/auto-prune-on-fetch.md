---
"@cvr/repo": minor
---

Auto-prune stale repos on fetch. Every `repo fetch` now removes cached repos not accessed in 30+ days. Extracted `pruneByAge` as shared logic between `fetch` and `clean`.
