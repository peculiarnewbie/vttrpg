import type { JSX } from "@solidjs/web";
import { Show, createSignal, createUniqueId, onCleanup, onSettled, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { sx } from "../theme/sx";
import { useTheme } from "../theme/theme-context";
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
  return (
    <Show when={props.when}>
      <div {...sx(styles.modalOverlay)} onClick={props.onClose}>
        <div {...sx(styles.modal)} onClick={(event) => event.stopPropagation()}>
          <div {...sx(styles.row)}>
            <h3 {...sx(styles.h3)}>{props.title}</h3>
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

export function Avatar(props: { name: string }) {
  return <span {...sx(styles.avatar)}>{props.name.slice(0, 2).toUpperCase()}</span>;
}

export function ThemeToggle() {
  const { toggleTheme, skin } = useTheme();
  const label = () => `Theme: ${skin().label} (click for the next)`;
  return (
    <button
      type="button"
      {...sx(styles.iconButton)}
      aria-label={label()}
      title={label()}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{skin().dark ? "☀" : "☾"}</span>
    </button>
  );
}

/** A small dropdown anchored to its trigger; closes on outside click and Escape. */
export function Menu(props: { label: string; trigger: JSX.Element; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  let root: HTMLDivElement | undefined;
  onSettled(() => {
    const outside = (event: PointerEvent) => {
      if (open() && root && !root.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (open() && event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    });
  });
  return (
    <div {...sx(styles.menu)} ref={(element) => (root = element)}>
      <button
        type="button"
        {...sx(styles.iconButton)}
        aria-label={props.label}
        title={props.label}
        aria-haspopup="true"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={id}
        onClick={() => setOpen(!open())}
      >
        {props.trigger}
      </button>
      <Show when={open()}>
        <div id={id} {...sx(styles.menuPanel)} role="menu" onClick={() => setOpen(false)}>
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
