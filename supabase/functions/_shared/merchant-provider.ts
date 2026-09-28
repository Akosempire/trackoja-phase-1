// Provider-neutral contract for merchant payments. Platform subscription billing
// is deliberately outside this module.
export interface MerchantPaymentStatus {
  merchantReference: string;
  terminalSerial: string;
  requestAmount: number;
  actualAmount: number | null;
  transactionReference: string | null;
  processingStatus: string;
  responseCode: string | null;
  actualPaymentMethod: string | null;
}

export interface MerchantPaymentProvider {
  readonly name: string;
  initializePayment(request: {
    merchantReference: string;
    terminalSerial: string;
    amount: number;
    paymentMethod: 'CARD_PURCHASE' | 'POS_TRANSFER' | 'ANY';
  }): Promise<'accepted'>;
  getPaymentStatus(merchantReference: string): Promise<MerchantPaymentStatus>;
  // The Moniepoint Push API documents no cancel or refund endpoint. Add these
  // capabilities only when a provider's own API actually supports them.
}

export function providerAmount(naira: number, unit: string | undefined): number {
  if (!Number.isFinite(naira) || naira <= 0) throw new Error('Invalid payment amount');
  if (unit !== 'naira' && unit !== 'kobo') {
    throw new Error('Moniepoint amount unit has not been confirmed by the provider');
  }
  const value = unit === 'kobo' ? Math.round(naira * 100) : naira;
  if (!Number.isSafeInteger(value) || value <= 0 || (unit === 'naira' && naira !== value)) {
    throw new Error('The amount cannot be represented in the confirmed Moniepoint unit');
  }
  return value;
}

export function approvalForStatus(
  status: MerchantPaymentStatus,
  approvedCodes: string | undefined,
  declinedCodes?: string,
): boolean | null {
  if (status.processingStatus !== 'PROCESSED') return null;
  const codes = (approvedCodes ?? '').split(',').map((code) => code.trim()).filter(Boolean);
  if (codes.length === 0 || !status.responseCode) return null;
  if (codes.includes(status.responseCode)) return true;
  const declines = (declinedCodes ?? '').split(',').map((code) => code.trim()).filter(Boolean);
  return declines.includes(status.responseCode) ? false : null;
}

export function parseMoniepointStatus(value: unknown): MerchantPaymentStatus {
  if (!value || typeof value !== 'object') throw new Error('Invalid provider status response');
  const row = value as Record<string, unknown>;
  const requestAmount = Number(row.requestAmount);
  const actualAmount = row.actualAmount == null ? null : Number(row.actualAmount);
  if (typeof row.merchantReference !== 'string' || typeof row.terminalSerial !== 'string'
      || !Number.isSafeInteger(requestAmount) || requestAmount <= 0
      || (actualAmount !== null && (!Number.isSafeInteger(actualAmount) || actualAmount < 0))
      || typeof row.processingStatus !== 'string') {
    throw new Error('Provider status response is incomplete');
  }
  return {
    merchantReference: row.merchantReference,
    terminalSerial: row.terminalSerial,
    requestAmount,
    actualAmount,
    transactionReference: typeof row.transactionReference === 'string' ? row.transactionReference : null,
    processingStatus: row.processingStatus,
    responseCode: typeof row.responseCode === 'string' ? row.responseCode : null,
    actualPaymentMethod: typeof row.actualPaymentMethod === 'string' ? row.actualPaymentMethod : null,
  };
}
