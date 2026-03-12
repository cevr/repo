import { Command } from "effect/unstable/cli";

import { fetch } from "./fetch.js";
import { list } from "./list.js";
import { search } from "./search.js";
import { remove } from "./remove.js";
import { clean } from "./clean.js";
import { prune } from "./prune.js";
import { stats } from "./stats.js";
import { open } from "./open.js";
import { path } from "./path.js";
import { info } from "./info.js";

export const rootCommand = Command.make("repo").pipe(
  Command.withDescription("Multi-registry source code cache manager"),
  Command.withSubcommands([fetch, list, search, remove, clean, prune, stats, open, path, info]),
);
