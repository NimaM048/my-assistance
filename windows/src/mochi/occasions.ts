// Persian occasions — Mochi dresses up and celebrates with you.
//
// The Persian (Solar Hijri) calendar comes from the browser's own ICU data
// (Intl, "persian" calendar), so this works offline and never needs updating.

import { profileStore } from "../core/profile";
import { sharedStore } from "../core/shared";
import { growthStore, wornOutfit, type GrowthState, type Outfit } from "./growth";

export type OccasionId = "nowruz" | "sizdah" | "chaharshanbe" | "yalda" | "birthday";

export interface Occasion {
  id: OccasionId;
  /** English title, translated in the Hub. */
  title: string;
  /** The Persian greeting, always shown in Persian. */
  greeting: string;
  emoji: string;
  /** One English line inviting you to celebrate, translated in the Hub. */
  invite: string;
  /** Slots the occasion dresses Mochi in, on top of the wardrobe. */
  outfit: Outfit;
  /** What drifts around Mochi now and then. */
  particle: "petal" | "seed" | "ember" | "confetti";
  /** Two colours for banners. */
  colors: [string, string];
}

export const OCCASIONS: Record<OccasionId, Occasion> = {
  nowruz: { id: "nowruz", title: "Happy Nowruz!", greeting: "نوروزت پیروز! 🌱", emoji: "🌱", invite: "Mochi set the haft-sin for you — come and see.", outfit: { hat: "sabzeh" }, particle: "petal", colors: ["#7ddc8a", "#ffb3c7"] },
  sizdah: { id: "sizdah", title: "Happy Sizdah Bedar!", greeting: "سیزده‌به‌در خوش بگذره! 🌿", emoji: "🌿", invite: "Out to nature! Tie a knot in the sabzeh with Mochi.", outfit: { hat: "flowers", face: "sunglasses" }, particle: "petal", colors: ["#9be37a", "#7cc9ff"] },
  chaharshanbe: { id: "chaharshanbe", title: "Chaharshanbe Suri", greeting: "زردی من از تو، سرخی تو از من 🔥", emoji: "🔥", invite: "The fire is lit — jump over it with Mochi.", outfit: { neck: "scarf" }, particle: "ember", colors: ["#ffb347", "#ff5e4d"] },
  yalda: { id: "yalda", title: "Happy Yalda night!", greeting: "شب یلدات مبارک 🍉", emoji: "🍉", invite: "The longest night — Mochi has a Hafez fortune for you.", outfit: { hat: "pomegranate", neck: "scarf" }, particle: "seed", colors: ["#e8384f", "#7d3c98"] },
  birthday: { id: "birthday", title: "Happy birthday!", greeting: "تولدت مبارک! 🎂", emoji: "🎂", invite: "Mochi baked you a cake. Make a wish!", outfit: { hat: "party" }, particle: "confetti", colors: ["#ff8fb8", "#ffd36e"] },
};

export interface PersianDate {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const fmt = new Intl.DateTimeFormat("en-u-ca-persian", { year: "numeric", month: "numeric", day: "numeric" });

export function persianDate(d: Date): PersianDate {
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: d.getDay() };
}

/** Development only: pretend it's an occasion today (set from the playground). */
export const occasionOverride = sharedStore<{ id: OccasionId | null }>("coucou.dev.occasion", () => ({ id: null }));

/** The occasion for a date, if any. */
export function occasionFor(date = new Date()): Occasion | null {
  if (import.meta.env.DEV) {
    const forced = occasionOverride.read().id;
    if (forced) return occasionWithName(OCCASIONS[forced]);
  }
  return occasionOn(date);
}

/** The next few occasions, each counted from its first day. */
export function upcomingOccasions(from = new Date(), limit = 4): { occasion: Occasion; date: Date; days: number }[] {
  const out: { occasion: Occasion; date: Date; days: number }[] = [];
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  let previous = occasionOn(new Date(start.getTime() - 86_400_000))?.id;
  for (let days = 0; days < 370 && out.length < limit; days++) {
    const date = new Date(start.getTime() + days * 86_400_000);
    const occ = occasionOn(date);
    if (occ && occ.id !== previous) out.push({ occasion: occ, date, days });
    previous = occ?.id;
  }
  return out;
}

