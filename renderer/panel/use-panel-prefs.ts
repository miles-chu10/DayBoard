import { useState } from "react";

import { readStored, writeStored } from "../lib/storage";
import { normalizePrefs, type PanelPrefs } from "./panel-prefs";

const PREFS_KEY = "menubar:prefs:v1";
const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

export function usePanelPrefs(): [PanelPrefs, (patch: Partial<PanelPrefs>) => void] {
  const [prefs, setPrefs] = useState(() => normalizePrefs(readStored(PREFS_KEY, isObject)));
  const update = (patch: Partial<PanelPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeStored(PREFS_KEY, next);
  };
  return [prefs, update];
}
