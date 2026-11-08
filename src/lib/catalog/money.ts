import { Prisma } from "@prisma/client";
import { DEFAULT_CURRENCY_CODE } from "./constants";

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Parse a major-unit amount. Rejects blank, negative, and more than two decimal places. */
export function parseMoney(input: string): Prisma.Decimal | null {
  const trimmed = input.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    return null;
  }
  const value = new Prisma.Decimal(trimmed);
  if (value.isNegative()) {
    return null;
  }
  return value;
}

export function parseCurrency(input: string | null | undefined, fallback = DEFAULT_CURRENCY_CODE): string | null {
  const raw = (input ?? "").trim().toUpperCase();
  const currency = raw || fallback;
  if (!CURRENCY_PATTERN.test(currency)) {
    return null;
  }
  return currency;
}

/** Convert a 2-decimal major amount to minor units without binary floating point. */
export function decimalToMinorUnits(value: Prisma.Decimal): number | null {
  const minor = value.mul(100);
  if (minor.decimalPlaces() > 0 || minor.isNegative() || minor.gt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return minor.toNumber();
}

export function feeSnapshotFromMinor(
  minor: number,
  currencyInput?: string,
): { feeAmount: Prisma.Decimal; feeAmountMinor: number; currency: string } | null {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    return null;
  }
  const currency = parseCurrency(currencyInput);
  if (!currency) {
    return null;
  }
  return {
    feeAmount: new Prisma.Decimal(minor).div(100),
    feeAmountMinor: minor,
    currency,
  };
}

/** Bookings use the service fee set on Fees and pricing. */
export function visitCharge(input: {
  price: Prisma.Decimal;
  priceAmountMinor: number;
  currency: string;
  defaultFee?: Prisma.Decimal | string | null;
  defaultCurrency?: string | null;
}): { feeAmount: Prisma.Decimal; feeAmountMinor: number; currency: string } | null {
  const saved = snapshotAppointmentFee({
    offering: { price: input.price, priceAmountMinor: input.priceAmountMinor, currency: input.currency },
    fallbackMinor: 0,
  });
  if (input.defaultFee == null || input.defaultFee === "") return saved;
  let fee: Prisma.Decimal;
  try {
    fee = input.defaultFee instanceof Prisma.Decimal ? input.defaultFee : new Prisma.Decimal(input.defaultFee);
  } catch {
    return saved;
  }
  if (fee.isNegative()) return saved;
  const minor = decimalToMinorUnits(fee);
  const currency = parseCurrency(input.defaultCurrency ?? input.currency);
  if (minor === null || !currency) return saved;
  return { feeAmount: fee, feeAmountMinor: minor, currency };
}

export function snapshotAppointmentFee(input: {
  offering: { price: Prisma.Decimal; priceAmountMinor: number; currency: string } | null;
  fallbackMinor: number;
  fallbackCurrency?: string;
}): { feeAmount: Prisma.Decimal; feeAmountMinor: number; currency: string } | null {
  if (input.offering) {
    const currency = parseCurrency(input.offering.currency.trim());
    if (!currency) {
      return null;
    }
    if (!Number.isSafeInteger(input.offering.priceAmountMinor) || input.offering.priceAmountMinor < 0) {
      return null;
    }
    if (input.offering.price.isNegative()) {
      return null;
    }
    return {
      feeAmount: new Prisma.Decimal(input.offering.price),
      feeAmountMinor: input.offering.priceAmountMinor,
      currency,
    };
  }
  return feeSnapshotFromMinor(input.fallbackMinor, input.fallbackCurrency);
}

export function formatMoneyAmount(value: Prisma.Decimal | string): string {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return decimal.toFixed(2);
}

export function sameMoney(left: Prisma.Decimal | string, right: Prisma.Decimal | string): boolean {
  const a = left instanceof Prisma.Decimal ? left : new Prisma.Decimal(left);
  const b = right instanceof Prisma.Decimal ? right : new Prisma.Decimal(right);
  return a.equals(b);
}

export function formatFee(amount: Prisma.Decimal | string, currency: string): string {
  return `${formatMoneyAmount(amount)} ${currency.trim()}`;
}
