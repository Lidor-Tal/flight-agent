// ============================================================
//  סוכן טיסות רב-יעדים  | שולח התראה בטלגרם על טיסה טובה
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
  DEPART_DATE = "2026-09-03",
  RETURN_DATE = "2026-09-06",
  DEPART_FROM_HOUR = "1",
  DEPART_TO_HOUR = "12",
  RETURN_FROM_HOUR = "13",
  RETURN_TO_HOUR = "22",
  MAX_PRICE_EUR = "1400",
  ADULTS = "1", // מספר נוסעים. נשלח ל-SerpApi כך שהמחיר חוזר לכל הקבוצה.
  NONSTOP_ONLY = "true", // "true" = רק טיסות ישירות. שים "false" כדי לאפשר קונקשן
} = process.env;

// תמיכה בכמה יעדים בבת אחת. פורמט: DESTINATIONS="LCA,RHO,HER"
// תאימות לאחור: אם אין DESTINATIONS, נופלים ל-DESTINATION הישן (או KGS).
const DESTINATIONS = (
  process.env.DESTINATIONS ??
  process.env.DESTINATION ??
  "KGS"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// חדש: תמיכה בכמה נמענים. TELEGRAM_CHAT_ID יכול להיות "id1,id2,id3"
// (או chat_id בודד של קבוצה — אז כל הקבוצה מקבלת). תאימות לאחור לערך בודד.
const CHAT_IDS = (TELEGRAM_CHAT_ID ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

// --- שולח הודעה אחת לכל הנמענים. כישלון אצל אחד לא מפיל את השאר. ---
async function notify(text: string): Promise<void> {
  for (const id of CHAT_IDS) {
    try {
      await sendTelegram(TELEGRAM_BOT_TOKEN!, id, text);
    } catch (err: any) {
      console.error(`⚠️ שליחה לנמען ${id} נכשלה: ${err.message}`);
    }
  }
}

// --- בונה כתובת בסיס ל-SerpApi ליעד ספציפי ---
// משמש גם לחיפוש ההלוך וגם לקריאת החזור (שמוסיפה departure_token)
function buildBaseUrl(destination: string): URL {
  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", ORIGIN);
  url.searchParams.set("arrival_id", destination);
  url.searchParams.set("outbound_date", DEPART_DATE);
  url.searchParams.set("return_date", RETURN_DATE);
  url.searchParams.set("type", "1"); // 1 = הלוך-חזור
  url.searchParams.set("currency", "EUR");
  url.searchParams.set("hl", "en");
  url.searchParams.set("adults", ADULTS); // כך המחיר יחזור לכל הקבוצה
  url.searchParams.set("api_key", SERPAPI_KEY!);
  url.searchParams.set(
    "outbound_times",
    `${DEPART_FROM_HOUR},${DEPART_TO_HOUR},0,23`,
  );
  url.searchParams.set(
    "return_times",
    `${RETURN_FROM_HOUR},${RETURN_TO_HOUR},0,23`,
  );
  // ישיר בלבד: stops=1 אומר ל-Google Flights להחזיר רק טיסות ללא עצירות.
  if (NONSTOP_ONLY !== "false") {
    url.searchParams.set("stops", "1");
  }
  return url;
}

// --- 2. חיפוש טיסות ההלוך ליעד אחד (קריאה ראשונה) ---
async function searchFlights(destination: string): Promise<FlightDeal[]> {
  const url = buildBaseUrl(destination);
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(
      `SerpApi failed (${destination}): ${res.status} ${await res.text()}`,
    );

  const data = (await res.json()) as any;
  const offers = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];

  return offers.map((offer: any): FlightDeal => {
    const firstLeg = offer.flights[0];
    return {
      price: offer.price,
      departTime: firstLeg.departure_airport.time,
      airline: firstLeg.airline, // החברה של ההלוך
      departureToken: offer.departure_token,
      destination, // מתייגים כל דיל עם היעד שלו
    };
  });
}

// --- 3. הבאת פרטי החזור לטיסה ספציפית (קריאה שנייה, עולה חיפוש נוסף) ---
async function fetchReturnInfo(
  destination: string,
  departureToken: string,
): Promise<{ time: string; airline: string } | undefined> {
  const url = buildBaseUrl(destination);
  url.searchParams.set("departure_token", departureToken); // זה מה שמבקש את החזור
  const res = await fetch(url);
  if (!res.ok) return undefined; // אם נכשל, פשוט לא נציג חזור — לא נפיל את כל הריצה

  const data = (await res.json()) as any;
  const returnOffers = [
    ...(data.best_flights ?? []),
    ...(data.other_flights ?? []),
  ];
  if (returnOffers.length === 0) return undefined;

  const firstReturnLeg = returnOffers[0].flights[0];
  return {
    time: firstReturnLeg.departure_airport.time,
    airline: firstReturnLeg.airline,
  };
}

// --- 4. הפונקציה הראשית שמחברת הכל ---
async function main() {
  const mode = NONSTOP_ONLY !== "false" ? "ישיר בלבד" : "כולל קונקשן";
  console.log(
    `🔍 מחפש טיסות (${mode}) ל-${DESTINATIONS.length} יעדים: ${DESTINATIONS.join(", ")}`,
  );

  // אוספים דילים מכל היעדים לרשימה אחת. יעד שנופל לא מפיל את השאר.
  const allDeals: FlightDeal[] = [];
  for (const dest of DESTINATIONS) {
    try {
      const deals = await searchFlights(dest);
      console.log(`  ${ORIGIN}→${dest}: נמצאו ${deals.length} טיסות.`);
      allDeals.push(...deals);
    } catch (err: any) {
      console.error(`  ⚠️ שגיאה ביעד ${dest}: ${err.message}`);
    }
  }

  // אם אף יעד לא החזיר שום דבר מ-SerpApi — הודעת "פעימת לב" אחת (הבוט חי, פשוט אין נתונים).
  if (allDeals.length === 0) {
    const heartbeat =
      `✅ הבוט רץ ותקין — כרגע אין נתוני טיסות מ-${ORIGIN} ` +
      `לאף אחד מהיעדים (${DESTINATIONS.join("/")}). אבדוק שוב בריצה הבאה.`;
    await notify(heartbeat);
    return;
  }

  const criteria = {
    fromHour: parseInt(DEPART_FROM_HOUR),
    toHour: parseInt(DEPART_TO_HOUR),
    maxPrice: parseFloat(MAX_PRICE_EUR),
  };

  // חדש: דיווח נפרד לכל יעד, תמיד — גם אם לא נמצאה בו טיסה מתאימה.
  // קריאת חזור אחת לכל היותר ליעד (כלומר עד DESTINATIONS.length קריאות
  // חזור בסך הכול לריצה, לא יותר), כדי לא לפוצץ את מכסת SerpApi.
  for (const dest of DESTINATIONS) {
    const destDeals = allDeals.filter((d) => d.destination === dest);
    const goodDeals = filterDeals(destDeals, criteria);

    if (goodDeals.length === 0) {
      const note =
        `❌ ${dest}: לא נמצאה טיסה ישירה מתחת ל-${MAX_PRICE_EUR}€ ` +
        `ל-${ADULTS} נוסעים (תאריכים ${DEPART_DATE}→${RETURN_DATE}).`;
      await notify(note);
      console.log(`ℹ️ אין דיל ל-${dest}.`);
      continue;
    }

    goodDeals.sort((a, b) => a.price - b.price);
    const cheapest = goodDeals[0];

    // קריאה שנייה: מביאים את שעת + חברת החזור של הזולה ביותר ליעד הזה
    if (cheapest.departureToken && cheapest.destination) {
      const ret = await fetchReturnInfo(
        cheapest.destination,
        cheapest.departureToken,
      );
      if (ret) {
        cheapest.returnTime = ret.time;
        cheapest.returnAirline = ret.airline;
      }
    }

    // מעבירים את מספר הנוסעים כדי שההודעה תציג מחיר לקבוצה + בערך לאדם
    const msg = buildMessage(cheapest, ORIGIN, dest, parseInt(ADULTS));
    await notify(msg);
    console.log(`📲 נשלחה התראה (${dest})!`);
  }
}

main().catch(async (err) => {
  console.error("שגיאה:", err.message);
  // אם הקוד נפל — מנסים להודיע בטלגרם כדי שתדע מיד שיש תקלה.
  try {
    if (
      TELEGRAM_BOT_TOKEN &&
      CHAT_IDS.length > 0 &&
      !TELEGRAM_BOT_TOKEN.includes("הדבק")
    ) {
      await notify(`⚠️ תקלה בבוט הטיסות:\n${err.message}`);
    }
  } catch {
    console.error("גם שליחת הודעת השגיאה לטלגרם נכשלה.");
  }
  process.exit(1);
});
