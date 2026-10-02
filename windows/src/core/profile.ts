// A little about you, kept on this PC: the name Mochi greets you by and your
// birthday (in the Persian calendar). Shared by every Coucou window.

import { sharedStore } from "./shared";

export interface Profile {
  name: string;
  /** Persian calendar month (1–12) and day. */
  birthday: { month: number; day: number } | null;
}

export const profileStore = sharedStore<Profile>("coucou.profile.v1", () => ({ name: "", birthday: null }), (p) => ({
  name: typeof p.name === "string" ? p.name.slice(0, 40) : "",
  birthday: p.birthday && Number(p.birthday.month) >= 1 && Number(p.birthday.month) <= 12 && Number(p.birthday.day) >= 1 && Number(p.birthday.day) <= 31
    ? { month: Number(p.birthday.month), day: Number(p.birthday.day) }
    : null,
}));

export const PERSIAN_MONTHS = [
  "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
  "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand",
];

export const PERSIAN_MONTHS_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];
