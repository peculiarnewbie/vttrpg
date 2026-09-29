import type { JSX } from "@solidjs/web";
import { createContext, createEffect, createSignal, useContext, type Accessor } from "solid-js";
import { root } from "./root.stylex";
import { sx } from "./sx";
import { skins, themeClass, themeNames, type Skin, type ThemeName } from "./themes";

type ThemeContextValue = {
  theme: Accessor<ThemeName>;
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
  skin: () => Skin;
  rootStyles: () => ReturnType<typeof sx>;
};

const ThemeContext = createContext<ThemeContextValue>();

const STORAGE_KEY = "ttrpg.theme";

const readInitialTheme = (): ThemeName => {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (themeNames.includes(stored as ThemeName)) return stored as ThemeName;
    // Themes before the art-direction pass: light "posthog", dark "factory".
    if (stored === "posthog") return "rulebook";
    if (stored === "factory") return "fantasy";
  }
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches) {
    return "fantasy";
  }
  return "rulebook";
};

export function ThemeProvider(props: { children: JSX.Element }) {
  const [theme, setThemeSignal] = createSignal<ThemeName>(readInitialTheme());

  const setTheme = (name: ThemeName) => {
    setThemeSignal(name);
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, name);
  };

  createEffect(
    () => theme(),
    (name) => {
      if (typeof document !== "undefined") {
        document.documentElement.dataset.theme = name;
        document.documentElement.style.colorScheme = skins[name].dark ? "dark" : "light";
      }
    },
  );

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme: () => setTheme(themeNames[(themeNames.indexOf(theme()) + 1) % themeNames.length]),
    skin: () => skins[theme()],
    rootStyles: () => sx(root.base, ...themeClass(theme())),
  };

  return <ThemeContext value={value}>{props.children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
