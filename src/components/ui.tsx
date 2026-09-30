import type { JSX } from "@solidjs/web";
import { Show, createSignal, createUniqueId, onSettled, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { sx } from "../theme/sx";
import { useTheme } from "../theme/theme-context";
import { skins, themeNames } from "../theme/themes";
import { styles } from "./styles.stylex";

type ButtonVariant = "default" | "primary" | "accent" | "ghost" | "danger";

export function Button(props: {
  variant?: ButtonVariant;
  small?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
  children: JSX.Element;
}) {
  return (
    <button
      {...sx(
        styles.button,
        props.variant === "primary" && styles.buttonPrimary,
        props.variant === "accent" && styles.buttonAccent,
        props.variant === "ghost" && styles.buttonGhost,
        props.variant === "danger" && styles.buttonDanger,
        props.small && styles.buttonSmall,
      )}
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Input(props: {
  value?: string | number;
  onInput?: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <input
      {...sx(styles.input)}
      value={props.value ?? ""}
      type={props.type ?? "text"}
      placeholder={props.placeholder}
      disabled={props.disabled}
      name={props.name}
      onInput={(event) => props.onInput?.(event.currentTarget.value)}
    />
  );
}

export function Textarea(props: {
  value?: string;
  onInput?: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}) {
  return (
    <textarea
      {...sx(styles.textarea)}
      value={props.value ?? ""}
      placeholder={props.placeholder}
      onInput={(event) => props.onInput?.(event.currentTarget.value)}
    />
  );
}

export function Select(props: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      {...sx(styles.select)}
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      {props.options.map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label {...sx(styles.field)}>
      <span {...sx(styles.label)}>{props.label}</span>
      {props.children}
    </label>
  );
}

type BadgeTone = "plain" | "accent" | "success" | "tag" | "dm" | "private";

export function Badge(props: { tone?: BadgeTone; children: JSX.Element }) {
  return (
    <span
      {...sx(
        styles.badge,
        props.tone === "accent" && styles.badgeAccent,
        props.tone === "success" && styles.badgeSuccess,
        props.tone === "tag" && styles.badgeTag,
        props.tone === "dm" && styles.badgeDm,
        props.tone === "private" && styles.badgePrivate,
      )}
    >
      {props.children}
    </span>
  );
}

export function Modal(props: {
  when: boolean;
  title: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  const titleId = createUniqueId();
  return (
    <Show when={props.when}>
      <div {...sx(styles.modalOverlay)} onClick={props.onClose}>
        <div
          {...sx(styles.modal)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => event.stopPropagation()}
        >
          <div {...sx(styles.row)}>
            <h3 id={titleId} {...sx(styles.h3)}>
              {props.title}
            </h3>
            <div {...sx(styles.spacer)} />
            <Button variant="ghost" small onClick={props.onClose}>
              Close
            </Button>
          </div>
          {props.children}
        </div>
      </div>
    </Show>
  );
}

export function Spinner(props: { label?: string }) {
  return <span {...sx(styles.muted)}>{props.label ?? "Loading..."}</span>;
}

export function EmptyState(props: { children: JSX.Element }) {
  return <div {...sx(styles.empty)}>{props.children}</div>;
}

export function ErrorBanner(props: { message: string }) {
  return (
    <Show when={props.message}>
      <div {...sx(styles.errorBanner)}>{props.message}</div>
    </Show>
  );
}

export function Link(props: { href: string; children: JSX.Element; class?: string }) {
  const navigate = useNavigate();
  return (
    <a
      href={props.href}
      onClick={(event) => {
        event.preventDefault();
        navigate(props.href);
      }}
    >
      {props.children}
    </a>
  );
}

export function Avatar(props: { name: string; small?: boolean }) {
  return (
    <span {...sx(styles.avatar, props.small && styles.chatAvatar)}>
      {props.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function ThemeToggle() {
  const { skin } = useTheme();
  return (
    <Menu
      label={`Theme: ${skin().label}`}
      trigger={
        // SVG rather than a glyph: not every theme font has "◐".
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
        </svg>
      }
    >
      <ThemeMenuItems />
    </Menu>
  );
}

export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  const labelId = createUniqueId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <div id={labelId} {...sx(styles.menuGroupLabel)}>
        Theme
      </div>
      {themeNames.map((name) => (
        <MenuRadio checked={theme() === name} onSelect={() => setTheme(name)}>
          <span
            aria-hidden="true"
            {...sx(
              styles.themeSwatch,
              name === "rulebook" && styles.swatchRulebook,
              name === "zine" && styles.swatchZine,
              name === "fantasy" && styles.swatchFantasy,
            )}
          />
          {skins[name].label}
        </MenuRadio>
      ))}
    </div>
  );
}

/** A small dropdown anchored to its trigger; closes on outside click and Escape. */
export function Menu(props: { label: string; trigger: JSX.Element; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  let root: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  const items = () =>
    Array.from(panel?.querySelectorAll<HTMLButtonElement>("button[role^='menuitem']") ?? []);
  const close = () => {
    setOpen(false);
    trigger?.focus();
  };
  const openAt = (last = false) => {
    setOpen(true);
    queueMicrotask(() => {
      const choices = items();
      (last ? choices.at(-1) : choices[0])?.focus();
    });
  };
  onSettled(() => {
    const outside = (event: PointerEvent) => {
      if (open() && root && !root.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (open() && event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  });
  return (
    <div {...sx(styles.menu)} ref={(element) => (root = element)}>
      <button
        type="button"
        {...sx(styles.iconButton)}
        ref={(element) => (trigger = element)}
        aria-label={props.label}
        title={props.label}
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={id}
        onClick={() => (open() ? close() : openAt())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openAt(event.key === "ArrowUp");
          }
        }}
      >
        {props.trigger}
      </button>
      <Show when={open()}>
        <div
          id={id}
          {...sx(styles.menuPanel)}
          role="menu"
          aria-label={props.label}
          ref={(element) => (panel = element)}
          onClick={close}
          onKeyDown={(event) => {
            const choices = items();
            const index = choices.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? choices.length - 1
                  : event.key === "ArrowDown"
                    ? (index + 1) % choices.length
                    : event.key === "ArrowUp"
                      ? (index - 1 + choices.length) % choices.length
                      : undefined;
            if (next !== undefined) {
              event.preventDefault();
              choices[next]?.focus();
            }
            if (event.key === "Tab") setOpen(false);
          }}
        >
          {props.children}
        </div>
      </Show>
    </div>
  );
}

export function MenuItem(props: { onClick: () => void; children: JSX.Element }) {
  return (
    <button type="button" role="menuitem" {...sx(styles.menuItem)} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export function MenuRadio(props: {
  checked: boolean;
  onSelect: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.checked ? "true" : "false"}
      {...sx(styles.menuItem)}
      onClick={props.onSelect}
    >
      <span {...sx(styles.menuCheck)} aria-hidden="true">
        {props.checked ? "✓" : ""}
      </span>
      {props.children}
    </button>
  );
}

/** A menu row that flips a boolean preference; the menu stays open while toggling. */
export function MenuToggle(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={props.checked ? "true" : "false"}
      {...sx(styles.menuItem)}
      onClick={(event) => {
        event.stopPropagation();
        props.onChange(!props.checked);
      }}
    >
      <span {...sx(styles.menuCheck)} aria-hidden="true">
        {props.checked ? "✓" : ""}
      </span>
      {props.children}
    </button>
  );
}

export function TopBar(props: { children?: JSX.Element }) {
  return (
    <header {...sx(styles.topbar)}>
      <div {...sx(styles.brand)}>
        <span {...sx(styles.brandMark)} />
        <span>Tabletop</span>
      </div>
      <div {...sx(styles.topbarActions)}>
        {props.children}
        <ThemeToggle />
      </div>
    </header>
  );
}

export const cx = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(" ");

export type UiComponent = Component;
