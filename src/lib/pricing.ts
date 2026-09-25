export interface PricedLine {
  coverPrice: number;
  unitSellingPrice: number;
  subtotal: number;
  discountAmount: number;
  finalAmount: number;
}

export function priceLine(coverPrice: number, discountRate: number, quantity: number): PricedLine {
  const safeCoverPrice = Number.isFinite(coverPrice) ? Math.max(0, Math.round(coverPrice)) : 0;
  const safeDiscountRate = Number.isFinite(discountRate)
    ? Math.min(1, Math.max(0, discountRate))
    : 0;
  const safeQuantity = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
  const unitSellingPrice = Math.round(safeCoverPrice * (1 - safeDiscountRate));
  const subtotal = safeCoverPrice * safeQuantity;
  const finalAmount = unitSellingPrice * safeQuantity;
  return {
    coverPrice: safeCoverPrice,
    unitSellingPrice,
    subtotal,
    discountAmount: subtotal - finalAmount,
    finalAmount,
  };
}
