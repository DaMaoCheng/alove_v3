import { existsSync, readFileSync } from "node:fs";

export function readSourceBundle(paths) {
  return paths
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}
