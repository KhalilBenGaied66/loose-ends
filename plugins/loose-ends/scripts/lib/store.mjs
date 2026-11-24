// Local state only: ~/.loose-ends (or LOOSE_ENDS_HOME). Nothing ever leaves the machine.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function home() {
  return process.env.LOOSE_ENDS_HOME || path.join(os.homedir(), ".loose-ends");
}

export function loadJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(home(), name), "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

export function saveJson(name, data) {
  const dir = home();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
