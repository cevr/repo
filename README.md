# repo

Multi-registry source code cache manager. Fetch and cache source code from GitHub, npm, PyPI, and Crates.io.

Inspired by [vercel-labs/opensrc](https://github.com/vercel-labs/opensrc).

## Features

- **Source-first**: Package registries (npm, PyPI, Crates) resolve to source git repos when possible, with tarball fallback
- **Multi-registry**: GitHub, npm, PyPI, Crates.io support
- **Shallow clones**: Default depth of 100 commits for fast fetching
- **Auto-update**: Re-fetching updates existing git repos
- **Global cache**: All repos cached at `~/.cache/repo/`

## Installation

```bash
# Clone and build
git clone https://github.com/cevr/repo.git
cd repo
bun install
bun run build

# Link globally
bun link
```

## Quick Start

```bash
# Fetch a GitHub repo
repo fetch vercel/next.js

# Fetch an npm package (resolves to source repo)
repo fetch npm:effect@3.0.0

# Get the cached path
repo path vercel/next.js

# List all cached repos
repo list

# Search across all cached repos
repo search "createServer"
```

## Spec Formats

| Format | Example                                |
| ------ | -------------------------------------- |
| GitHub | `owner/repo`, `owner/repo@v1.0.0`      |
| npm    | `npm:lodash`, `npm:@effect/cli@0.73.0` |
| PyPI   | `pypi:requests@2.31.0`                 |
| Crates | `crates:serde@1.0.0`                   |

## Commands

| Command               | Description                |
| --------------------- | -------------------------- |
| `repo fetch <spec>`   | Fetch/update repository    |
| `repo path <spec>`    | Get cached path            |
| `repo info <spec>`    | Show repository metadata   |
| `repo list`           | List cached repos          |
| `repo search <query>` | Search across cached repos |
| `repo stats`          | Cache statistics           |
| `repo remove <spec>`  | Remove from cache          |
| `repo prune`          | Remove old/large repos     |
| `repo clean`          | Clear entire cache         |
| `repo open <spec>`    | Open in editor             |

See [SKILL.md](./SKILL.md) for detailed usage.

## Storage

```
~/.cache/repo/
├── metadata.json              # Index
├── {owner}/{repo}/            # GitHub repos
└── {package}/{version}/       # Package registries
```

## Tech Stack

- [Bun](https://bun.sh) - Runtime
- [Effect](https://effect.website) - Functional TypeScript
- [@effect/cli](https://github.com/Effect-TS/effect/tree/main/packages/cli) - CLI framework

## Credits

Inspired by [vercel-labs/opensrc](https://github.com/vercel-labs/opensrc) - a tool for exploring open source projects.

## License

MIT
