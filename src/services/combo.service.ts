import { db } from '@/db';
import { comboComponents, products } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { InventoryService } from './inventory.service';

export interface ComboComponentInfo {
  productId: string;
  productName: string;
  productKind: string;
  stock: number;
  required: number;
}

export interface ComboStock {
  stock: number;
  components: ComboComponentInfo[];
}

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return String(v ?? '');
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

export async function getComboMap(
  comboIds: string[],
  txOrDb: any = db
): Promise<Map<string, Array<{ componentProductId: string; quantity: number }>>> {
  const out = new Map<string, Array<{ componentProductId: string; quantity: number }>>();
  const ids = Array.from(new Set(comboIds.filter(Boolean)));
  if (ids.length === 0) return out;
  let rows: Row[];
  try {
    rows = (await txOrDb
      .select({
        comboProductId: comboComponents.comboProductId,
        componentProductId: comboComponents.componentProductId,
        quantity: comboComponents.quantity,
      })
      .from(comboComponents)
      .where(inArray(comboComponents.comboProductId, ids))) as Row[];
  } catch (e) {
    // DB chua ap migration 0064 (deploy code truoc, migration sau): coi nhu
    // khong co combo, giu hanh vi cu thay vi lam hong moi don hang.
    if (String((e as Error)?.message || e).includes('no such table')) return out;
    throw e;
  }
  for (const r of rows) {
    const list = out.get(str(r.comboProductId)) || [];
    list.push({ componentProductId: str(r.componentProductId), quantity: num(r.quantity) });
    out.set(str(r.comboProductId), list);
  }
  return out;
}

export async function getComboStocks(
  comboIds: string[],
  warehouseId: string,
  txOrDb: any = db
): Promise<Map<string, ComboStock>> {
  const out = new Map<string, ComboStock>();
  const ids = Array.from(new Set(comboIds.filter(Boolean)));
  if (ids.length === 0) return out;
  const rows = (await txOrDb
    .select({
      comboProductId: comboComponents.comboProductId,
      componentProductId: comboComponents.componentProductId,
      quantity: comboComponents.quantity,
      productName: products.name,
      productKind: products.productKind,
    })
    .from(comboComponents)
    .innerJoin(products, eq(products.id, comboComponents.componentProductId))
    .where(inArray(comboComponents.comboProductId, ids))) as Row[];
  const compIds = Array.from(new Set(rows.map((r) => str(r.componentProductId))));
  const balMap = await InventoryService.getBatchBalance(compIds, warehouseId, 'NEW', txOrDb);
  const byCombo = new Map<string, Row[]>();
  for (const r of rows) {
    const key = str(r.comboProductId);
    const list = byCombo.get(key) || [];
    list.push(r);
    byCombo.set(key, list);
  }
  for (const id of ids) {
    const comps = byCombo.get(id) || [];
    if (comps.length === 0) {
      out.set(id, { stock: 0, components: [] });
      continue;
    }
    let minStock = Infinity;
    const components: ComboComponentInfo[] = comps.map((c) => {
      const stock = balMap.get(str(c.componentProductId)) ?? 0;
      minStock = Math.min(minStock, Math.floor(stock / Math.max(1, num(c.quantity))));
      return {
        productId: str(c.componentProductId),
        productName: str(c.productName),
        productKind: str(c.productKind),
        stock,
        required: num(c.quantity),
      };
    });
    out.set(id, { stock: minStock === Infinity ? 0 : minStock, components });
  }
  return out;
}

export async function getComboStock(comboProductId: string, warehouseId: string): Promise<ComboStock> {
  const m = await getComboStocks([comboProductId], warehouseId);
  return m.get(comboProductId) || { stock: 0, components: [] };
}

export async function isCombo(productId: string, txOrDb: any = db): Promise<boolean> {
  const rows = (await txOrDb
    .select({ id: comboComponents.id })
    .from(comboComponents)
    .where(eq(comboComponents.comboProductId, productId))
    .limit(1)) as Row[];
  return rows.length > 0;
}

export interface ExpandedNeed {
  productId: string;
  quantity: number;
  isBook: boolean;
  fromComboId: string | null;
}

/**
 * Kiem tra danh sach component hop le: ton tai trong products VA la BOOK.
 * Tra ve chuoi loi, null neu hop le. Dung chung cho POST va PUT.
 */
export async function validateComponents(
  items: Array<{ productId?: unknown; quantity?: unknown }>,
  txOrDb: any = db
): Promise<string | null> {
  if (!Array.isArray(items) || items.length === 0) return 'Combo phai co it nhat 1 sach thanh phan.';
  const seen = new Set<string>();
  for (const c of items) {
    const pid = String((c as any)?.productId || '');
    const qty = Number((c as any)?.quantity);
    if (!pid) return 'Thanh phan thieu productId.';
    if (!Number.isInteger(qty) || qty < 1) return `So luong khong hop le cho ${pid}.`;
    if (seen.has(pid)) return `Trung sach thanh phan: ${pid}.`;
    seen.add(pid);
  }
  const compRows = (await txOrDb
    .select({ id: products.id, productKind: products.productKind })
    .from(products)
    .where(inArray(products.id, Array.from(seen)))) as Array<{ id: string; productKind: string }>;
  if (compRows.length !== seen.size) return 'Co sach thanh phan khong ton tai.';
  if (compRows.some((r) => r.productKind !== 'BOOK')) return 'Thanh phan combo phai la sach (BOOK).';
  return null;
}

export async function expandComboNeeds(
  items: Array<{ productId: string; quantity: number }>,
  txOrDb: any = db
): Promise<ExpandedNeed[]> {
  const comboIds = Array.from(new Set(items.map((i) => i.productId)));
  const rows = (await txOrDb
    .select({
      comboProductId: comboComponents.comboProductId,
      componentProductId: comboComponents.componentProductId,
      quantity: comboComponents.quantity,
      productKind: products.productKind,
    })
    .from(comboComponents)
    .innerJoin(products, eq(products.id, comboComponents.componentProductId))
    .where(inArray(comboComponents.comboProductId, comboIds))) as Row[];
  const byCombo = new Map<string, Row[]>();
  for (const r of rows) {
    const key = str(r.comboProductId);
    const list = byCombo.get(key) || [];
    list.push(r);
    byCombo.set(key, list);
  }
  const out: ExpandedNeed[] = [];
  for (const it of items) {
    const comps = byCombo.get(it.productId);
    if (!comps || comps.length === 0) {
      out.push({ productId: it.productId, quantity: it.quantity, isBook: !it.productId.startsWith('pr-'), fromComboId: null });
      continue;
    }
    for (const c of comps) {
      out.push({
        productId: str(c.componentProductId),
        quantity: it.quantity * Math.max(1, num(c.quantity)),
        isBook: str(c.productKind) === 'BOOK',
        fromComboId: it.productId,
      });
    }
  }
  return out;
}
