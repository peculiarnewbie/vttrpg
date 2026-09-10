import type { JSX } from "@solidjs/web";
import { createContext, createEffect, createSignal, useContext, type Accessor } from "solid-js";
import { root } from "./root.stylex";
import { sx } from "./sx";
import { themeClass, type ThemeName } from "./themes";

type ThemeContextValue = {
  theme: Accessor<ThemeName>;
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
  rootStyles: () => ReturnType<typeof sx>;
};

const ThemeContext = createContext<ThemeContextValue>();

const STORAGE_KEY = "ttrpg.theme";

const readInitialTheme = (): ThemeName => {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "posthog" || stored === "factory") return stored;
  }
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches) {
    return "factory";
  }
  return "posthog";
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
        document.documentElement.style.colorScheme = name === "factory" ? "dark" : "light";
      }
    },
  );

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme: () => setTheme(theme() === "factory" ? "posthog" : "factory"),
    rootStyles: () => sx(root.base, ...themeClass(theme())),
  };

  return <ThemeContext value={value}>{props.children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