function occasionOn(date: Date): Occasion | null {
  const p = persianDate(date);
  const bday = profileStore.read().birthday;
  if (bday && bday.month === p.month && bday.day === p.day) return occasionWithName(OCCASIONS.birthday);
  // Born on Esfand 30: in years without one, celebrate on the last day of Esfand.
  if (bday && bday.month === 12 && bday.day === 30 && p.month === 12 && p.day === 29
    && persianDate(new Date(date.getTime() + 86_400_000)).month === 1) return occasionWithName(OCCASIONS.birthday);
  if (p.month === 1 && p.day <= 12) return OCCASIONS.nowruz;
  if (p.month === 1 && p.day === 13) return OCCASIONS.sizdah;
  if (p.month === 9 && p.day === 30) return OCCASIONS.yalda;
  // The last Tuesday of the year: a week later it is already Farvardin.
  if (p.month === 12 && p.weekday === 2 && persianDate(new Date(date.getTime() + 7 * 86_400_000)).month === 1) {
    return OCCASIONS.chaharshanbe;
  }
  return null;
}

function occasionWithName(o: Occasion): Occasion {
  if (o.id !== "birthday") return o;
  const name = profileStore.read().name.trim();
  return name ? { ...o, greeting: `تولدت مبارک \u2068${name}\u2069! 🎂` } : o;
}

/** What Mochi wears right now: the wardrobe, dressed up for today's occasion. */
export function currentLook(s?: GrowthState): Outfit {
  const worn = wornOutfit(s);
  const occ = occasionFor();
  return occ ? { ...worn, ...occ.outfit } : worn;
}

/** Calls `fn` with the new look whenever the wardrobe, your birthday or (in development) the pretend occasion changes. */
export function onLookChange(fn: (look: Outfit) => void): () => void {
  const offs = [
    growthStore.subscribe((s) => fn(currentLook(s))),
    profileStore.subscribe(() => fn(currentLook())),
  ];
  if (import.meta.env.DEV) offs.push(occasionOverride.subscribe(() => fn(currentLook())));
  return () => offs.forEach((off) => off());
}

/** A Hafez couplet for Yalda night's fortune ("fal-e Hafez"). */
export const HAFEZ: [string, string][] = [
  ["الا یا ایها الساقی ادر کأساً و ناولها", "که عشق آسان نمود اول ولی افتاد مشکل‌ها"],
  ["یوسف گم گشته بازآید به کنعان غم مخور", "کلبه احزان شود روزی گلستان غم مخور"],
  ["گر چه منزل بس خطرناک است و مقصد بس بعید", "هیچ راهی نیست کان را نیست پایان غم مخور"],
  ["صبا به لطف بگو آن غزال رعنا را", "که سر به کوه و بیابان تو داده‌ای ما را"],
  ["دوش دیدم که ملائک در میخانه زدند", "گل آدم بسرشتند و به پیمانه زدند"],
  ["اگر آن ترک شیرازی به دست آرد دل ما را", "به خال هندویش بخشم سمرقند و بخارا را"],
  ["بیا تا گل برافشانیم و می در ساغر اندازیم", "فلک را سقف بشکافیم و طرحی نو دراندازیم"],
  ["شب تاریک و بیم موج و گردابی چنین هایل", "کجا دانند حال ما سبکباران ساحل‌ها"],
  ["درخت دوستی بنشان که کام دل به بار آرد", "نهال دشمنی برکن که رنج بی‌شمار آرد"],
  ["سال‌ها دل طلب جام جم از ما می‌کرد", "وان چه خود داشت ز بیگانه تمنا می‌کرد"],
  ["مژده ای دل که مسیحا نفسی می‌آید", "که ز انفاس خوشش بوی کسی می‌آید"],
  ["ستاره‌ای بدرخشید و ماه مجلس شد", "دل رمیده ما را انیس و مونس شد"],
  ["دلا بسوز که سوز تو کارها بکند", "نیاز نیم‌شبی دفع صد بلا بکند"],
  ["رواق منظر چشم من آشیانه توست", "کرم نما و فرود آ که خانه خانه توست"],
  ["نفس باد صبا مشک‌فشان خواهد شد", "عالم پیر دگرباره جوان خواهد شد"],
  ["ما ز یاران چشم یاری داشتیم", "خود غلط بود آن چه ما پنداشتیم"],
  ["در ازل پرتو حسنت ز تجلی دم زد", "عشق پیدا شد و آتش به همه عالم زد"],
  ["حافظ از باد خزان در چمن دهر مرنج", "فکر معقول بفرما گل بی‌خار کجاست"],
  ["عیب رندان مکن ای زاهد پاکیزه‌سرشت", "که گناه دگران بر تو نخواهند نوشت"],
  ["هر آن کسی که در این حلقه نیست زنده به عشق", "بر او نمرده به فتوای من نماز کنید"],
];
