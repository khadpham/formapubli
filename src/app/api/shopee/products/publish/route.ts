import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, editions, shopeeProducts, shopeeItemMap } from '@/db';
import { uploadImageToShopee, downloadImage } from '@/services/shopee/media';
import { addShopeeItem, getBookCategoryId, getDefaultBookAttributes } from '@/services/shopee/product';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/products/publish?ids=id1,id2
 * Chi tiết các edition đã chọn để tự điền form đăng sản phẩm.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const ids = String(new URL(req.url).searchParams.get('ids') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (ids.length === 0) return NextResponse.json({ success: true, data: [] });
    const rows = await db
      .select({
        id: editions.id,
        code: editions.code,
        title: editions.title,
        isbn: editions.isbn,
        coverPrice: editions.coverPrice,
        pages: editions.pages,
        publisher: editions.publisher,
        publicationYear: editions.publicationYear,
      })
      .from(editions)
      .where(inArray(editions.id, ids));
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

interface PublishBody {
  editionIds?: string[];
  name?: string;
  description?: string;
  price?: number;
  stock?: number;
  sku?: string;
  imageUrl?: string;
  weight?: number;
  /** Năm xuất bản (ghi đè giá trị tự lấy từ editions). */
  year?: string;
  /** Nhà in / đơn vị phát hành (ghi đè giá trị tự lấy từ editions). */
  printer?: string;
}

/**
 * POST /api/shopee/products/publish
 * Đăng sản phẩm từ ERP lên Shopee. Chỉ Owner/Manager.
 * Body: { editionIds, name, description, price, stock, sku, imageUrl, weight }
 * Luồng: tải ảnh từ URL -> upload lên Shopee (Media API) -> add_item ->
 * lưu item_id vào shopee_products (+ shopee_item_map nếu là sách lẻ).
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as PublishBody;

    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const sku = String(body.sku || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();
    const price = Number(body.price || 0);
    const stock = Number(body.stock ?? 0);
    const weight = Number(body.weight || 0.5);
    const editionIds = Array.isArray(body.editionIds) ? body.editionIds.filter(Boolean) : [];

    if (name.length < 10 || name.length > 120) {
      return NextResponse.json(
        { success: false, error: 'Tên sản phẩm phải từ 10 đến 120 ký tự.' },
        { status: 400 }
      );
    }
    if (description.length < 20) {
      return NextResponse.json(
        { success: false, error: 'Mô tả phải tối thiểu 20 ký tự.' },
        { status: 400 }
      );
    }
    if (!sku) {
      return NextResponse.json({ success: false, error: 'Thiếu mã SKU.' }, { status: 400 });
    }
    if (!imageUrl) {
      return NextResponse.json({ success: false, error: 'Thiếu link ảnh bìa.' }, { status: 400 });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ success: false, error: 'Giá bán phải lớn hơn 0.' }, { status: 400 });
    }
    if (!Number.isFinite(stock) || stock < 0) {
      return NextResponse.json({ success: false, error: 'Tồn kho không hợp lệ.' }, { status: 400 });
    }

    // Kiểm tra SKU chưa từng đăng (tránh trùng).
    const dup = await db
      .select({ itemId: shopeeProducts.itemId })
      .from(shopeeProducts)
      .where(eq(shopeeProducts.itemSku, sku))
      .limit(1);
    if (dup.length > 0) {
      return NextResponse.json(
        { success: false, error: `SKU ${sku} đã đăng lên Shopee trước đây (item ${dup[0].itemId}).` },
        { status: 400 }
      );
    }

    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl = `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    if (!partnerId || !partnerKey) {
      return NextResponse.json({ success: false, error: 'Chưa cấu hình key Shopee.' }, { status: 400 });
    }
    const { shopId } = await resolveShopeeShopId();
    if (!shopId) {
      return NextResponse.json({ success: false, error: 'Chưa kết nối gian hàng.' }, { status: 400 });
    }
    const shopCfg = await getShopeeConfig();
    const cfg = { shopId, partnerId, partnerKey, baseUrl, warehouseId: shopCfg.warehouseId || '' };

    // 1. Tải ảnh từ URL về.
    let imageBuffer: Buffer;
    try {
      imageBuffer = await downloadImage(imageUrl);
    } catch (e) {
      return NextResponse.json(
        { success: false, error: `Không tải được ảnh từ link: ${(e as Error).message}` },
        { status: 400 }
      );
    }

    // 2. Upload ảnh lên Shopee, lấy image_id.
    const imageId = await uploadImageToShopee(cfg, imageBuffer, `${sku}.png`);

    // 3. Build text attributes động từ editions (số trang, năm, nhà in).
    // Không hardcode theo COMBO11 nữa - mỗi sản phẩm lấy đúng dữ liệu của mình.
    let textAttributes: Array<{ attributeId: number; text: string }> | undefined;
    if (editionIds.length > 0) {
      const eds = await db
        .select({ pages: editions.pages, publicationYear: editions.publicationYear, publisher: editions.publisher })
        .from(editions)
        .where(inArray(editions.id, editionIds));
      if (eds.length > 0) {
        const pageParts = eds.filter((e) => e.pages && e.pages > 0).map((e) => `${e.pages} trang`);
        const publishers = [...new Set(eds.map((e) => (e.publisher || '').trim()).filter(Boolean))];
        const years = [...new Set(eds.map((e) => e.publicationYear).filter((y): y is number => !!y))];
        const yearText = years.length > 0 ? String(Math.max(...years)) : (body.year || '2026');
        textAttributes = [
          { attributeId: 100669, text: 'Vita Nova' }, // Publishing Company
          { attributeId: 101024, text: body.year?.trim() || yearText }, // Year (ưu tiên user nhập)
          { attributeId: 101269, text: pageParts.length > 0 ? pageParts.join(', ') : '300 trang' }, // Total Pages
          { attributeId: 101294, text: body.printer?.trim() || publishers.join(', ') || 'NXB Lao động' }, // Book printer/distributor
        ];
      }
    }

    // 4. Tạo sản phẩm trên Shopee.
    const bookCategoryId = getBookCategoryId(baseUrl);
    const isSandbox = /sandbox/i.test(baseUrl);
    const itemId = await addShopeeItem(cfg, {
      name,
      description,
      price: Math.round(price),
      stock: Math.round(stock),
      itemSku: sku,
      imageIdList: [imageId],
      categoryId: bookCategoryId,
      weight,
      attributes: getDefaultBookAttributes(baseUrl),
      // Production: dùng attributes động; sandbox: không cần text attributes.
      textAttributes: isSandbox ? undefined : textAttributes,
    });

    // 5. Lưu vào DB.
    await db.insert(shopeeProducts).values({
      itemId,
      itemSku: sku,
      name,
      price: Math.round(price),
      stock: Math.round(stock),
      status: 'NORMAL',
      categoryId: bookCategoryId,
      imageUrls: JSON.stringify([imageUrl]),
      erpEditionId: editionIds.length === 1 ? editionIds[0] : null,
    });

    // Sách lẻ: tạo luôn map để đẩy tồn/giá sau này. Combo thì dùng shopee_sku_components.
    if (editionIds.length === 1) {
      const eds = await db.select().from(editions).where(inArray(editions.id, editionIds)).limit(1);
      if (eds.length > 0) {
        await db
          .insert(shopeeItemMap)
          .values({ shopId, editionId: eds[0].id, itemId, modelId: 0 })
          .onConflictDoNothing();
      }
    }

    return NextResponse.json({ success: true, data: { itemId, sku, imageId } });
  } catch (error) {
    return handleApiError(error);
  }
}
