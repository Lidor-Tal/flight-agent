// ============================================================
//  flightLogic.ts — הלוגיקה ה"טהורה" של הסוכן, מופרדת כדי שאפשר לבדוק אותה
// ============================================================
// הפרדנו את החלקים האלה מ-index.ts כדי שבדיקות היחידה יוכלו לייבא
// ולבדוק אותם בבידוד, בלי להריץ את כל התוכנית.

// טיפוס שמתאר טיסה אחת אחרי שעיבדנו אותה
export interface FlightDeal {
  price: number;
  departTime: string; // פורמט "2026-09-03 13:40"
  airline: string; // החברה של ההלוךs
  departureToken?: string; // אסימון שמשמש להבאת פרטי החזור (קריאה שנייה)
  returnTime?: string; // שעת יציאה בחזור — מתמלא אחרי הקריאה השנייה
  returnAirline?: string; // החברה של החזור — מתמלא אחרי הקריאה השנייה
}

// הקריטריונים לסינון — מועברים כפרמטר במקום לקרוא מ-env,
// כך שבבדיקה אפשר לתת ערכים קבועים וצפויים.
export interface FilterCriteria {
  fromHour: number;
  toHour: number;
  maxPrice: number;
}

// --- סינון טיסות לפי חלון שעות + מחיר ---
// פונקציה "טהורה": אותו קלט -> תמיד אותו פלט, בלי תופעות לוואי.
// זה מה שהופך אותה לקלה ובטוחה לבדיקה.
export function filterDeals(
  deals: FlightDeal[],
  criteria: FilterCriteria,
): FlightDeal[] {
  return deals.filter((d) => {
    // "2026-09-03 13:40" -> אחרי הרווח "13:40" -> לפני הנקודתיים -> 13
    const hour = parseInt(d.departTime.split(" ")[1].split(":")[0]);
    const inTimeWindow = hour >= criteria.fromHour && hour <= criteria.toHour;
    const inBudget = d.price <= criteria.maxPrice;
    return inTimeWindow && inBudget;
  });
}

// --- בניית טקסט ההודעה לטלגרם ---
// גם זו פונקציה טהורה — מקבלת טיסה ומחזירה מחרוזת. קלה לבדיקה.
export function buildMessage(
  d: FlightDeal,
  origin: string,
  destination: string,
): string {
  // שורת ההלוך — תמיד מופיעה, עם החברה של ההלוך
  const outboundLine = `🛫 הלוך: ${d.airline} — ${d.departTime}`;

  // שורת החזור — רק אם הבאנו את פרטי החזור. מציגה את החברה של החזור
  // (ולא של ההלוך!), כי בטיסה הלוך-חזור הן יכולות להיות שונות.
  const returnLine = d.returnTime
    ? `\n🛬 חזור: ${d.returnAirline ? d.returnAirline + " — " : ""}${d.returnTime}`
    : "";

  return (
    `✈️ <b>נמצאה טיסת צהריים טובה!</b>\n\n` +
    `מסלול: ${origin} ⇄ ${destination}\n\n` +
    outboundLine +
    returnLine +
    `\n\n💰 מחיר הלוך-חזור: ${d.price} EUR`
  );
}

// --- שליחת הודעה לטלגרם ---
// מקבלת את הטוקן וה-chat id כפרמטרים (לא קוראת מ-env), כדי שבבדיקה
// נוכל לזייף את fetch ולוודא שהבקשה נבנית נכון — בלי לשלוח באמת.
export async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    throw new Error(`Telegram failed: ${res.status}`);
  }
}
