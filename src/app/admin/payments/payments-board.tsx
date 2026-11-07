"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminIcon } from "@/components/admin/admin-icons";
import { StatusBadge } from "@/components/status-badge";
import type { BadgeTone } from "@/lib/admin/labels";

export type PaymentRecord = {
  id: string;
  status: string;
  statusLabel: string;
  statusTone: BadgeTone;
  amount: string;
  providerCode: string;
  providerReference: string | null;
  hasReceipt: boolean;
  createdLabel: string;
  payer: string;
  patient: string;
  appointmentId: string;
};

function walletLabel(code: string) {
  if (code === "ORANGE_MONEY") return "Orange Money";
  if (code === "AFRIMONEY") return "Afrimoney";
  return code;
}

export function PaymentsBoard({ payments }: { payments: PaymentRecord[] }) {
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const close = useCallback(() => setPayment(null), []);
  return (
    <section className="users-card">
      <header className="users-card-head">
        <h2>Payments</h2>
      </header>
      {payments.length === 0 ? (
        <p className="users-empty">No payments match these filters.</p>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <caption className="sr-only">Payments</caption>
            <colgroup>
              <col className="pay-col-created" />
              <col className="pay-col-patient" />
              <col className="pay-col-amount" />
              <col className="pay-col-provider" />
              <col className="pay-col-status" />
              <col className="pay-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Created</th>
                <th>Patient</th>
                <th>Amount</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((row) => (
                <tr key={row.id}>
                  <td data-label="Created">
                    <span className="users-cell">
                      <Link className="users-email" href={`/admin/payments/${row.id}`}>
                        {row.createdLabel}
                      </Link>
                    </span>
                  </td>
                  <td data-label="Patient">
                    <span className="users-cell">
                      {row.patient}
                      <span className="users-sub">{row.payer}</span>
                    </span>
                  </td>
                  <td data-label="Amount">
                    <span className="users-cell">{row.amount}</span>
                  </td>
                  <td data-label="Provider">
                    <span className="users-cell">
                      {walletLabel(row.providerCode)}
                      <span className="users-sub">{row.providerReference ?? (row.hasReceipt ? "Screenshot" : "No reference")}</span>
                    </span>
                  </td>
                  <td data-label="Status">
                    <span className="users-cell">
                      <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
                    </span>
                  </td>
                  <td data-label="Actions">
                    <span className="users-cell">
                      <div className="user-actions">
                        <button type="button" className="user-icon-btn" aria-label={`View payment for ${row.patient}`} onClick={() => setPayment(row)}>
                          <AdminIcon name="view" />
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
      {payment ? <ViewDialog payment={payment} onClose={close} /> : null}
    </section>
  );
}

function ViewDialog({ payment, onClose }: { payment: PaymentRecord; onClose: () => void }) {
  return (
    <Modal title="Payment details" onClose={onClose}>
      <div className="user-view">
        <div>
          <p className="user-view-email">{payment.patient}</p>
          <p className="user-view-role">{payment.amount} · {walletLabel(payment.providerCode)}</p>
        </div>
        <dl className="user-view-grid">
          <div>
            <dt>Status</dt>
            <dd><StatusBadge tone={payment.statusTone}>{payment.statusLabel}</StatusBadge></dd>
          </div>
          <div>
            <dt>Transaction ID</dt>
            <dd>{payment.providerReference ?? (payment.hasReceipt ? "Not entered. Open the record to see the screenshot." : "None recorded")}</dd>
          </div>
          <div>
            <dt>Payer</dt>
            <dd>{payment.payer}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{payment.createdLabel}</dd>
          </div>
        </dl>
        <div className="user-form-actions">
          <button type="button" className="users-cancel" onClick={onClose}>Close</button>
          <Link className="users-add" href={`/admin/payments/${payment.id}`}>Open record</Link>
        </div>
      </div>
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
      <div className="user-modal user-modal-wide" role="dialog" aria-modal="true" aria-labelledby="payment-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="user-modal-head">
          <h2 id="payment-dialog-title">{title}</h2>
          <button type="button" className="user-icon-btn" aria-label="Close" onClick={onClose}>
            <AdminIcon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
