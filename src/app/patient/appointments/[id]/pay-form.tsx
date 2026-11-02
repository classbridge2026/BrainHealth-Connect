"use client";

import { useActionState, useEffect, useState } from "react";
import { refreshWalletPaymentAction, reportOrangeTransferAction, startWalletPaymentAction } from "./pay-actions";

const initial = { message: "", tone: undefined as "ok" | "error" | undefined, paymentUrl: undefined as string | undefined };

export function VisitPayment({
  appointmentId,
  fee,
  doctor,
  service,
  when,
  paid,
  canPay,
  pendingApproval,
  walletApi,
  orange,
  afrimoney,
  phone,
  dialNumber,
  code,
  dialHref,
  afriNumber,
  afriSteps,
  afriHref,
  waitingReference,
  waitingWallet,
}: {
  appointmentId: string;
  fee: string;
  doctor: string;
  service: string;
  when: string;
  paid: boolean;
  canPay: boolean;
  pendingApproval: boolean;
  walletApi: boolean;
  orange: boolean;
  afrimoney: boolean;
  phone: string;
  dialNumber: string | null;
  code: string | null;
  dialHref: string | null;
  afriNumber: string | null;
  afriSteps: string[] | null;
  afriHref: string;
  waitingReference: string | null;
  waitingWallet: string | null;
}) {
  const [started, start, starting] = useActionState(startWalletPaymentAction, initial);
  const [checked, refresh, checking] = useActionState(refreshWalletPaymentAction, initial);
  const [reported, report, reporting] = useActionState(reportOrangeTransferAction, initial);
  const [copied, setCopied] = useState(false);
  const [method, setMethod] = useState<"orange" | "afri">(dialNumber ? "orange" : "afri");

  useEffect(() => {
    if (started.paymentUrl) window.location.assign(started.paymentUrl);
  }, [started.paymentUrl]);

  return (
    <div className={`pay-card${paid ? " pay-card-paid" : ""}`}>
      <header className="pay-head">
        <div>
          <p className="pay-kicker">{paid ? "Receipt" : "Checkout"}</p>
          <h2>{paid ? "Payment received" : "Pay for this visit"}</h2>
        </div>
        <p className="pay-amount">{fee}</p>
      </header>
      <dl className="pay-summary">
        <div>
          <dt>Doctor</dt>
          <dd>{doctor}</dd>
        </div>
        <div>
          <dt>Visit</dt>
          <dd>{service}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{when}</dd>
        </div>
      </dl>

      {paid ? (
        <p className="pay-note" role="status">This fee is paid. The consultation can open when the visit time arrives.</p>
      ) : pendingApproval ? (
        <p className="pay-note">This booking is waiting for the doctor to approve or decline it.</p>
      ) : waitingReference ? (
        <div className="pay-wait" role="status">
          <p className="pay-wait-title">Waiting for confirmation</p>
          <p>{waitingWallet ?? "Orange Money"} transaction <strong>{waitingReference}</strong> is with the clinic. The consultation opens after it is confirmed.</p>
        </div>
      ) : !canPay ? (
        <p className="pay-note">The clinic has not collected this fee yet.</p>
      ) : walletApi ? (
        <form action={start} className="pay-form">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <fieldset className="pay-methods">
            <legend>Payment method</legend>
            {orange ? (
              <label className="pay-method">
                <input type="radio" name="provider" value="ORANGE_MONEY" required defaultChecked />
                <span className="pay-mark pay-mark-orange">OM</span>
                <span>
                  <strong>Orange Money</strong>
                  <small>Pay from your Orange Money wallet</small>
                </span>
              </label>
            ) : null}
            {afrimoney ? (
              <label className="pay-method">
                <input type="radio" name="provider" value="AFRIMONEY" required defaultChecked={!orange} />
                <span className="pay-mark pay-mark-afri">AM</span>
                <span>
                  <strong>Afrimoney</strong>
                  <small>Approve the prompt on your phone</small>
                </span>
              </label>
            ) : null}
          </fieldset>
          <label className="pay-field">
            Wallet number
            <input name="phone" required defaultValue={phone} inputMode="tel" autoComplete="tel" placeholder="07X XXX XXX" />
          </label>
          <button className="pay-submit" disabled={starting} type="submit">
            {starting ? "Contacting the wallet…" : `Pay ${fee}`}
          </button>
          {started.message ? <p className={started.tone === "error" ? "pay-alert" : "pay-note"} role={started.tone === "error" ? "alert" : "status"}>{started.message}</p> : null}
          <p className="pay-secure">Your PIN stays on your phone. CareCircle never asks for it.</p>
        </form>
      ) : (
        <div className="pay-form">
          <div className="pay-methods" role="group" aria-label="Payment method">
            <button className={`pay-method pay-method-chosen${method === "orange" ? " pay-method-on" : ""}`} type="button" aria-pressed={method === "orange"} onClick={() => { setMethod("orange"); setCopied(false); }}>
              <span className="pay-mark pay-mark-orange">OM</span>
              <span>
                <strong>Orange Money</strong>
                <small>Dial the Orange code</small>
              </span>
            </button>
            <button className={`pay-method pay-method-chosen${method === "afri" ? " pay-method-on" : ""}`} type="button" aria-pressed={method === "afri"} onClick={() => { setMethod("afri"); setCopied(false); }}>
              <span className="pay-mark pay-mark-afri">AM</span>
              <span>
                <strong>Afrimoney</strong>
                <small>Pay from *161#</small>
              </span>
            </button>
          </div>
          {method === "orange" ? (
            !dialNumber || !code || !dialHref ? (
              <p className="pay-note">The clinic has not saved an Orange Money number yet. Payment opens here after an administrator adds it.</p>
            ) : (
              <>
                <div className="pay-to">
                  <span>Send to</span>
                  <strong>{dialNumber}</strong>
                </div>
                <div className="pay-code-block">
                  <span>Dial this code</span>
                  <code>{code}</code>
                  <p>Replace PIN with your Orange Money PIN on the phone only.</p>
                </div>
                <div className="pay-actions">
                  <a className="pay-submit" href={dialHref}>Open phone dialer</a>
                  <button className="pay-secondary" type="button" onClick={() => { void navigator.clipboard.writeText(code).then(() => setCopied(true)).catch(() => setCopied(false)); }}>
                    {copied ? "Code copied" : "Copy code"}
                  </button>
                </div>
              </>
            )
          ) : !afriNumber || !afriSteps ? (
            <p className="pay-note">The clinic has not saved an Afrimoney number yet. Payment opens here after an administrator adds it.</p>
          ) : (
            <>
              <div className="pay-to">
                <span>Send to</span>
                <strong>{afriNumber}</strong>
              </div>
              <ol className="pay-steps">
                {afriSteps.map((step, index) => (
                  <li key={step}>
                    <b>{index + 1}</b>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="pay-secure">Your PIN stays on your phone. CareCircle never asks for it.</p>
              <div className="pay-actions">
                <a className="pay-submit" href={afriHref}>Open *161#</a>
                <button className="pay-secondary" type="button" onClick={() => { void navigator.clipboard.writeText(afriSteps.join("\n")).then(() => setCopied(true)).catch(() => setCopied(false)); }}>
                  {copied ? "Steps copied" : "Copy steps"}
                </button>
              </div>
            </>
          )}
          {(method === "orange" ? dialNumber && code && dialHref : afriNumber && afriSteps) ? (
            <form action={report} className="pay-confirm">
              <input type="hidden" name="appointmentId" value={appointmentId} />
              <input type="hidden" name="provider" value={method === "afri" ? "AFRIMONEY" : "ORANGE_MONEY"} />
              <label className="pay-field">
                {method === "afri" ? "Transaction code" : "Transaction ID"}
                <input
                  name="reference"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                  placeholder={method === "afri" ? "From the Afrimoney SMS" : "PP250502.1502.B91020"}
                />
              </label>
              {method === "orange" ? (
                <>
                  <p className="pay-note">Use the transaction ID from the Orange Money SMS or receipt. It looks like PP250502.1502.B91020.</p>
                  <label className="pay-field">
                    Screenshot of the transaction details
                    <input name="receipt" type="file" accept="image/jpeg,image/png,image/webp" required />
                  </label>
                </>
              ) : null}
              <button className="pay-submit" disabled={reporting} type="submit">
                {reporting ? "Submitting…" : "Confirm payment"}
              </button>
              {reported.message ? <p className={reported.tone === "error" ? "pay-alert" : "pay-note"} role={reported.tone === "error" ? "alert" : "status"}>{reported.message}</p> : null}
            </form>
          ) : null}
        </div>
      )}

      {walletApi && canPay && !paid && !waitingReference ? (
        <form action={refresh} className="pay-check">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <button disabled={checking} type="submit">{checking ? "Checking…" : "I have paid — check now"}</button>
          {checked.message ? <p role={checked.tone === "error" ? "alert" : "status"}>{checked.message}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
