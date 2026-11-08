"use client";

import { useActionState, useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminIcon } from "@/components/admin/admin-icons";
import { StatusBadge } from "@/components/status-badge";
import { createServiceAction, deleteServiceAction, updateServiceAction, type ServiceActionState } from "./actions";

const initial: ServiceActionState = {};

export type ServiceRecord = {
  id: string;
  code: string;
  slug: string;
  name: string;
  description: string | null;
  mode: string | null;
  durationMinutes: number;
  defaultFee: string;
  currency: string;
  preparationInstructions: string | null;
  isActive: boolean;
  referenced: boolean;
  offeringCount: number;
  appointmentCount: number;
  createdLabel: string;
  updatedLabel: string;
};

type Panel =
  | { kind: "create" }
  | { kind: "view"; service: ServiceRecord }
  | { kind: "edit"; service: ServiceRecord }
  | { kind: "delete"; service: ServiceRecord }
  | null;

function modeLabel(mode: string | null) {
  if (mode === "ONLINE") return "Online";
  if (mode === "IN_PERSON") return "In person";
  return "Either";
}

function usageLabel(service: ServiceRecord) {
  if (!service.referenced) return "Not used yet";
  const offerings = `${service.offeringCount} offering${service.offeringCount === 1 ? "" : "s"}`;
  const appointments = `${service.appointmentCount} appointment${service.appointmentCount === 1 ? "" : "s"}`;
  return `${offerings} · ${appointments}`;
}

