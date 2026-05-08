import type { QuoteItem } from './types';

export function formatSyscomPrice(
  usdAmount: number,
  currency: 'MXN' | 'USD',
  exchangeRate: number,
  includeIva: boolean
) {
  let amount = usdAmount;
  if (currency === 'MXN') amount *= exchangeRate;
  if (includeIva) amount *= 1.16;

  return amount.toLocaleString('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function calculateSubtotal(
  quoteItems: QuoteItem[],
  currency: 'MXN' | 'USD',
  exchangeRate: number
) {
  const totalMxn = quoteItems.reduce((acc, item) => acc + (item.unitPriceMxn * item.quantity), 0);
  return currency === 'USD' ? totalMxn / exchangeRate : totalMxn;
}

export function calculateTotalCostDisplay(
  quoteItems: QuoteItem[],
  currency: 'MXN' | 'USD',
  exchangeRate: number,
  includeIva: boolean
) {
  const totalCostMxn = quoteItems.reduce((acc, item) => {
    const costUsd = parseFloat(item.product.precios.precio_descuento) || 0;
    let itemCost = costUsd * exchangeRate;
    if (includeIva) itemCost *= 1.16;
    return acc + (itemCost * item.quantity);
  }, 0);

  return currency === 'USD' ? totalCostMxn / exchangeRate : totalCostMxn;
}

export function calculateMargin(subtotal: number, totalCostDisplay: number, includeIva: boolean) {
  return subtotal - (totalCostDisplay / (includeIva ? 1.16 : 1));
}
