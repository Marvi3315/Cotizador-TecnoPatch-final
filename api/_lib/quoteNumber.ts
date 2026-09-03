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