export function ServicesBoard({ services, currency }: { services: ServiceRecord[]; currency: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const close = useCallback(() => setPanel(null), []);

  return (
    <section className="users-card">
      <header className="users-card-head">
        <h2>Services</h2>
        <button type="button" className="users-add" onClick={() => setPanel({ kind: "create" })}>
          <AdminIcon name="plus" />
          New service
        </button>
      </header>
      {services.length === 0 ? (
        <p className="users-empty">No consultation services match these filters. Add a service to open it for booking.</p>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table services-table">
            <caption className="sr-only">Consultation services</caption>
            <colgroup>
              <col className="services-col-name" />
              <col className="services-col-mode" />
              <col className="services-col-time" />
              <col className="services-col-fee" />
              <col className="services-col-status" />
              <col className="services-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Service</th>
                <th>Mode</th>
                <th>Length</th>
                <th>Fee</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id}>
                  <td data-label="Service">
                    <span className="users-cell">
                      <button type="button" className="users-email" onClick={() => setPanel({ kind: "view", service })}>
                        {service.name}
                      </button>
                      <span className="users-sub">{service.slug}</span>
                      <span className="users-sub">{usageLabel(service)}</span>
                    </span>
                  </td>
                  <td data-label="Mode">
                    <span className="users-cell">{modeLabel(service.mode)}</span>
                  </td>
                  <td data-label="Length">
                    <span className="users-cell">{service.durationMinutes} min</span>
                  </td>
                  <td data-label="Fee">
                    <span className="users-cell">
                      {service.defaultFee} {service.currency}
                      <span className="users-sub">Set on Fees and pricing</span>
                    </span>
                  </td>
                  <td data-label="Status">
                    <span className="users-cell">
                      <StatusBadge tone={service.isActive ? "teal" : "slate"}>{service.isActive ? "Active" : "Inactive"}</StatusBadge>
                    </span>
                  </td>
                  <td data-label="Actions">
                    <span className="users-cell">
                      <div className="user-actions">
                        <button type="button" className="user-icon-btn" aria-label={`View ${service.name}`} onClick={() => setPanel({ kind: "view", service })}>
                          <AdminIcon name="view" />
                        </button>
                        <button type="button" className="user-icon-btn" aria-label={`Edit ${service.name}`} onClick={() => setPanel({ kind: "edit", service })}>
                          <AdminIcon name="edit" />
                        </button>
                        <button type="button" className="user-icon-btn user-icon-btn-danger" aria-label={`Delete ${service.name}`} onClick={() => setPanel({ kind: "delete", service })}>
                          <AdminIcon name="trash" />
                        </button>
                      </div>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {panel?.kind === "create" ? <CreateDialog currency={currency} onClose={close} /> : null}
      {panel?.kind === "view" ? (
        <ViewDialog service={panel.service} onClose={close} onEdit={(service) => setPanel({ kind: "edit", service })} onDelete={(service) => setPanel({ kind: "delete", service })} />
      ) : null}
      {panel?.kind === "edit" ? <EditDialog service={panel.service} onClose={close} /> : null}
      {panel?.kind === "delete" ? <DeleteDialog service={panel.service} onClose={close} onEdit={(service) => setPanel({ kind: "edit", service })} /> : null}
    </section>
  );
}

function ModeField({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label>
      Consultation mode
      <select name="mode" defaultValue={defaultValue ?? "ANY"}>
        <option value="ANY">Online or in person</option>
        <option value="ONLINE">Online</option>
        <option value="IN_PERSON">In person</option>
      </select>
    </label>
  );
}

function FormMessage({ state }: { state: ServiceActionState }) {
  if (!state.message) return null;
  return (
    <p className={state.tone === "error" ? "user-form-error" : "user-form-ok"} role={state.tone === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}

function CreateDialog({ currency, onClose }: { currency: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(createServiceAction, initial);
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);
  return (
    <Modal title="New consultation service" onClose={onClose}>
      <form action={action} className="user-form">
        <div className="service-fields service-fields-2">
          <label>
            Name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Slug
            <input name="slug" required maxLength={80} placeholder="online-consultation" />
          </label>
        </div>
        <label>
          Description
          <textarea name="description" />
        </label>
        <div className="service-fields service-fields-2">
          <ModeField />
          <label>
            Duration (minutes)
            <input name="durationMinutes" required inputMode="numeric" placeholder="45" />
          </label>
        </div>
        <p className="user-form-note">This service starts at 0.00 {currency}. Set its fee on Fees and pricing. That amount is the price patients see.</p>
        <label>
          Preparation instructions
          <textarea name="preparationInstructions" />
        </label>
        <FormMessage state={state} />
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="users-add" disabled={pending}>
            {pending ? "Saving…" : "Create service"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ViewDialog({
  service,
  onClose,
  onEdit,
  onDelete,
}: {
  service: ServiceRecord;
  onClose: () => void;
  onEdit: (service: ServiceRecord) => void;
  onDelete: (service: ServiceRecord) => void;
}) {
  return (
    <Modal title="Service details" onClose={onClose}>
      <div className="user-view">
        <div>
          <p className="user-view-email">{service.name}</p>
          <p className="user-view-role">
            {service.code} · {service.slug}
          </p>
        </div>
        <dl className="user-view-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge tone={service.isActive ? "teal" : "slate"}>{service.isActive ? "Active" : "Inactive"}</StatusBadge>
            </dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{modeLabel(service.mode)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{service.durationMinutes} minutes</dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>
              {service.defaultFee} {service.currency}
              <span className="users-sub">Set on Fees and pricing</span>
            </dd>
          </div>
          <div>
            <dt>Usage</dt>
            <dd>{usageLabel(service)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{service.updatedLabel}</dd>
          </div>
        </dl>
        <section className="user-view-section">
          <h3>Description</h3>
          <p className="user-form-note">{service.description || "No description is saved."}</p>
        </section>
        <section className="user-view-section">
          <h3>Preparation</h3>
          <p className="user-form-note">{service.preparationInstructions || "No preparation instructions are saved."}</p>
        </section>
        <p className="user-form-note">Created {service.createdLabel}.</p>
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Close
          </button>
          <button type="button" className="users-cancel" onClick={() => onDelete(service)}>
            Delete
          </button>
          <button type="button" className="users-add" onClick={() => onEdit(service)}>
            Edit service
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditDialog({ service, onClose }: { service: ServiceRecord; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateServiceAction, initial);
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);
  return (
    <Modal title={`Edit ${service.name}`} onClose={onClose}>
      <form action={action} className="user-form">
        <input type="hidden" name="id" value={service.id} />
        <label>
          Name
          <input name="name" required defaultValue={service.name} />
        </label>
        <label>
          Description
          <textarea name="description" defaultValue={service.description ?? ""} />
        </label>
        <div className="service-fields service-fields-2">
          <ModeField defaultValue={service.mode ?? "ANY"} />
          <label>
            Duration (minutes)
            <input name="durationMinutes" required defaultValue={service.durationMinutes} inputMode="numeric" />
          </label>
        </div>
        <p className="user-form-note">
          Fee: {service.defaultFee} {service.currency}. Change it on Fees and pricing.
        </p>
        <label>
          Preparation instructions
          <textarea name="preparationInstructions" defaultValue={service.preparationInstructions ?? ""} />
        </label>
        <label className="service-check">
          <input name="isActive" type="checkbox" defaultChecked={service.isActive} />
          Active for new offerings and appointments
        </label>
        <FormMessage state={state} />
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="users-add" disabled={pending}>
            {pending ? "Saving…" : "Save service"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ service, onClose, onEdit }: { service: ServiceRecord; onClose: () => void; onEdit: (service: ServiceRecord) => void }) {
  const [state, action, pending] = useActionState(deleteServiceAction, initial);
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);
  return (
    <Modal title="Delete service" onClose={onClose}>
      <form action={action} className="user-form">
        <input type="hidden" name="id" value={service.id} />
        <p className="user-form-note">
          {service.referenced
            ? `${service.name} is already used (${usageLabel(service)}). Deactivate it so existing appointments stay unchanged.`
            : `Delete ${service.name}? This removes the service from the catalog.`}
        </p>
        <FormMessage state={state} />
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Cancel
          </button>
          {service.referenced ? (
            <button type="button" className="users-add" onClick={() => onEdit(service)}>
              Edit service
            </button>
          ) : (
            <button type="submit" className="users-delete" disabled={pending}>
              {pending ? "Deleting…" : "Delete service"}
            </button>
          )}
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
    <div className="user-modal-backdrop service-sheet" role="presentation" onMouseDown={onClose}>
      <div className="user-modal user-modal-wide" role="dialog" aria-modal="true" aria-labelledby="service-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="user-modal-head">
          <h2 id="service-dialog-title">{title}</h2>
          <button type="button" className="user-icon-btn" aria-label="Close" onClick={onClose}>
            <AdminIcon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
