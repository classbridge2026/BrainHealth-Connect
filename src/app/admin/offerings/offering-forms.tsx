"use client";

import { Fragment, useActionState, useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminIcon } from "@/components/admin/admin-icons";
import { StatusBadge, verificationBadge } from "@/components/status-badge";
import { createOfferingAction, deleteOfferingAction, updateOfferingAction, type OfferingActionState } from "./actions";
import type { SelfDoctorOption } from "@/lib/catalog/self-doctor";

const initial: OfferingActionState = {};

type ServiceOption = {
  id: string;
  name: string;
  mode: "ONLINE" | "IN_PERSON" | null;
  durationMinutes: number;
  defaultFee: string;
  currency: string;
};

type DoctorOption = {
  id: string;
  fullName: string;
  specialties: Array<{ id: string; name: string }>;
};

export type OfferingRecord = {
  id: string;
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  serviceName: string;
  serviceMode: "ONLINE" | "IN_PERSON" | null;
  defaultFee: string;
  serviceCurrency: string;
  sameAsDefault: boolean;
  mode: "ONLINE" | "IN_PERSON";
  durationMinutes: number;
  fee: string;
  currency: string;
  notes: string | null;
  isActive: boolean;
  referenced: boolean;
  appointmentCount: number;
  ruleCount: number;
  verificationStatus: string;
  createdLabel: string;
  updatedLabel: string;
};

type Panel =
  | { kind: "create" }
  | { kind: "view"; offering: OfferingRecord }
  | { kind: "edit"; offering: OfferingRecord }
  | { kind: "delete"; offering: OfferingRecord }
  | null;

function modeLabel(mode: "ONLINE" | "IN_PERSON" | null) {
  if (mode === "ONLINE") return "Online";
  if (mode === "IN_PERSON") return "In person";
  return "Either";
}

function offeringsByDoctor(offerings: OfferingRecord[]) {
  const groups: Array<{ doctorId: string; doctorName: string; verificationStatus: string; offerings: OfferingRecord[] }> = [];
  for (const offering of offerings) {
    const current = groups[groups.length - 1];
    if (current?.doctorId === offering.doctorId) current.offerings.push(offering);
    else groups.push({ doctorId: offering.doctorId, doctorName: offering.doctorName, verificationStatus: offering.verificationStatus, offerings: [offering] });
  }
  return groups;
}

function usageLabel(offering: OfferingRecord) {
  if (!offering.referenced) return "Not used yet";
  const appointments = `${offering.appointmentCount} appointment${offering.appointmentCount === 1 ? "" : "s"}`;
  const rules = `${offering.ruleCount} availability rule${offering.ruleCount === 1 ? "" : "s"}`;
  return `${appointments} · ${rules}`;
}

