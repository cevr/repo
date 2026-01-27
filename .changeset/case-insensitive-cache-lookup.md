---
"@cvr/repo": patch
---

fix: case-insensitive cache lookup for legacy GitHub repos

Repos cached before case-normalization fix may have mixed-case paths (e.g., `Vercel/Next.js`). Now `fetch`, `path`, `info`, and `remove` commands correctly find these legacy entries when queried with lowercase specs.
