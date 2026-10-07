const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readThreeDigits(threeDigits: number, isHighestGroup: boolean): string {
  const hundreds = Math.floor(threeDigits / 100);
  const tens = Math.floor((threeDigits % 100) / 10);
  const units = threeDigits % 10;

  let result = '';

  if (hundreds > 0 || !isHighestGroup) {
    result += DIGITS[hundreds] + ' trăm ';
  }

  if (tens > 1) {
    result += DIGITS[tens] + ' mươi ';
    if (units === 1) result += 'mốt ';
    else if (units === 5) result += 'lăm ';
    else if (units > 0) result += DIGITS[units] + ' ';
  } else if (tens === 1) {
    result += 'mười ';
    if (units === 5) result += 'lăm ';
    else if (units > 0) result += DIGITS[units] + ' ';
  } else {
    // tens === 0
    if (units > 0) {
      if (hundreds > 0 || !isHighestGroup) {
        result += 'linh ' + DIGITS[units] + ' ';
      } else {
        result += DIGITS[units] + ' ';
      }
    }
  }

  return result.trim();
}

/**
 * Đọc số tiền VND thành chữ tiếng Việt chuẩn kế toán.
 * Ví dụ: 15000000 -> "Mười lăm triệu đồng chẵn"
 */
export function readVietnameseNumber(amount: number): string {
  const rounded = Math.round(Math.abs(amount));
  if (rounded === 0) return 'Không đồng chẵn';

  const GROUPS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  let temp = rounded;
  const parts: { value: number; groupName: string }[] = [];
  let groupIdx = 0;

  while (temp > 0) {
    const chunk = temp % 1000;
    if (chunk > 0 || groupIdx === 3) {
      parts.unshift({ value: chunk, groupName: GROUPS[groupIdx] || '' });
    }
    temp = Math.floor(temp / 1000);
    groupIdx++;
  }

  let textResult = '';
  for (let i = 0; i < parts.length; i++) {
    const isHighest = i === 0;
    const chunkWords = readThreeDigits(parts[i].value, isHighest);
    if (chunkWords) {
      textResult += (textResult ? ' ' : '') + chunkWords;
      if (parts[i].groupName) {
        textResult += ' ' + parts[i].groupName;
      }
    }
  }

  textResult = textResult.trim();
  textResult = textResult.charAt(0).toUpperCase() + textResult.slice(1) + ' đồng chẵn';
  return textResult;
}
