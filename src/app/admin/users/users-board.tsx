"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateAccountStatusAction } from "@/app/admin/access/actions";
import { AdminIcon } from "@/components/admin/admin-icons";
import { catalogQuery } from "@/components/admin/catalog-ui";
import { LiveSearchInput } from "@/components/live-query";
import { StatusBadge } from "@/components/status-badge";
import type { AdminActionState } from "@/lib/admin/action-state";
import type { BadgeTone } from "@/lib/admin/labels";
import { ProfilePhoto } from "@/components/profile-photo";
import { UserAccountForms } from "./[id]/user-forms";
import { createUserAction, deleteUserAction, readUserAccount, updateUserAction, type UserAccountView } from "./actions";

export type UserRow = {
  id: string;
  email: string;
  phone: string | null;
  name: string | null;
  roleLabel: string;
  status: string;
  statusLabel: string;
  statusTone: BadgeTone;
  createdLabel: string;
  timezone: string;
  canManage: boolean;
  canEdit: boolean;
  self: boolean;
  lockLabel: string;
  imageVersion: string | null;
};

function UserAvatar({
  userId,
  name,
  imageVersion,
  size,
  alt = "",
}: {
  userId: string;
  name: string;
  imageVersion: string | null;
  size: number;
  alt?: string;
}) {
  return <ProfilePhoto userId={userId} name={name} version={imageVersion} size={size} alt={alt} />;
}

const initial: AdminActionState = {};
const statuses = [
  { value: "ACTIVE", label: "Active" },
  { value: "PENDING_VERIFICATION", label: "Pending verification" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "DISABLED", label: "Disabled" },
];

export type UserListQuery = {
  q: string;
  status: string;
  role: string;
  page: number;
  pageSize: number;
  total: number;
  query: string;
};

const statusChips = [
  { value: "", label: "All Users" },
  { value: "ACTIVE", label: "Active" },
  { value: "PENDING_VERIFICATION", label: "Pending Verif." },
  { value: "SUSPENDED", label: "Suspended" },
] as const;

const roleChips = [
  { value: "PATIENT", label: "Patient" },
  { value: "DOCTOR", label: "Doctor" },
  { value: "ADMIN", label: "Administrator" },
] as const;

function compactCount(total: number) {
  if (total < 1000) return String(total);
  const thousands = total / 1000;
  const rounded = thousands >= 10 ? Math.round(thousands).toString() : thousands.toFixed(1).replace(/\.0$/, "");
  return `${rounded}k`;
}

function listHref(q: string, status: string, role: string) {
  return catalogQuery("/admin/users", { q, status, role });
}

