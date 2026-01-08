# repo CLI

Multi-registry source code cache manager built with Bun + Effect TypeScript.

## Quick Start

```bash
# Build
bun run build

# Install globally
bun run link

# Usage
repo fetch vercel/next.js
repo fetch npm:effect@3.19.0
repo list
repo search "pattern"
```

## Architecture

### Services (src/services/)

| Service | Purpose |
|---------|---------|
| `CacheService` | Cache directory operations (paths, existence, size, removal) |
| `MetadataService` | JSON metadata storage (load/save/query repos) |
| `GitService` | Git operations (clone, remove .git, get default branch) |
| `RegistryService` | Registry dispatcher (parse specs, fetch from registries) |

Each service has:
- Live layer: Real filesystem/network implementation
- Test layer: In-memory implementation for testing

### Commands (src/commands/)

| Command | Description |
|---------|-------------|
| `fetch` | Clone/download from registry |
| `list` | List cached repos |
| `search` | Search with ripgrep |
| `remove` | Remove specific repo |
| `clean` | Remove all repos |
| `prune` | Remove old/large repos |
| `stats` | Show cache statistics |
| `open` | Open in editor/finder |

### Layer Composition (src/main.ts)

```
BunContext
    └── PlatformServicesLayer (CacheService + MetadataService)
    └── GitLayer (standalone)
    └── RegistryLayer (depends on Git + Platform)
```

## Cache Location

```
~/.cache/repo/
├── metadata.json           # Index of all cached repos
├── github/{owner}/{repo}/  # GitHub repos
├── npm/{pkg}/{version}/    # npm packages
├── pypi/{pkg}/{version}/   # PyPI packages
└── crates/{crate}/{ver}/   # Crates.io crates
```

## Spec Formats

```
owner/repo              # GitHub
owner/repo@ref          # GitHub with branch/tag
github:owner/repo       # Explicit GitHub
npm:package@version     # npm
npm:@scope/pkg@version  # Scoped npm
pypi:package@version    # PyPI
crates:crate@version    # Crates.io
```

## Development

```bash
# Run in dev mode
bun run dev fetch vercel/next.js

# Type check
bun run typecheck

# Build binary
bun run build
```

## Effect Patterns Used

- `Context.Tag` for service definitions
- `Layer.effect` for services with dependencies
- `Layer.sync` for test layers
- `Schema` for data validation (PackageSpec, MetadataIndex)
- `Data.TaggedError` for typed errors
- `Effect.gen` for generator-based effects
- `@effect/cli` Command and Options
