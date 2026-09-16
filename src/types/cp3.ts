import { ActorContext } from '@/services/actor-context';

// ---------------------------------------------------------
// 1. Transfer Types & Interfaces (SSOT: docs/CP3_EXECUTION_PLAN.md)
// ---------------------------------------------------------

export type TransferShipmentStatus =
  | 'IN_TRANSIT'
  | 'RECEIVED_FULL'
  | 'RECEIVED_DISCREPANCY'
  | 'CANCELLED';

export type TransferActionType = 'RECEIVE' | 'CANCEL';

export interface DispatchItemInput {
  editionId: string;
  quantity: number;
  notes?: string;
}

export interface DispatchParams {
  fromWarehouseId: string;
  toWarehouseId: string;
  dispatcherId?: string;
  vehicleInfo?: string;
  notes?: string;
  idempotencyKey: string;
  actorContext: ActorContext;
  items: DispatchItemInput[];
}

export interface ReceiveItemInput {
  editionId: string;
  receivedQty: number;
  damagedQty?: number;
  lostQty?: number;
  notes?: string;
}

export interface ReceiveParams {
  shipmentId: string;
  receiverId?: string;
  notes?: string;
  idempotencyKey: string;
  actorContext: ActorContext;
  items: ReceiveItemInput[];
}

export interface CancelParams {
  shipmentId: string;
  actorId?: string;
  notes?: string;
  idempotencyKey: string;
  actorContext: ActorContext;
}

export interface DirectTransferParams {
  editionId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  documentRef: string;
  note?: string;
  idempotencyKey: string;
  actorContext: ActorContext;
}

// ---------------------------------------------------------
// 2. Return & Exchange Types & Interfaces
// ---------------------------------------------------------

export type ReturnType = 'REFUND' | 'EXCHANGE' | 'DAMAGED_REPLACE';
export type ReturnReason =
  | 'PRINTING_DEFECT'
  | 'WRONG_ITEM'
  | 'CUSTOMER_CHANGE_MIND'
  | 'DAMAGED_SHIPPING';
export type ReturnDisposition = 'RESTOCK' | 'DEFECTIVE_HOLD';
export type ReturnStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'VOIDED';

export type ReturnActionType = 'APPROVE' | 'REJECT' | 'COMPLETE' | 'VOID';

export interface ReturnItemInput {
  editionId: string;
  quantity: number;
  orderItemId?: string; // Tùy chọn cho dữ liệu cũ, bắt buộc cho request CP3 mới
  unitRefund?: number;
}

export interface ExchangeReplacementItemInput {
  editionId: string;
  quantity: number;
  unitPrice?: number; // Integer VND snapshot
}

export interface CreateReturnParams {
  id?: string;
  returnCode?: string;
  orderId: string;
  returnType: ReturnType;
  reason: ReturnReason;
  targetWarehouseId: string;
  inventoryDisposition: ReturnDisposition;
  refundAmount?: number;
  cashboxSessionId?: string;
  createdBy?: string;
  actorRole?: string;
  idempotencyKey: string;
  note?: string;
  bypassWindow?: boolean;
  actorContext: ActorContext;
  items: ReturnItemInput[];
}

export interface ApproveReturnParams {
  returnId: string;
  idempotencyKey: string;
  actorContext: ActorContext;
  notes?: string;
}

export interface RejectReturnParams {
  returnId: string;
  idempotencyKey: string;
  actorContext: ActorContext;
  rejectNote?: string;
}

export interface CompleteReturnParams {
  returnId: string;
  idempotencyKey: string;
  actorContext: ActorContext;
  exchangeItems?: ExchangeReplacementItemInput[];
  notes?: string;
}

export interface VoidReturnParams {
  returnId: string;
  idempotencyKey: string;
  actorContext: ActorContext;
  voidReason: string;
}
