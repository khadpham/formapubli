/**
 * Lightweight, 0-dependency pure TypeScript SHA-256 implementation
 * Guarantees 100% identical hashes across Node.js, Web Browsers, and PWA Workers
 */
function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i: number, j: number;
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let compositeBitLength = asciiBitLength;
  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return ''; // UTF-8 outside ASCII range handled via encodeURIComponent
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }
  words[words.length] = (compositeBitLength / maxWord) | 0;
  words[words.length] = compositeBitLength;

  for (j = 0; j < words.length; ) {

    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const i2 = i + j;
      const w15 = w[i - 15],
        w2 = w[i - 2];

      const a = hash[0],
        e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

/**
 * Encode string to UTF-8 ASCII bytes before hashing
 */
export function hashString(input: string): string {
  const utf8 = unescape(encodeURIComponent(input));
  return sha256(utf8);
}

/**
 * Format timestamp for audit watermark
 */
export function formatAuditTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

/**
 * Generates an SHA-256 integrity hash from tabular or structured export rows
 * Normalizes rows by sorting keys and hashing JSON string
 */
export function generateExportHash(rows: Array<Record<string, unknown>>): string {
  if (!rows || rows.length === 0) {
    return hashString('EMPTY_EXPORT');
  }

  // Normalize each row by sorting its keys
  const normalizedRows = rows.map(row => {
    const sortedKeys = Object.keys(row).sort();
    const sortedObj: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      sortedObj[key] = row[key];
    }
    return sortedObj;
  });

  const payload = JSON.stringify(normalizedRows);
  return hashString(payload);
}

export interface WatermarkOptions {
  actorId: string;
  actorRole: string;
  reportName: string;
  fiscalScope?: string;
  timestamp?: string;
}

/**
 * Appends a tamper-evident audit watermark banner and cryptographic hash to a CSV string.
 */
export function appendExportWatermark(
  csvContent: string,
  rows: Array<Record<string, unknown>>,
  options: WatermarkOptions
): string {
  const hash = generateExportHash(rows);
  const ts = options.timestamp || formatAuditTimestamp();
  const fiscal = options.fiscalScope ? ` | FiscalScope: [${options.fiscalScope}]` : '';

  const watermarkFooter = [
    '',
    '# ============================================================================== #',
    '# FORMAPUBLI FINANCIAL & AUDIT INTEGRITY TRAIL                                     #',
    `# Report: [${options.reportName}]${fiscal}`,
    `# Exported By: [${options.actorId}] (Role: ${options.actorRole}) at [${ts}]`,
    `# Total Records: [${rows.length}]`,
    `# SHA-256 Data Integrity Hash: [${hash}]`,
    '# WARNING: Any modification to data rows invalidates this hash.                   #',
    '# ============================================================================== #',
  ].join('\r\n');

  return csvContent.trimEnd() + '\r\n' + watermarkFooter;
}

export interface VerificationResult {
  isValid: boolean;
  expectedHash?: string;
  extractedHash?: string;
  actor?: string;
  timestamp?: string;
  recordCount?: number;
  reason?: string;
}

/**
 * Parses a watermarked CSV and verifies whether the data rows have been tampered with.
 */
export function verifyExportIntegrity(
  fullCsvContent: string,
  recomputedHash: string
): VerificationResult {
  const hashMatch = fullCsvContent.match(/# SHA-256 Data Integrity Hash:\s*\[([a-f0-9]{64})\]/i);
  const actorMatch = fullCsvContent.match(/# Exported By:\s*\[([^\]]+)\]/i);
  const timeMatch = fullCsvContent.match(/at\s*\[([^\]]+)\]/i);
  const countMatch = fullCsvContent.match(/# Total Records:\s*\[(\d+)\]/i);

  if (!hashMatch) {
    return {
      isValid: false,
      reason: 'No audit watermark or integrity hash found in document.',
    };
  }

  const extractedHash = hashMatch[1].toLowerCase();
  const valid = extractedHash === recomputedHash.toLowerCase();

  return {
    isValid: valid,
    expectedHash: extractedHash,
    extractedHash: recomputedHash,
    actor: actorMatch ? actorMatch[1] : undefined,
    timestamp: timeMatch ? timeMatch[1] : undefined,
    recordCount: countMatch ? parseInt(countMatch[1], 10) : undefined,
    reason: valid ? 'File integrity verified 100%' : 'Integrity check FAILED: Hash mismatch (file data was modified)',
  };
}
