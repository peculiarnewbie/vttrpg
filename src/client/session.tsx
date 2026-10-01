import type { JSX } from "@solidjs/web";
import { createContext, createSignal, useContext, type Accessor } from "solid-js";
import type { AuthUser, WorldSummary } from "../domain/schemas";
import { api } from "./api";

type SessionValue = {
  user: Accessor<AuthUser | null>;
  worlds: Accessor<WorldSummary[]>;
  loading: Accessor<boolean>;
  /** The first load's result (resolved with the values, which signals only show after a flush). */
  ready: Promise<{ user: AuthUser | null; worlds: WorldSummary[] }>;
  setUser: (user: AuthUser | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue>();

export function SessionProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<AuthUser | null>(null);
  const [worlds, setWorlds] = createSignal<WorldSummary[]>([]);
  const [loading, setLoading] = createSignal(true);

  const load = async (): Promise<{ user: AuthUser | null; worlds: WorldSummary[] }> => {
    setLoading(true);
    try {
      const result = await api.me();
      setUser(result.user);
      setWorlds(result.worlds);
      return result;
    } catch {
      setUser(null);
      setWorlds([]);
      return { user: null, worlds: [] };
    } finally {
      setLoading(false);
    }
  };
  const refresh = async () => {
    await load();
  };

  const ready = load();

  const value: SessionValue = {
    user,
    worlds,
    loading,
    ready,
    setUser,
    refresh,
    signOut: async () => {
      await api.logout();
      setUser(null);
      setWorlds([]);
    },
  };

  return <SessionContext value={value}>{props.children}</SessionContext>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
