---
"@cvr/repo": minor
---

Always refresh git repos on fetch, background refresh on path

- `fetch`: cached git repos are now always updated (removed `--update` flag). Non-git repos still return cached path.
- `path`: returns cached path immediately, then refreshes git refs via a forked `fetchRefs` in the background.
- Added `fetchRefs` method to `GitService` for fetch-only (no reset) git refresh.
