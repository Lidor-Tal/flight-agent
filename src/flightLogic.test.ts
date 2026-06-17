// ============================================================
//  flightLogic.test.ts — בדיקות יחידה ללוגיקה של הסוכן
// ============================================================
// מריצים עם: npm test
// אף בדיקה כאן לא פונה לרשת אמיתית — אפס קריאות API, אפס עלות.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  filterDeals,
  buildMessage,
  sendTelegram,
  FlightDeal,
} from "./flightLogic.js";

// כמה טיסות לדוגמה שנשתמש בהן בבדיקות
const sampleDeals: FlightDeal[] = [
  { price: 300, departTime: "2026-09-03 08:30", airline: "Blue Bird" }, // בוקר, זול
  { price: 1200, departTime: "2026-09-03 10:00", airline: "Aegean" },  // בוקר, יקר
  { price: 250, departTime: "2026-09-03 20:00", airline: "Arkia" },    // ערב, זול
];

// ============================================================
//  קבוצת בדיקות 1: filterDeals (סינון לפי שעה + מחיר)
// ============================================================
describe("filterDeals", () => {
  it("מחזיר רק טיסות בתוך חלון השעות", () => {
    // חלון 7-12 בבוקר -> אמורות לעבור 2 הטיסות של הבוקר בלבד
    const result = filterDeals(sampleDeals, {
      fromHour: 7,
      toHour: 12,
      maxPrice: 9999,
    });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.airline)).toEqual(["Blue Bird", "Aegean"]);
  });

  it("מסנן החוצה טיסות מעל המחיר המקסימלי", () => {
    // מחיר מקסימלי 500 -> הטיסה של 1200 (Aegean) צריכה ליפול
    const result = filterDeals(sampleDeals, {
      fromHour: 0,
      toHour: 23,
      maxPrice: 500,
    });
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.price <= 500)).toBe(true);
  });

  it("משלב גם שעה וגם מחיר יחד", () => {
    // בוקר (7-12) + מתחת ל-500 -> רק Blue Bird (300)
    const result = filterDeals(sampleDeals, {
      fromHour: 7,
      toHour: 12,
      maxPrice: 500,
    });
    expect(result).toHaveLength(1);
    expect(result[0].airline).toBe("Blue Bird");
  });

  it("מחזיר רשימה ריקה כשאין התאמה", () => {
    const result = filterDeals(sampleDeals, {
      fromHour: 3,
      toHour: 5, // אין טיסות בשעות האלה
      maxPrice: 9999,
    });
    expect(result).toEqual([]);
  });
});

// ============================================================
//  קבוצת בדיקות 2: buildMessage (בניית טקסט ההודעה)
// ============================================================
describe("buildMessage", () => {
  it("מכיל את כל פרטי הטיסה בהודעה", () => {
    const msg = buildMessage(sampleDeals[0], "TLV", "KGS");
    expect(msg).toContain("TLV");
    expect(msg).toContain("KGS");
    expect(msg).toContain("Blue Bird");
    expect(msg).toContain("300");
    expect(msg).toContain("2026-09-03 08:30");
  });

  it("מציג שורת חזור רק כשיש returnTime", () => {
    // בלי חזור — אין שורת "חזרה"
    const withoutReturn = buildMessage(sampleDeals[0], "TLV", "KGS");
    expect(withoutReturn).not.toContain("חזרה");

    // עם חזור — השורה מופיעה עם השעה
    const withReturn = buildMessage(
      { ...sampleDeals[0], returnTime: "2026-09-06 18:20" },
      "TLV",
      "KGS"
    );
    expect(withReturn).toContain("חזרה");
    expect(withReturn).toContain("2026-09-06 18:20");
  });
});

// ============================================================
//  קבוצת בדיקות 3: sendTelegram (עם fetch מזויף!)
// ============================================================
describe("sendTelegram", () => {
  // לפני כל בדיקה: מחליפים את fetch הגלובלי בפונקציה מזויפת
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  // אחרי כל בדיקה: מנקים את הזיוף כדי שלא ידלוף לבדיקה הבאה
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("שולח בקשה לכתובת הנכונה עם הנתונים הנכונים", async () => {
    // מגדירים שה-fetch המזויף יחזיר תשובת הצלחה
    (global.fetch as any).mockResolvedValue({ ok: true });

    await sendTelegram("FAKE_TOKEN", "12345", "שלום");

    // בודקים ש-fetch נקרא בדיוק פעם אחת
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // בודקים שהכתובת מכילה את הטוקן
    const [calledUrl, options] = (global.fetch as any).mock.calls[0];
    expect(calledUrl).toContain("FAKE_TOKEN");
    expect(calledUrl).toContain("sendMessage");

    // בודקים שגוף הבקשה מכיל את ה-chat id ואת הטקסט
    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe("12345");
    expect(body.text).toBe("שלום");
  });

  it("זורק שגיאה אם טלגרם מחזיר כישלון", async () => {
    // הפעם ה-fetch המזויף מחזיר תשובת שגיאה
    (global.fetch as any).mockResolvedValue({ ok: false, status: 401 });

    // מצפים שהפונקציה תזרוק שגיאה
    await expect(
      sendTelegram("BAD_TOKEN", "12345", "שלום")
    ).rejects.toThrow("Telegram failed: 401");
  });
});
