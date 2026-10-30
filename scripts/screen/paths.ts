// Shared paths for the name-screening scripts. Inputs and outputs live under
// research/name-screening/ (large and licensed files there are git-ignored).
import { dirname, join } from "node:path";

export const ROOT = join(dirname(Bun.fileURLToPath(import.meta.url)), "../..");
export const RES = join(ROOT, "research/name-screening");
export const INPUTS = join(RES, "inputs"); // behnevis/, ldnoobw/, words_alpha.txt
export const OUT = join(RES, "out"); // out/<tier>/ per rank.ts run; out/open is the release one
