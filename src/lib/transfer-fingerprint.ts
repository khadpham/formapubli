import { hashString } from './export-hash';

/**
 * Deterministic JSON stringify with sorted keys at all levels.
 */
export function canonicalJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

export function canonicalHash(payload: unknown): string {
  return hashString(canonicalJson(payload));
}

export interface DispatchFingerprintInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  dispatcherId: string;
  items: Array<{ editionId: string; quantity: number }>;
}

export function computeTransferDispatchFingerprint(params: DispatchFingerprintInput): string {
  const sortedItems = [...params.items]
    .map(i => ({ editionId: i.editionId.trim(), quantity: i.quantity }))
    .sort((a, b) => a.editionId.localeCompare(b.editionId));

  return canonicalHash({
    dispatcherId: params.dispatcherId.trim(),
    fromWarehouseId: params.fromWarehouseId.trim(),
    items: sortedItems,
    toWarehouseId: params.toWarehouseId.trim(),
  });
}

export interface ReceiveFingerprintInput {
  shipmentId: string;
  receiverId: string;
  items: Array<{ editionId: string; receivedQty: number; damagedQty: number; lostQty: number }>;
}

export function computeTransferReceiveFingerprint(params: ReceiveFingerprintInput): string {
  const sortedItems = [...params.items]
    .map(i => ({
      damagedQty: i.damagedQty ?? 0,
      editionId: i.editionId.trim(),
      lostQty: i.lostQty ?? 0,
      receivedQty: i.receivedQty ?? 0,
    }))
    .sort((a, b) => a.editionId.localeCompare(b.editionId));

  return canonicalHash({
    items: sortedItems,
    receiverId: params.receiverId.trim(),
    shipmentId: params.shipmentId.trim(),
  });
}

export interface CancelFingerprintInput {
  shipmentId: string;
  actorId: string;
}

export function computeTransferCancelFingerprint(params: CancelFingerprintInput): string {
  return canonicalHash({
    actorId: params.actorId.trim(),
    shipmentId: params.shipmentId.trim(),
  });
}

export interface DirectTransferFingerprintInput {
  editionId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  documentRef: string;
}

export function computeDirectTransferFingerprint(params: DirectTransferFingerprintInput): string {
  return canonicalHash({
    documentRef: params.documentRef.trim(),
    editionId: params.editionId.trim(),
    fromWarehouseId: params.fromWarehouseId.trim(),
    quantity: params.quantity,
    toWarehouseId: params.toWarehouseId.trim(),
  });
}
