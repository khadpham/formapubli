/**
 * R2 Service - Lưu trữ file trên Cloudflare R2 (S3-compatible)
 * Dùng cho: chứng từ kho, hợp đồng, và các tài liệu cần lưu trữ lâu dài.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

function getR2Client(): S3Client {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Thiếu cấu hình R2 (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  }

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET || 'formapubli';
  return bucket;
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
}

/**
 * Upload file lên R2
 * @param key - Đường dẫn trên R2 (vd: chung-tu-kho/2026/NK-2026-0001.html)
 * @param body - Nội dung file (Buffer, string, hoặc stream)
 * @param contentType - MIME type
 */
export async function uploadToR2(
  key: string,
  body: Buffer | string | Uint8Array,
  contentType: string = 'application/octet-stream'
): Promise<UploadResult> {
  const client = getR2Client();
  const bucket = getBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await client.send(command);

  // R2 public URL (nếu bucket có public domain) hoặc presigned URL
  // Tạm thời trả về key, URL đầy đủ sẽ cấu hình sau
  const publicBase = process.env.R2_PUBLIC_URL || '';
  const url = publicBase ? `${publicBase}/${key}` : `r2://${bucket}/${key}`;

  const size = typeof body === 'string' ? Buffer.byteLength(body) : body.length;

  return { key, url, size };
}

/**
 * Upload chứng từ kho lên R2
 * @param docNumber - Số chứng từ (vd: NK-2026-0001)
 * @param html - Nội dung HTML của chứng từ
 */
export async function uploadWarehouseDocument(
  docNumber: string,
  html: string
): Promise<UploadResult> {
  const year = new Date().getFullYear();
  const key = `chung-tu-kho/${year}/${docNumber}.html`;
  return uploadToR2(key, html, 'text/html; charset=utf-8');
}

/**
 * Kiểm tra file có tồn tại trên R2 không
 */
export async function r2Exists(key: string): Promise<boolean> {
  try {
    const client = getR2Client();
    await client.send(new HeadObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Xóa file trên R2
 */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key,
  }));
}

/**
 * Kiểm tra kết nối R2
 */
export async function testR2Connection(): Promise<{ ok: boolean; message: string }> {
  try {
    const client = getR2Client();
    // Thử list bằng cách check bucket tồn tại
    await client.send(new HeadObjectCommand({
      Bucket: getBucket(),
      Key: '.r2-test',
    }));
    return { ok: true, message: 'Kết nối R2 thành công' };
  } catch (e: any) {
    // HeadObject lỗi 404 cũng có nghĩa là kết nối OK (bucket tồn tại)
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      return { ok: true, message: 'Kết nối R2 thành công (bucket tồn tại)' };
    }
    return { ok: false, message: 'Lỗi kết nối R2: ' + e.message };
  }
}
