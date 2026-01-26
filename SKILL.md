# repo CLI

Multi-registry source code cache manager. Fetch and cache source code from GitHub, npm, PyPI, and Crates.io.

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

## Spec Formats

| Format | Example                                |
| ------ | -------------------------------------- |
| GitHub | `owner/repo`, `owner/repo@v1.0.0`      |
| npm    | `npm:lodash`, `npm:@effect/cli@0.73.0` |
| PyPI   | `pypi:requests@2.31.0`                 |
| Crates | `crates:serde@1.0.0`                   |

## Commands

### Fetch repositories

```bash
repo fetch owner/repo              # GitHub repo
repo fetch owner/repo@v1.0.0       # Specific tag/branch
repo fetch npm:effect@3.0.0        # npm package
repo fetch pypi:requests           # PyPI package
repo fetch crates:serde@1.0.0      # Crates.io

repo fetch -u owner/repo           # Update existing
repo fetch -f owner/repo           # Force re-fetch
repo fetch --full owner/repo       # Full git history (default: depth 100)
```

### Check paths

```bash
repo path owner/repo               # Get cached path
repo path -q owner/repo            # Quiet mode (just path, no errors)
```

### Get info

```bash
repo info owner/repo               # Show metadata
repo info --json owner/repo        # JSON output
```

### List cached

```bash
repo list                          # List all
repo list -r github                # Filter by registry
repo list --json                   # JSON output
repo list -s size                  # Sort by size
```

### Search

```bash
repo search "pattern"              # Search all cached repos
repo search "pattern" -r github    # Filter by registry
repo search "pattern" -C 3         # With context lines
```

### Manage cache

```bash
repo stats                         # Cache statistics
repo remove owner/repo             # Remove specific repo
repo prune --days 30               # Remove repos older than 30 days
repo prune --max-size 1GB          # Remove repos larger than 1GB
repo clean                         # Remove everything
```

### Open

```bash
repo open owner/repo               # Open in $EDITOR
repo open -f owner/repo            # Open in Finder
repo open -e code owner/repo       # Open in specific editor
```

## Storage

Cache location: `~/.cache/repo/`

```
~/.cache/repo/
├── metadata.json                  # Index of all cached repos
├── {owner}/{repo}/                # GitHub repos
├── {package}/{version}/           # npm/PyPI/Crates packages
```

## Search Tools

After fetching, use these tools to explore:

### ripgrep (rg)

```bash
rg "pattern" ~/.cache/repo/{owner}/{repo}
rg "pattern" -C 3 --type ts ~/.cache/repo/{owner}/{repo}
```

### ast-grep (structural search)

```bash
ast-grep --pattern 'function $NAME($$$)' --lang ts ~/.cache/repo/{owner}/{repo}
ast-grep --pattern 'import { $$$ } from "$MOD"' --lang ts ~/.cache/repo/{owner}/{repo}
```

### fd (file finder)

```bash
fd -e ts ~/.cache/repo/{owner}/{repo}
fd "test" ~/.cache/repo/{owner}/{repo}
```

### eza (directory tree)

```bash
eza --tree --level=3 ~/.cache/repo/{owner}/{repo}
```

## Example Workflow

```bash
# 1. Fetch a repo
repo fetch Effect-TS/effect

# 2. Get its path
repo path Effect-TS/effect
# /Users/.../.cache/repo/Effect-TS/effect

# 3. Search for patterns
rg "pipe" ~/.cache/repo/Effect-TS/effect/packages/effect/src

# 4. Find specific code structures
ast-grep --pattern 'export const $NAME = Effect.$METHOD($$$)' --lang ts ~/.cache/repo/Effect-TS/effect
```