export function OfferingsBoard({
  offerings,
  doctors,
  services,
  specialties,
  self,
  selfRole,
  currency,
}: {
  offerings: OfferingRecord[];
  doctors: DoctorOption[];
  services: ServiceOption[];
  specialties: Array<{ id: string; name: string }>;
  self: SelfDoctorOption;
  selfRole: string;
  currency: string;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const close = useCallback(() => setPanel(null), []);
  const ready = services.length > 0 && (doctors.length > 0 || !self.blocked);
  const groups = offeringsByDoctor(offerings);
  const viewed = panel && panel.kind !== "create" ? offerings.filter((item) => item.doctorId === panel.offering.doctorId) : [];

  return (
    <section className="users-card">
      <header className="users-card-head">
        <h2>Offerings</h2>
        <button type="button" className="users-add" onClick={() => setPanel({ kind: "create" })}>
          <AdminIcon name="plus" />
          Assign service
        </button>
      </header>
      <p className="fee-schedule-note">Each doctor’s offerings are listed together. Edit an offering to change the visit, fee, or duration.</p>
      {offerings.length === 0 ? (
        <p className="users-empty">No offerings match these filters. Assign a service to an approved doctor to open it for booking.</p>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table offerings-table">
            <caption className="sr-only">Doctor offerings</caption>
            <colgroup>
              <col className="offerings-col-doctor" />
              <col className="offerings-col-service" />
              <col className="offerings-col-mode" />
              <col className="offerings-col-fee" />
              <col className="offerings-col-status" />
              <col className="offerings-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Doctor</th>
                <th>Offering</th>
                <th>Visit</th>
                <th>Doctor fee</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const verification = verificationBadge(group.verificationStatus);
                return (
                  <Fragment key={group.doctorId}>
                    <tr className="offering-doctor-row">
                      <td colSpan={6} data-label="Doctor">
                        <span className="users-cell">
                          <button type="button" className="users-email" onClick={() => setPanel({ kind: "view", offering: group.offerings[0] })}>
                            {group.doctorName}
                          </button>
                          <span className="users-sub">
                            {verification.label} · {group.offerings.length} offering{group.offerings.length === 1 ? "" : "s"}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {group.offerings.map((offering) => (
                      <tr key={offering.id}>
                        <td data-label="Specialty">
                          <span className="users-cell users-sub">{offering.specialtyName}</span>
                        </td>
                        <td data-label="Offering">
                          <span className="users-cell">
                            <button type="button" className="users-email" onClick={() => setPanel({ kind: "edit", offering })}>
                              {offering.serviceName}
                            </button>
                            <span className="users-sub">{usageLabel(offering)}</span>
                          </span>
                        </td>
                        <td data-label="Visit">
                          <span className="users-cell">
                            {modeLabel(offering.mode)}
                            <span className="users-sub">{offering.durationMinutes} min</span>
                          </span>
                        </td>
                        <td data-label="Doctor fee">
                          <span className="users-cell">
                            {offering.fee} {offering.currency}
                            <span className="users-sub">
                              {offering.sameAsDefault ? "Same as the default fee" : `Default ${offering.defaultFee} ${offering.serviceCurrency}`}
                            </span>
                          </span>
                        </td>
                        <td data-label="Status">
                          <span className="users-cell">
                            <StatusBadge tone={offering.isActive ? "teal" : "slate"}>{offering.isActive ? "Active" : "Inactive"}</StatusBadge>
                          </span>
                        </td>
                        <td data-label="Actions">
                          <span className="users-cell">
                            <div className="user-actions">
                              <button type="button" className="offering-edit" onClick={() => setPanel({ kind: "edit", offering })}>
                                Edit
                              </button>
                              <button type="button" className="user-icon-btn user-icon-btn-danger" aria-label={`Delete ${offering.doctorName} ${offering.serviceName}`} onClick={() => setPanel({ kind: "delete", offering })}>
                                <AdminIcon name="trash" />
                              </button>
                            </div>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {panel?.kind === "create" ? (
        <CreateDialog doctors={doctors} services={services} specialties={specialties} self={self} selfRole={selfRole} currency={currency} ready={ready} onClose={close} />
      ) : null}
      {panel?.kind === "view" ? (
        <ViewDialog
          doctorName={panel.offering.doctorName}
          offerings={viewed}
          onClose={close}
          onEdit={(offering) => setPanel({ kind: "edit", offering })}
          onDelete={(offering) => setPanel({ kind: "delete", offering })}
        />
      ) : null}
      {panel?.kind === "edit" ? <EditDialog offering={panel.offering} onClose={close} /> : null}
      {panel?.kind === "delete" ? <DeleteDialog offering={panel.offering} onClose={close} onEdit={(offering) => setPanel({ kind: "edit", offering })} /> : null}
    </section>
  );
}

function FormMessage({ state }: { state: OfferingActionState }) {
  if (!state.message) return null;
  return (
    <p className={state.tone === "error" ? "user-form-error" : "user-form-ok"} role={state.tone === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}

function CreateDialog({
  doctors,
  services,
  specialties,
  self,
  selfRole,
  currency,
  ready,
  onClose,
}: {
  doctors: DoctorOption[];
  services: ServiceOption[];
  specialties: Array<{ id: string; name: string }>;
  self: SelfDoctorOption;
  selfRole: string;
  currency: string;
  ready: boolean;
  onClose: () => void;
}) {
  const youId = self.profileId ?? "self";
  const youLabel = self.fullName ? `${self.fullName} (you)` : `${selfRole} (you)`;
  const choices: DoctorOption[] = self.blocked
    ? doctors
    : [{ id: youId, fullName: youLabel, specialties }, ...doctors.filter((item) => item.id !== self.profileId)];
  const [state, action, pending] = useActionState(createOfferingAction, initial);
  const [doctorId, setDoctorId] = useState(choices[0]?.id ?? "");
  const doctor = choices.find((item) => item.id === doctorId) ?? choices[0];
  const assigningYou = !self.blocked && doctorId === youId;
  const [specialtyId, setSpecialtyId] = useState((assigningYou ? specialties[0]?.id : doctor?.specialties[0]?.id) ?? "");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const service = services.find((item) => item.id === serviceId) ?? services[0];
  const [mode, setMode] = useState<"ONLINE" | "IN_PERSON">(service?.mode ?? "ONLINE");
  const [duration, setDuration] = useState(service ? String(service.durationMinutes) : "");
  const [fee, setFee] = useState("");
  const [currencyCode, setCurrencyCode] = useState(service?.currency || currency);
  const [fullName, setFullName] = useState(self.fullName);
  const specialtyChoices = assigningYou ? specialties : (doctor?.specialties ?? []);
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);

  return (
    <Modal title="Assign a service" onClose={onClose}>
      {ready ? (
        <form action={action} className="user-form">
          <p className="user-form-note">
            {assigningYou
              ? "Patients will book this service with you. Publish weekly hours on Availability so they can choose a time."
              : "Only an approved, active doctor with a verified specialty can receive an active offering. Suspended, rejected, and unverified doctors are not listed."}
          </p>
          {self.blocked ? <p className="user-form-note">{self.blocked}</p> : null}
          {assigningYou ? <input type="hidden" name="selfAssign" value="on" /> : null}
          <div className="service-fields service-fields-2">
            <label>
              Doctor
              <select
                name={assigningYou ? undefined : "doctorProfileId"}
                value={doctorId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const next = choices.find((item) => item.id === nextId);
                  const yours = !self.blocked && nextId === youId;
                  setDoctorId(nextId);
                  setSpecialtyId((yours ? specialties[0]?.id : next?.specialties[0]?.id) ?? "");
                }}
              >
                {choices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </select>
            </label>
            {assigningYou && !self.fullName ? (
              <label>
                Name patients will see
                <input name="fullName" required value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
              </label>
            ) : null}
            <label>
              Specialty
              <select name="specialtyId" value={specialtyId} onChange={(event) => setSpecialtyId(event.target.value)}>
                {specialtyChoices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Service
              <select
                name="consultationServiceId"
                value={service?.id ?? ""}
                onChange={(event) => {
                  const next = services.find((item) => item.id === event.target.value);
                  setServiceId(event.target.value);
                  if (next) {
                    setDuration(String(next.durationMinutes));
                    setCurrencyCode(next.currency);
                    if (next.mode) setMode(next.mode);
                  }
                }}
              >
                {services.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Visit
              {service?.mode ? <input type="hidden" name="mode" value={service.mode} /> : null}
              <select
                name={service?.mode ? undefined : "mode"}
                value={service?.mode ?? mode}
                disabled={Boolean(service?.mode)}
                onChange={(event) => setMode(event.target.value === "IN_PERSON" ? "IN_PERSON" : "ONLINE")}
              >
                <option value="ONLINE">Online</option>
                <option value="IN_PERSON">In person</option>
              </select>
            </label>
          </div>
          <div className="service-fields service-fields-3">
            <label>
              Duration (minutes)
              <input name="durationMinutes" required value={duration} onChange={(event) => setDuration(event.target.value)} inputMode="numeric" />
            </label>
            <label>
              Doctor fee
              <input name="fee" required value={fee} onChange={(event) => setFee(event.target.value)} inputMode="decimal" placeholder="0.00" />
            </label>
            <label>
              Currency
              <input name="currency" required maxLength={3} value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} />
            </label>
          </div>
          {service ? (
            <p className="user-form-note">
              Default service fee: {service.defaultFee} {service.currency}. The doctor fee is stored separately.{" "}
              <button className="services-clear" type="button" onClick={() => setFee(service.defaultFee)}>
                Use default fee
              </button>
            </p>
          ) : null}
          <label>
            Description or preparation notes
            <textarea name="notes" />
          </label>
          <label className="service-check">
            <input name="isActive" type="checkbox" defaultChecked />
            Active for new appointments
          </label>
          <FormMessage state={state} />
          <div className="user-form-actions">
            <button type="button" className="users-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="users-add" disabled={pending}>
              {pending ? "Saving…" : "Save offering"}
            </button>
          </div>
        </form>
      ) : (
        <div className="user-form">
          <p className="user-form-note">An offering can be added when there is an active service. An approved doctor can receive it, and you can assign it to your own account.</p>
          <div className="user-form-actions">
            <button type="button" className="users-cancel" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ViewDialog({
  doctorName,
  offerings,
  onClose,
  onEdit,
  onDelete,
}: {
  doctorName: string;
  offerings: OfferingRecord[];
  onClose: () => void;
  onEdit: (offering: OfferingRecord) => void;
  onDelete: (offering: OfferingRecord) => void;
}) {
  const verification = verificationBadge(offerings[0]?.verificationStatus ?? "");
  return (
    <Modal title={`${doctorName} offerings`} onClose={onClose}>
      <div className="user-view">
        <div>
          <p className="user-view-email">{doctorName}</p>
          <p className="user-view-role">
            <StatusBadge tone={verification.tone}>{verification.label}</StatusBadge>
          </p>
        </div>
        <ul className="offering-view-list">
          {offerings.map((offering) => (
            <li key={offering.id}>
              <div>
                <p className="fee-name">{offering.serviceName}</p>
                <p className="users-sub">
                  {offering.specialtyName} · {modeLabel(offering.mode)} · {offering.durationMinutes} min · {offering.fee} {offering.currency}
                </p>
                <p className="users-sub">{usageLabel(offering)}{offering.notes ? ` · ${offering.notes}` : ""}</p>
              </div>
              <div className="user-actions">
                <StatusBadge tone={offering.isActive ? "teal" : "slate"}>{offering.isActive ? "Active" : "Inactive"}</StatusBadge>
                <button type="button" className="offering-edit" onClick={() => onEdit(offering)}>
                  Edit
                </button>
                <button type="button" className="user-icon-btn user-icon-btn-danger" aria-label={`Delete ${offering.serviceName}`} onClick={() => onDelete(offering)}>
                  <AdminIcon name="trash" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditDialog({ offering, onClose }: { offering: OfferingRecord; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateOfferingAction, initial);
  const lockedMode = offering.serviceMode;
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);
  return (
    <Modal title={`Edit ${offering.serviceName}`} onClose={onClose}>
      <form action={action} className="user-form">
        <input type="hidden" name="id" value={offering.id} />
        <p className="user-form-note">
          {offering.doctorName} · {offering.specialtyName}. An active offering can be saved only while this doctor stays approved.
        </p>
        <div className="service-fields service-fields-2">
          <label>
            Visit
            {lockedMode ? <input type="hidden" name="mode" value={lockedMode} /> : null}
            <select name={lockedMode ? undefined : "mode"} defaultValue={lockedMode ?? offering.mode} disabled={Boolean(lockedMode)}>
              <option value="ONLINE">Online</option>
              <option value="IN_PERSON">In person</option>
            </select>
          </label>
          <label>
            Duration (minutes)
            <input name="durationMinutes" required defaultValue={offering.durationMinutes} inputMode="numeric" />
          </label>
          <label>
            Doctor fee
            <input name="fee" required defaultValue={offering.fee} inputMode="decimal" />
          </label>
          <label>
            Currency
            <input name="currency" required maxLength={3} defaultValue={offering.currency} />
          </label>
        </div>
        <label>
          Description or preparation notes
          <textarea name="notes" defaultValue={offering.notes ?? ""} />
        </label>
        <label className="service-check">
          <input name="isActive" type="checkbox" defaultChecked={offering.isActive} />
          Active for new appointments
        </label>
        <FormMessage state={state} />
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="users-add" disabled={pending}>
            {pending ? "Saving…" : "Save offering"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ offering, onClose, onEdit }: { offering: OfferingRecord; onClose: () => void; onEdit: (offering: OfferingRecord) => void }) {
  const [state, action, pending] = useActionState(deleteOfferingAction, initial);
  useEffect(() => {
    if (state.tone === "ok") onClose();
  }, [state, onClose]);
  return (
    <Modal title="Delete offering" onClose={onClose}>
      <form action={action} className="user-form">
        <input type="hidden" name="id" value={offering.id} />
        <p className="user-form-note">
          {offering.referenced
            ? `${offering.doctorName}’s ${offering.serviceName} offering is already used (${usageLabel(offering)}). Deactivate it so existing appointments stay unchanged.`
            : `Delete ${offering.doctorName}’s ${offering.serviceName} offering? Booked appointment fees are not affected because this offering is unused.`}
        </p>
        <FormMessage state={state} />
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>
            Cancel
          </button>
          {offering.referenced ? (
            <button type="button" className="users-add" onClick={() => onEdit(offering)}>
              Edit offering
            </button>
          ) : (
            <button type="submit" className="users-delete" disabled={pending}>
              {pending ? "Deleting…" : "Delete offering"}
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
      <div className="user-modal user-modal-wide" role="dialog" aria-modal="true" aria-labelledby="offering-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="user-modal-head">
          <h2 id="offering-dialog-title">{title}</h2>
          <button type="button" className="user-icon-btn" aria-label="Close" onClick={onClose}>
            <AdminIcon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
