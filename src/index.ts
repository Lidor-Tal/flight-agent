// ============================================================
//  סוכן טיסות TLV -> KGS  | שולח התראה בטלגרם על טיסת צהריים טובה
//  מקור נתונים: SerpApi (Google Flights) — נתונים אמיתיים כולל שעות
// ============================================================
// כל פעולה מוסברת בהערה כדי שתבין מה קורה בכל שלב.

import "dotenv/config"; // טוען את הקבצים מ-.env לתוך process.env
import {
  FlightDeal,
  filterDeals,
  buildMessage,
  sendTelegram,
} from "./flightLogic.js"; // הלוגיקה הנבדקת חיה בקובץ נפרד

// --- 1. קוראים את ההגדרות מתוך קובץ ה-.env ---
const {
  SERPAPI_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  ORIGIN = "TLV",
  DESTINATION = "KGS",
  DEPART_DATE = "2026-09-03",
  RETURN_DATE = "2026-09-06",
  DEPART_FROM_HOUR = "1",
  DEPART_TO_HOUR = "12",
  RETURN_FROM_HOUR = "13",
  RETURN_TO_HOUR = "22",
  MAX_PRICE_EUR = "1000",
} = process.env;

// בדיקה קטנה שלא שכחנו למלא משהו
function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.includes("הדבק")) {
    console.error(`❌ חסר ערך ב-.env: ${name}`);
    process.exit(1);
  }
  return value as string;
}
requireEnv("SERPAPI_KEY", SERPAPI_KEY);
requireEnv("TELEGRAM_BOT_TOKEN", TELEGRAM_BOT_TOKEN);
requireEnv("TELEGRAM_CHAT_ID", TELEGRAM_CHAT_ID);

// --- 2. מחפשים טיסות הלוך-חזור דרך SerpApi ---
async function searchFlights(): Promise<FlightDeal[]> {
  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", ORIGIN);
  url.searchParams.set("arrival_id", DESTINATION);
  url.searchParams.set("outbound_date", DEPART_DATE);
  url.searchParams.set("return_date", RETURN_DATE);
  url.searchParams.set("type", "1"); // 1 = הלוך-חזור
  url.searchParams.set("currency", "EUR");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", SERPAPI_KEY!);
  // פילטר שעות מובנה של גוגל:
  url.searchParams.set("outbound_times", `${DEPART_FROM_HOUR},${DEPART_TO_HOUR},0,23`);
  url.searchParams.set("return_times", `${RETURN_FROM_HOUR},${RETURN_TO_HOUR},0,23`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpApi failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as any;

  // SerpApi מחזיר שתי רשימות: best_flights + other_flights
  const offers = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];

  return offers.map((offer: any): FlightDeal => {
    const firstLeg = offer.flights[0];
    return {
      price: offer.price,
      departTime: firstLeg.departure_airport.time,
      airline: firstLeg.airline,
    };
  });
}

// --- 3. הפונקציה הראשית שמחברת הכל ---
async function main() {
  console.log("🔍 מחפש טיסות...");
  const allDeals = await searchFlights();
  console.log(`נמצאו ${allDeals.length} טיסות סה"כ.`);

  // הסינון מגיע עכשיו מהמודול הנבדק
  const goodDeals = filterDeals(allDeals, {
    fromHour: parseInt(DEPART_FROM_HOUR),
    toHour: parseInt(DEPART_TO_HOUR),
    maxPrice: parseFloat(MAX_PRICE_EUR),
  });
  console.log(`מתוכן ${goodDeals.length} עונות על הקריטריונים שלך.`);

  if (goodDeals.length === 0) {
    console.log("אין טיסה מתאימה כרגע. אבדוק שוב בריצה הבאה.");
    return;
  }

  goodDeals.sort((a, b) => a.price - b.price);
  for (const d of goodDeals) {
    const msg = buildMessage(d, ORIGIN, DESTINATION);
    await sendTelegram(TELEGRAM_BOT_TOKEN!, TELEGRAM_CHAT_ID!, msg);
    console.log("📲 נשלחה התראה לטלגרם!");
  }
}

main().catch((err) => {
  console.error("שגיאה:", err.message);
  process.exit(1);
});
