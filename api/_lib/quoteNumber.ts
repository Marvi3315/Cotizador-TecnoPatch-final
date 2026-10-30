import type { Firestore } from 'firebase-admin/firestore';

export const getNextQuoteNumber = async (db: Firestore): Promise<string> => {
  const year = new Date().getFullYear();
  const snapshot = await db
    .collection('quoteHistory')
    .orderBy('savedAt', 'desc')
    .limit(200)
    .get();

  let maxNumber = 0;
  snapshot.forEach(doc => {
    const quoteNumber = doc.data()?.quoteNumber as string | undefined;
    const match = quoteNumber?.match(new RegExp(`^COT-${year}-(\\d+)$`));
    if (match) {
      maxNumber = Math.max(maxNumber, Number(match[1]));
    }
  });

  return `COT-${year}-${String(maxNumber + 1).padStart(4, '0')}`;
};

const bumpQuoteNumber = (n: string) => {
  const m = n.match(/^(COT-\d{4}-)(\d+)$/);
  return m ? `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}` : n;
};

// Reserva el folio de forma atomica: si dos vendedores crean al mismo tiempo, no se repite el numero.
export const reserveQuoteNumber = async (db: Firestore): Promise<string> => {
  let candidate = await getNextQuoteNumber(db);
  for (let i = 0; i < 8; i++) {
    try {
      await db.collection('quoteNumberLocks').doc(candidate).create({ at: Date.now() });
      return candidate;
    } catch (e: any) {
      if (e?.code === 6 || /already exists/i.test(String(e?.message || ''))) { candidate = bumpQuoteNumber(candidate); continue; }
      throw e;
    }
  }
  return candidate;
};
