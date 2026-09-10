import { useNavigate } from "@solidjs/router";
import { createSignal, onSettled, Show } from "solid-js";
import { api, ApiError } from "../client/api";
import { useSession } from "../client/session";
import { Button, ErrorBanner, Field, Input } from "../components/ui";
import { styles } from "../components/styles.stylex";
import { sx } from "../theme/sx";

type Mode = "google" | "local";

export default function SignIn() {
  const session = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = createSignal<Mode>("google");
  const [email, setEmail] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  onSettled(() => {
    if (session.user()) navigate("/dashboard", { replace: true });
  });

  const google = async (event: Event) => {
    event.preventDefault();
    if (!email().trim()) return;
    setBusy(true);
    setError("");
    try {
      const { user } = await api.google(
        email().trim(),
        displayName().trim() || email().split("@")[0],
      );
      session.setUser(user);
      await session.refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  const local = async (event: Event) => {
    event.preventDefault();
    if (!username().trim() || !password()) return;
    setBusy(true);
    setError("");
    try {
      const { user } = await api.login(username().trim(), password());
      session.setUser(user);
      await session.refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...sx(styles.center)}>
      <div {...sx(styles.authWindow)}>
        <div {...sx(styles.authLogo)}>
          <span {...sx(styles.brandMark)} />
          <span>Tabletop</span>
        </div>
        <p {...sx(styles.muted)}>
          A tiny virtual tabletop: character sheets, dice, chat, and notes — all living on
          Cloudflare.
        </p>

        <div {...sx(styles.tabBar)}>
          <button
            {...sx(styles.tab, mode() === "google" && styles.tabActive)}
            onClick={() => setMode("google")}
          >
            Continue with Google
          </button>
          <button
            {...sx(styles.tab, mode() === "local" && styles.tabActive)}
            onClick={() => setMode("local")}
          >
            Username & password
          </button>
        </div>

        <ErrorBanner message={error()} />

        <Show when={mode() === "google"}>
          <form {...sx(styles.col)} onSubmit={google}>
            <Field label="Google email (dev stub)">
              <Input
                value={email()}
                onInput={setEmail}
                placeholder="you@example.com"
                type="email"
              />
            </Field>
            <Field label="Display name">
              <Input value={displayName()} onInput={setDisplayName} placeholder="Optional" />
            </Field>
            <Button type="submit" variant="primary" disabled={busy()}>
              {busy() ? "Signing in..." : "Sign in"}
            </Button>
            <p {...sx(styles.faint)}>
              Dev stub: real Google OAuth drops in behind the same interface later.
            </p>
          </form>
        </Show>

        <Show when={mode() === "local"}>
          <form {...sx(styles.col)} onSubmit={local}>
            <Field label="Username">
              <Input value={username()} onInput={setUsername} placeholder="username" />
            </Field>
            <Field label="Password">
              <Input
                value={password()}
                onInput={setPassword}
                placeholder="••••••••"
                type="password"
              />
            </Field>
            <Button type="submit" variant="primary" disabled={busy()}>
              {busy() ? "Signing in..." : "Sign in"}
            </Button>
            <p {...sx(styles.faint)}>Accounts with a username are created by a world owner.</p>
          </form>
        </Show>
      </div>
    </div>
  );
}
