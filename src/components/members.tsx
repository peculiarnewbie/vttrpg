import { For, Show, createSignal } from "solid-js";
import { api, ApiError } from "../client/api";
import type { MemberKind, MemberRole, WorldMember } from "../domain/schemas";
import { Badge, Button, ErrorBanner, Field, Input, Modal } from "./ui";
import { styles } from "./styles.stylex";
import { sx } from "../theme/sx";

export function MembersPanel(props: {
  worldId: string;
  me: WorldMember;
  members: WorldMember[];
  onMembers: (members: WorldMember[]) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [displayName, setDisplayName] = createSignal("");
  const [role, setRole] = createSignal<MemberRole>("player");
  const [kind, setKind] = createSignal<MemberKind>("invite");
  const [email, setEmail] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [resetFor, setResetFor] = createSignal<WorldMember | null>(null);
  const [resetPassword, setResetPassword] = createSignal("");

  const refresh = async () => {
    try {
      props.onMembers(await api.listMembers(props.worldId));
    } catch {
      // ignore
    }
  };

  const create = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createMember(props.worldId, {
        displayName: displayName().trim() || username() || email().split("@")[0],
        role: role(),
        kind: kind(),
        email: kind() === "invite" ? email().trim() : undefined,
        username: kind() === "password" ? username().trim() : undefined,
        password: kind() === "password" ? password() : undefined,
      });
      setOpen(false);
      setDisplayName("");
      setEmail("");
      setUsername("");
      setPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create member");
    } finally {
      setBusy(false);
    }
  };

  const setRoleFor = async (member: WorldMember, nextRole: MemberRole) => {
    await api.updateMember(props.worldId, member.id, { role: nextRole });
    await refresh();
  };

  const remove = async (member: WorldMember) => {
    await api.deleteMember(props.worldId, member.id);
    await refresh();
  };

  const resetPasswordSubmit = async (event: Event) => {
    event.preventDefault();
    const member = resetFor();
    if (!member || !resetPassword()) return;
    setBusy(true);
    try {
      await api.updateMember(props.worldId, member.id, { password: resetPassword() });
      setResetFor(null);
      setResetPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div {...sx(styles.row)}>
        <h3 {...sx(styles.h3)}>Members</h3>
        <div {...sx(styles.spacer)} />
        <Button variant="primary" small onClick={() => setOpen(true)}>
          Add member
        </Button>
      </div>
      <div {...sx(styles.divider)} />
      <ErrorBanner message={error()} />

      <div {...sx(styles.col)}>
        <For each={props.members}>
          {(member) => (
            <div {...sx(styles.panel, styles.row)}>
              <div {...sx(styles.grow)}>
                <div {...sx(styles.row)}>
                  <span>{member.displayName}</span>
                  <Badge tone={member.role === "dm" ? "tag" : "accent"}>{member.role}</Badge>
                  <Badge tone="plain">{member.kind}</Badge>
                  <Show when={member.id === props.me.id}>
                    <Badge tone="success">you</Badge>
                  </Show>
                </div>
                <span {...sx(styles.faint)}>{member.email ?? member.username ?? "—"}</span>
              </div>
              <Show when={member.kind !== "owner"}>
                <select
                  {...sx(styles.select)}
                  value={member.role}
                  onChange={(event) =>
                    void setRoleFor(member, event.currentTarget.value as MemberRole)
                  }
                >
                  <option value="player">player</option>
                  <option value="dm">dm</option>
                </select>
                <Show when={member.kind === "password"}>
                  <Button small onClick={() => setResetFor(member)}>
                    Password
                  </Button>
                </Show>
                <Button small variant="danger" onClick={() => void remove(member)}>
                  Remove
                </Button>
              </Show>
            </div>
          )}
        </For>
      </div>

      <Modal when={open()} title="Add a member" onClose={() => setOpen(false)}>
        <form {...sx(styles.col)} onSubmit={create}>
          <Field label="Display name">
            <Input value={displayName()} onInput={setDisplayName} placeholder="Player name" />
          </Field>
          <div {...sx(styles.row)}>
            <Field label="Role">
              <select
                {...sx(styles.select)}
                value={role()}
                onChange={(event) => setRole(event.currentTarget.value as MemberRole)}
              >
                <option value="player">Player</option>
                <option value="dm">Dungeon Master</option>
              </select>
            </Field>
            <Field label="Access">
              <select
                {...sx(styles.select)}
                value={kind()}
                onChange={(event) => setKind(event.currentTarget.value as MemberKind)}
              >
                <option value="invite">Google invite</option>
                <option value="password">Username & password</option>
              </select>
            </Field>
          </div>
          <Show when={kind() === "invite"}>
            <Field label="Invited Google email">
              <Input
                value={email()}
                onInput={setEmail}
                placeholder="player@example.com"
                type="email"
              />
            </Field>
          </Show>
          <Show when={kind() === "password"}>
            <Field label="Username">
              <Input value={username()} onInput={setUsername} placeholder="username" />
            </Field>
            <Field label="Password">
              <Input
                value={password()}
                onInput={setPassword}
                placeholder="password"
                type="password"
              />
            </Field>
          </Show>
          <Button type="submit" variant="primary" disabled={busy()}>
            {busy() ? "Adding..." : "Add member"}
          </Button>
        </form>
      </Modal>

      <Modal when={resetFor() !== null} title="Reset password" onClose={() => setResetFor(null)}>
        <form {...sx(styles.col)} onSubmit={resetPasswordSubmit}>
          <p {...sx(styles.muted)}>
            New password for {resetFor()?.displayName}. Only you can see and set this.
          </p>
          <Field label="New password">
            <Input value={resetPassword()} onInput={setResetPassword} type="password" />
          </Field>
          <Button type="submit" variant="primary" disabled={busy() || !resetPassword()}>
            Update password
          </Button>
        </form>
      </Modal>
    </div>
  );
}
