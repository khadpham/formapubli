function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, '0') + value;
}

export function crc16Ccitt(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function normalizeVietqrContent(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .slice(0, 23);
}

export function generateVietQRPayload(params: {
  bankBin: string;
  accountNo: string;
  amount?: number;
  content?: string;
}): string {
  const { bankBin, accountNo, amount = 0, content = '' } = params;
  const beneficiary = tlv('00', bankBin) + tlv('01', accountNo);
  const provider = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  let payload = tlv('00', '01') + tlv('01', '12') + tlv('38', provider) + tlv('53', '704');
  if (Math.round(amount) > 0) payload += tlv('54', Math.round(amount).toString());
  payload += tlv('58', 'VN');
  const normContent = content ? normalizeVietqrContent(content) : '';
  if (normContent.length > 0) payload += tlv('62', tlv('08', normContent));
  payload += '6304';
  return payload + crc16Ccitt(payload);
}
