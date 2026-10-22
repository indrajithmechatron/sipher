import { useCallback, useEffect, useState } from "react";

/** Named UI themes. `set1` is the graphite dark theme, `set2` is Pinterest-like.
 *  The tokens live in `src/styles.css` (`:root` = set1, `[data-theme="setN"]`). */
export type ThemeId = "set1" | "set2";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "set1", label: "Set 1 — Graphite" },
  { id: "set2", label: "Set 2 — Pinterest" },
];

const KEY = "sipher-mc-theme";

export function getTheme(): ThemeId {
  try {
    return localStorage.getItem(KEY) === "set2" ? "set2" : "set1";
  } catch {
    return "set1";
  }
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable - theme still applies for this session */
  }
}

export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setThemeState] = useState<ThemeId>(() => getTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    applyTheme(id);
  }, []);
  return [theme, setTheme];
}