function pageHref(query: string, page: number) {
  return `${query}${query.includes("?") ? "&" : "?"}page=${page}`;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function shortStatus(status: string) {
  if (status === "PENDING_VERIFICATION") return "Pending";
  if (status === "ACTIVE") return "Active";
  if (status === "SUSPENDED") return "Suspended";
  if (status === "DISABLED") return "Disabled";
  return status;
}

type Mode = { kind: "create" } | { kind: "view"; userId: string } | { kind: "edit"; user: UserRow } | { kind: "delete"; user: UserRow } | null;

function rememberView(userId: string | null) {
  const url = new URL(window.location.href);
  if (userId) url.searchParams.set("view", userId);
  else url.searchParams.delete("view");
  const next = `${url.pathname}${url.search}`;
  if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
}

export function UsersBoard({
  rows,
  canCreateElevated,
  initialViewId = null,
  list,
}: {
  rows: UserRow[];
  canCreateElevated: boolean;
  initialViewId?: string | null;
  list: UserListQuery;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialViewId ? { kind: "view", userId: initialViewId } : null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [suspendNote, setSuspendNote] = useState<string | null>(null);
  const [suspending, setSuspending] = useState(false);
  const rowKey = rows.map((user) => user.id).join(",");

  useEffect(() => {
    setSelected(new Set());
    setMenuId(null);
  }, [rowKey]);

  function openView(userId: string) {
    setMode({ kind: "view", userId });
    rememberView(userId);
  }

  function closeMode() {
    setMode(null);
    rememberView(null);
  }

  const manageable = rows.filter((user) => user.canManage);
  const allPicked = manageable.length > 0 && manageable.every((user) => selected.has(user.id));
  const somePicked = manageable.some((user) => selected.has(user.id));
  const chosen = rows.filter((user) => selected.has(user.id));
  const suspendable = chosen.filter((user) => user.canManage && user.status === "ACTIVE");
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const activeStatus = list.status || "";
  const activeRole = list.role || "";

  function toggleAll() {
    setSelected(allPicked ? new Set() : new Set(manageable.map((user) => user.id)));
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportAccounts() {
    const source = chosen.length > 0 ? chosen : rows;
    const header = ["Name", "Email", "Phone", "Role", "Status"];
    const body = source.map((user) => [user.name ?? "", user.email, user.phone ?? "", user.roleLabel, user.statusLabel].map(csvCell).join(","));
    const file = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "users.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function confirmSuspend() {
    const cleaned = reason.trim();
    if (cleaned.length < 10 || cleaned.length > 500) {
      setSuspendNote("Enter an operational reason between 10 and 500 characters.");
      return;
    }
    setSuspending(true);
    setSuspendNote(null);
    for (const user of suspendable) {
      const formData = new FormData();
      formData.set("userId", user.id);
      formData.set("change", "suspend");
      formData.set("reason", cleaned);
      const result = await updateAccountStatusAction({}, formData);
      if (result.tone === "error") {
        setSuspendNote(result.message ?? "Could not suspend that account.");
        setSuspending(false);
        return;
      }
    }
    setSuspending(false);
    setSuspendOpen(false);
    setReason("");
    setSelected(new Set());
    router.refresh();
  }

  return (
    <>
      <section className="users-app" aria-label="User management">
        <div className="users-app-search">
          <AdminIcon name="search" />
          <LiveSearchInput destination="/admin/users" initial={list.q} placeholder="Search by name, email or ID..." className="users-app-search-input" />
        </div>
        <div className="users-app-chips" role="navigation" aria-label="Filters">
          {statusChips.map((chip) => {
            const current = chip.value === "" ? activeStatus === "" && activeRole === "" : activeStatus === chip.value;
            const count = current ? ` (${compactCount(list.total)})` : "";
            return (
              <Link key={chip.value || "all"} href={listHref(list.q, chip.value, chip.value === "" ? "" : list.role)} className={current ? "users-app-chip is-current" : "users-app-chip"} aria-current={current ? "page" : undefined}>
                {`${chip.label}${count}`}
              </Link>
            );
          })}
          {roleChips.map((chip) => {
            const current = activeRole === chip.value;
            return (
              <Link key={`role-${chip.value}`} href={listHref(list.q, list.status, chip.value)} className={current ? "users-app-chip is-current" : "users-app-chip"} aria-current={current ? "page" : undefined}>
                {chip.label}
              </Link>
            );
          })}
        </div>
        <div className="users-app-tools">
          <label className="users-app-select">
            <input type="checkbox" checked={allPicked} ref={(node) => { if (node) node.indeterminate = somePicked && !allPicked; }} disabled={manageable.length === 0} onChange={toggleAll} />
            Select all
          </label>
          <button type="button" className="users-app-tool" onClick={() => setMode({ kind: "create" })}>
            Add
          </button>
          <button type="button" className="users-app-tool" onClick={exportAccounts} disabled={rows.length === 0}>
            Export
          </button>
          <button
            type="button"
            className="users-app-tool"
            onClick={() => {
              setSuspendNote(null);
              if (suspendable.length === 0) {
                setSuspendNote("Select active accounts to suspend.");
                return;
              }
              setSuspendOpen(true);
            }}
          >
            Suspend
          </button>
        </div>
        {suspendNote && !suspendOpen ? <p className="users-app-note" role="status">{suspendNote}</p> : null}
        {rows.length === 0 ? (
          <p className="users-empty">No accounts match these filters.</p>
        ) : (
          <ul className="users-app-list">
            {rows.map((user) => {
              const title = user.name ?? user.email;
              const menuOpen = menuId === user.id;
              return (
                <li key={user.id} className="users-app-card">
                  <input type="checkbox" aria-label={`Select ${title}`} checked={selected.has(user.id)} disabled={!user.canManage} onChange={() => toggleOne(user.id)} />
                  <UserAvatar userId={user.id} name={title} imageVersion={user.imageVersion} size={44} />
                  <button type="button" className="users-app-person" onClick={() => openView(user.id)}>
                    <span className="users-app-name">{title}</span>
                    {user.name ? <span className="users-app-mail">{user.email}</span> : null}
                  </button>
                  <span className="users-app-meta">
                    <span className={`users-app-badge is-${user.statusTone}`}>{shortStatus(user.status)}</span>
                    <span className="users-app-role">{user.roleLabel}</span>
                  </span>
                  <div className="users-app-menu">
                    <button type="button" className="users-app-more-btn" aria-label={`Actions for ${title}`} aria-expanded={menuOpen} onClick={() => setMenuId(menuOpen ? null : user.id)}>
                      <AdminIcon name="ellipsis" />
                    </button>
                    {menuOpen ? (
                      <div className="users-app-pop" role="menu">
                        <button type="button" role="menuitem" onClick={() => { setMenuId(null); openView(user.id); }}>
                          View
                        </button>
                        {user.canEdit ? (
                          <button type="button" role="menuitem" onClick={() => { setMenuId(null); setMode({ kind: "edit", user }); }}>
                            Edit
                          </button>
                        ) : null}
                        {user.canManage ? (
                          <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuId(null); setMode({ kind: "delete", user }); }}>
                            Delete
                          </button>
                        ) : null}
                        {!user.canEdit && !user.canManage ? <p>{user.lockLabel}</p> : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {list.page > 1 ? (
          <Link className="users-app-load" href={pageHref(list.query, list.page - 1)}>
            Previous users
          </Link>
        ) : null}
        {list.page < pages ? (
          <Link className="users-app-load" href={pageHref(list.query, list.page + 1)}>
            Load more users
          </Link>
        ) : null}
      </section>
      <section className="users-card users-desk">
      <header className="users-card-head">
        <h2>Accounts</h2>
        <button type="button" className="users-add" onClick={() => setMode({ kind: "create" })}>
          <AdminIcon name="plus" />
          Add user
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="users-empty">No accounts match these filters.</p>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <caption className="sr-only">Users</caption>
            <colgroup>
              <col className="users-col-account" />
              <col className="users-col-role" />
              <col className="users-col-status" />
              <col className="users-col-created" />
              <col className="users-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Account</th>
                <th>Access</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr key={user.id}>
                  <td data-label="Account">
                    <span className="users-cell">
                      <span className="users-person">
                        <UserAvatar userId={user.id} name={user.name ?? user.email} imageVersion={user.imageVersion} size={36} />
                        <span>
                          <button type="button" className="users-email" onClick={() => openView(user.id)}>
                            {user.email}
                          </button>
                          <span className="users-sub">{user.name ?? "No profile name"}</span>
                          {user.phone ? <span className="users-sub">{user.phone}</span> : null}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td data-label="Access">
                    <span className="users-cell">{user.roleLabel}</span>
                  </td>
                  <td data-label="Status">
                    <span className="users-cell">
                      <StatusBadge tone={user.statusTone}>{user.statusLabel}</StatusBadge>
                    </span>
                  </td>
                  <td data-label="Created">
                    <span className="users-cell">{user.createdLabel}</span>
                  </td>
                  <td data-label="Actions">
                    <span className="users-cell">
                    <div className="user-actions">
                      <button type="button" className="user-icon-btn" aria-label={`View ${user.email}`} onClick={() => openView(user.id)}>
                        <AdminIcon name="view" />
                      </button>
                      {user.canEdit ? (
                        <button type="button" className="user-icon-btn" aria-label={`Edit ${user.email}`} onClick={() => setMode({ kind: "edit", user })}>
                          <AdminIcon name="edit" />
                        </button>
                      ) : null}
                      {user.canManage ? (
                        <button type="button" className="user-icon-btn user-icon-btn-danger" aria-label={`Delete ${user.email}`} onClick={() => setMode({ kind: "delete", user })}>
                          <AdminIcon name="trash" />
                        </button>
                      ) : null}
                      {!user.canEdit && !user.canManage ? <span className="users-sub">{user.lockLabel}</span> : null}
                    </div>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
      {mode?.kind === "create" ? <CreateDialog canCreateElevated={canCreateElevated} onClose={closeMode} /> : null}
      {mode?.kind === "view" ? (
        <ViewDialog
          userId={mode.userId}
          onClose={closeMode}
          onEdit={(user) => setMode({ kind: "edit", user })}
        />
      ) : null}
      {mode?.kind === "edit" ? <EditDialog user={mode.user} onClose={closeMode} /> : null}
      {mode?.kind === "delete" ? <DeleteDialog user={mode.user} onClose={closeMode} /> : null}
      {suspendOpen ? (
        <Modal title="Suspend accounts" onClose={() => { if (!suspending) setSuspendOpen(false); }}>
          <form
            className="user-form"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmSuspend();
            }}
          >
            <p className="user-form-note">
              Suspend {suspendable.length} active account{suspendable.length === 1 ? "" : "s"}? Sign-in stops and open sessions end. Profiles, appointments, and payment history stay in place.
            </p>
            <label>
              Operational reason
              <textarea value={reason} required minLength={10} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </label>
            {suspendNote ? <p className="user-form-error" role="alert">{suspendNote}</p> : null}
            <div className="user-form-actions">
              <button type="button" className="users-cancel" disabled={suspending} onClick={() => setSuspendOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="users-delete" disabled={suspending}>
                {suspending ? "Suspending…" : "Suspend"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function ViewDialog({ userId, onClose, onEdit }: { userId: string; onClose: () => void; onEdit: (user: UserRow) => void }) {
  const [view, setView] = useState<UserAccountView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    readUserAccount(userId)
      .then((result) => {
        if (!active) return;
        if (!result.ok) setError(result.message);
        else setView(result.user);
      })
      .catch(() => {
        if (active) setError("Account details are unavailable right now.");
      });
    return () => {
      active = false;
    };
  }, [userId]);
  return (
    <Modal title="View user" onClose={onClose}>
      <div className="user-view">
        {!view && !error ? <p className="user-form-note">Loading account…</p> : null}
        {error ? <p className="user-form-error" role="alert">{error}</p> : null}
        {view ? (
          <>
            <div className="users-person">
              <UserAvatar userId={view.id} name={view.name ?? view.email} imageVersion={view.imageVersion} size={64} alt={`${view.name ?? view.email} profile photo`} />
              <span>
                <p className="user-view-email">{view.email}</p>
                <p className="user-view-role">{view.roleLabel}</p>
              </span>
            </div>
            <dl className="user-view-grid">
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge tone={view.statusTone}>{view.statusLabel}</StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd>{view.name ?? "No profile name"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{view.phone ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{view.timezone}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{view.createdLabel}</dd>
              </div>
              <div>
                <dt>Last sign-in</dt>
                <dd>{view.lastLoginLabel}</dd>
              </div>
              <div>
                <dt>Email verified</dt>
                <dd>{view.emailVerifiedLabel}</dd>
              </div>
              <div>
                <dt>Open sessions</dt>
                <dd>{view.openSessions}</dd>
              </div>
            </dl>
            {view.roles.length > 0 ? (
              <section className="user-view-section">
                <h3>Roles</h3>
                <ul>
                  {view.roles.map((role) => (
                    <li key={role.code}>
                      <span>{role.name}</span>
                      <span>Granted {role.grantedLabel}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {view.patient ? (
              <Link className="user-view-link" href={`/admin/patients/${view.patient.id}`}>
                Patient profile: {view.patient.fullName}
              </Link>
            ) : null}
            {view.doctor ? (
              <Link className="user-view-link" href={`/admin/doctors/${view.doctor.id}`}>
                Doctor profile: {view.doctor.fullName}{" "}
                <StatusBadge tone={view.doctor.verificationTone}>{view.doctor.verificationLabel}</StatusBadge>
              </Link>
            ) : null}
            {view.notices.map((notice) => (
              <p key={notice} className="user-form-note">
                {notice}
              </p>
            ))}
            {view.forms.canSuspend || view.forms.canReactivate || view.forms.canManagePrivileges ? (
              <div className="user-view-forms">
                <UserAccountForms userId={view.id} {...view.forms} />
              </div>
            ) : null}
            <div className="user-form-actions">
              <button type="button" className="users-cancel" onClick={onClose}>
                Close
              </button>
              {view.canEdit ? (
                <button
                  type="button"
                  className="users-add"
                  onClick={() =>
                    onEdit({
                      id: view.id,
                      email: view.email,
                      phone: view.phone,
                      name: view.name,
                      roleLabel: view.roleLabel,
                      status: view.status,
                      statusLabel: view.statusLabel,
                      statusTone: view.statusTone,
                      createdLabel: view.createdLabel,
                      timezone: view.timezone,
                      canManage: view.canManage,
                      canEdit: true,
                      self: !view.canManage,
                      lockLabel: "",
                      imageVersion: view.imageVersion,
                    })
                  }
                >
                  Edit
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function CreateDialog({ canCreateElevated, onClose }: { canCreateElevated: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(createUserAction, initial);
  const [role, setRole] = useState("PATIENT");
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);
  return (
    <Modal title="Add user" onClose={onClose}>
      <form action={action} className="user-form">
        <label>
          Role
          <select name="roleCode" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="PATIENT">Patient</option>
            {canCreateElevated ? <option value="ADMIN">Administrator</option> : null}
            {canCreateElevated ? <option value="SUPER_ADMIN">Super administrator</option> : null}
          </select>
        </label>
        <label>
          Full name
          <input name="fullName" required={role === "PATIENT"} autoComplete="name" maxLength={120} />
        </label>
        {role === "PATIENT" ? (
          <>
            <label>
              Gender
              <select name="gender" defaultValue="" required>
                <option value="" disabled>
                  Select gender
                </option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </label>
            <label>
              Date of birth
              <input name="dateOfBirth" type="date" required />
            </label>
          </>
        ) : (
          <input type="hidden" name="gender" value="" />
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="off" maxLength={254} />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" autoComplete="off" placeholder="+232 76 000 001" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="new-password" minLength={6} maxLength={128} />
        </label>
        <p className="user-form-note">Use 6 to 128 characters, with at least one letter and one number. The account can sign in immediately.</p>
        <FormMessage state={state} />
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="users-add" disabled={pending}>
            {pending ? "Saving…" : "Create account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateUserAction, initial);
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);
  return (
    <Modal title="Edit user" onClose={onClose}>
      <form action={action} className="user-form">
        <input type="hidden" name="userId" value={user.id} />
        <label>
          Full name
          <input name="fullName" defaultValue={user.name ?? ""} required={Boolean(user.name)} autoComplete="name" maxLength={120} />
        </label>
        <label>
          Email
          <input name="email" type="email" required defaultValue={user.email} autoComplete="off" maxLength={254} />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" defaultValue={user.phone ?? ""} autoComplete="off" placeholder="+232 76 000 001" />
        </label>
        <label>
          Timezone
          <input name="timezone" defaultValue={user.timezone} required maxLength={64} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={user.status} disabled={user.self}>
            {statuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        {user.self ? <input type="hidden" name="status" value={user.status} /> : null}
        <label>
          New password
          <input name="password" type="password" autoComplete="new-password" minLength={6} maxLength={128} placeholder="Leave blank to keep the current password" />
        </label>
        <p className="user-form-note">The saved email and password are what this account uses the next time it signs in. A new password needs a letter and a number.</p>
        <FormMessage state={state} />
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="users-add" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(deleteUserAction, initial);
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);
  return (
    <Modal title="Delete user" onClose={onClose}>
      <form action={action} className="user-form">
        <input type="hidden" name="userId" value={user.id} />
        <p className="user-form-note">
          Delete {user.email}? The account will be closed and open sessions will end. Appointments and payment history already stored stay available.
        </p>
        <FormMessage state={state} />
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="users-delete" disabled={pending}>
            {pending ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="user-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="user-modal" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="user-modal-head">
          <h2 id="user-dialog-title">{title}</h2>
          <button type="button" className="user-icon-btn" aria-label="Close" onClick={onClose}>
            <AdminIcon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function FormMessage({ state }: { state: AdminActionState }) {
  if (!state.message) return null;
  return (
    <p className={state.tone === "error" ? "user-form-error" : "user-form-ok"} role={state.tone === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}
