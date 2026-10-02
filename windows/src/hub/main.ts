import "./hub.css";
import { Bridge, IS_TAURI, onEvent, type GitHubCatalog, type GitHubRepository, type GitHubWorkQueue, type ProjectStatus, type ProjectSearchHit, type SearchProject } from "../core/bridge";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { mochiPortrait } from "../mochi/portrait";

type Page = "repositories" | "queue" | "music" | "focus" | "activity";
type Filter = "all" | "public" | "private" | "pinned";
type QueueFilter = "all" | "github" | "reviews" | "local";
type Mood = "focus" | "energy" | "chill";
interface MusicQuery { query: string; taste: string; mood: Mood; at: number }
interface MusicPrefs { tastes: string[]; weights: Record<string, number>; mood: Mood; recent: MusicQuery[] }
type FocusMode = "focus" | "short" | "long";
interface FocusTask { id: string; title: string; repo: string; createdAt: number; doneAt: number | null; kind?: "task" | "note"; note?: string; scheduledFor?: string | null }
interface FocusSession { at: number; minutes: number }
interface FocusData { tasks: FocusTask[]; mode: FocusMode; focusMinutes: number; remaining: number; running: boolean; endAt: number | null; sessions: FocusSession[] }
type ActivityKind = "focus" | "task" | "project";
interface ActivityItem { id: string; kind: ActivityKind; title: string; repo: string; detail: string; at: number; minutes?: number }
type NoticeKind = "approval" | "complete" | "error" | "focus" | "reminder";
interface ReminderPrefs { enabled: boolean; time: string; delivered: string[] }
interface HubNotification { id: string; kind: NoticeKind; title: string; detail: string; project: string; at: number; requestId?: string; read: boolean; status: "pending" | "done" | "expired"; snoozedUntil: number | null }
interface AgentNotificationEvent { id: string; kind: Exclude<NoticeKind, "focus">; title: string; detail: string; project: string; at: number; requestId?: string }
interface ApprovalResolutionEvent { id: string; status: "approved" | "denied" | "closed"; at: number }

const root = document.getElementById("hub-root")!;
const STORE_PINS = "coucou.github.pinned.v1";
const STORE_MUSIC = "coucou.music.preferences.v1";
const STORE_FOCUS = "coucou.focus.v1";
const STORE_ACTIVITY = "coucou.activity.v1";
const STORE_NOTIFICATIONS = "coucou.notifications.v1";
const STORE_NOTIFICATION_PREFS = "coucou.notifications.prefs.v1";
const STORE_REMINDER_PREFS = "coucou.plan.reminders.v1";
const STORE_HUB_LANGUAGE = "coucou.hub.language.v1";
const emptyPrefs = (): MusicPrefs => ({ tastes: ["rap remix", "Persian rap"], weights: {}, mood: "energy", recent: [] });
type HubLanguage = "en" | "fa";
const savedHubLanguage = localStorage.getItem(STORE_HUB_LANGUAGE);
let hubLanguage: HubLanguage = savedHubLanguage === "fa" || (!savedHubLanguage && navigator.language.toLowerCase().startsWith("fa")) ? "fa" : "en";
const FA_COPY: Record<string, string> = {
  "Your workspace, together": "همه‌چیزِ فضای کاری‌ات، یک‌جا",
  "Projects": "پروژه‌ها", "Music for work": "موسیقی برای کار", "Focus & tasks": "تمرکز و کارها", "Daily history": "گزارش روزانه",
  "Connected account": "حساب متصل", "See local Git activity and open your GitHub projects.": "فعالیت محلی Git را ببین و پروژه‌های GitHub را باز کن.",
  "Refresh": "به‌روزرسانی", "Search Coucou Hub": "جست‌وجو در پنل Coucou", "Open notifications": "بازکردن اعلان‌ها", "Notifications": "اعلان‌ها",
  "Workspace": "فضای کاری", "Free by design": "رایگان، از ابتدا", "Local preferences and GitHub's free API. No paid add-on.": "تنظیمات روی دستگاه و API رایگان GitHub؛ بدون افزونهٔ پولی.",
  "COUCOU WORKSPACE": "فضای کاری COUCOU",
  "Surprise me": "غافلگیرم کن", "Quick capture": "ثبت سریع", "A little music discovery, tuned to your taste.": "موسیقی‌های تازه، هماهنگ با سلیقهٔ تو.",
  "A private, local timeline of your work.": "گزارش خصوصی و محلی از کارهای روزانه‌ات.", "Plan today's work and protect a little time to focus.": "کارهای امروز را برنامه‌ریزی کن و زمانی برای تمرکز کنار بگذار.",
  "on GitHub": "در GitHub", "Local clones": "نسخه‌های محلی", "found on this PC": "پیداشده در این رایانه", "Needs attention": "نیازمند رسیدگی", "with uncommitted changes": "با تغییرات ثبت‌نشده",
  "Search by name, description or language…": "جست‌وجو بر اساس نام، توضیح یا زبان…", "All": "همه", "Public": "عمومی", "Private": "خصوصی", "Pinned": "سنجاق‌شده",
  "Recently updated": "تازه‌به‌روزشده", "Most stars": "بیشترین ستاره", "Name A–Z": "نام، الف تا ی", "No repositories match these filters.": "پروژه‌ای با این فیلترها پیدا نشد.", "No repositories found.": "پروژه‌ای پیدا نشد.",
  "Loading your repositories…": "در حال بارگذاری پروژه‌ها…", "GitHub could not be reached": "اتصال به GitHub برقرار نشد", "Settings": "تنظیمات", "Try again": "تلاش دوباره",
  "Fork": "انشعابی", "Archived": "بایگانی‌شده", "No description yet.": "هنوز توضیحی ثبت نشده.", "Open Code": "بازکردن کد", "Clone URL": "نشانی Clone", "GitHub": "GitHub", "Pin": "سنجاق", "Unpin": "برداشتن سنجاق",
  "Updated": "به‌روزرسانی‌شده", "shown": "نمایش", "Updated just now": "همین الان به‌روز شد", "Updated today": "امروز به‌روز شد",
  "Add a sound you like…": "سبکی که دوست داری اضافه کن…", "e.g. Persian rap remix for night drive": "مثلاً ریمیکس رپ فارسی برای رانندگی شبانه", "Remove preference": "حذف سلیقه", "Add": "افزودن", "Focus": "تمرکز", "High energy": "پرانرژی", "Chill": "آرام",
  "Your searches will show up here. Rate a vibe to tune future random picks.": "جست‌وجوهایت اینجا می‌آیند. به سلیقه‌ها امتیاز بده تا پیشنهادهای بعدی بهتر شوند.", "Search again": "جست‌وجوی دوباره", "More like this": "بیشتر از این سبک", "Less like this": "کمتر از این سبک",
  "YOUTUBE MUSIC": "YOUTUBE MUSIC", "Soundtrack your focus": "موسیقیِ زمان تمرکزت", "Coucou remembers the vibes you add and tunes random music searches with your feedback.": "Coucou سلیقه‌هایی را که اضافه می‌کنی به خاطر می‌سپارد و جست‌وجوهای موسیقی را با بازخوردت هماهنگ می‌کند.",
  "Find a vibe": "یک حال‌وهوا پیدا کن", "Search YouTube Music using your own words.": "با عبارت دلخواهت در YouTube Music جست‌وجو کن.", "Search": "جست‌وجو", "What do you like?": "چه سبکی دوست داری؟", "Saved only on this device. Add or remove styles anytime.": "فقط روی همین دستگاه ذخیره می‌شود؛ هر زمان خواستی سبک‌ها را اضافه یا حذف کن.", "Pick a mood": "حال‌وهوا را انتخاب کن", "Recent discoveries": "جست‌وجوهای اخیر",
  "Free tier: YouTube Music plays with ads. Coucou opens a search; choose a result and press play. Music background play may require YouTube Music Premium.": "نسخهٔ رایگان YouTube Music همراه تبلیغ است. Coucou جست‌وجو را باز می‌کند تا نتیجه‌ای را انتخاب و پخش کنی. پخش در پس‌زمینه ممکن است به اشتراک Premium نیاز داشته باشد.",
  "Focused": "زمان تمرکز", "minutes": "دقیقه", "Tasks completed": "کارهای انجام‌شده", "Projects opened": "پروژه‌های بازشده", "unique": "پروژهٔ یکتا", "A quiet day so far": "امروز هنوز خلوت بوده", "Completed focus sessions, tasks and project opens will show up here.": "جلسه‌های تمرکز، کارهای انجام‌شده و پروژه‌هایی که باز کرده‌ای اینجا ثبت می‌شوند.",
  "LOCAL WORK LOG": "گزارش محلی کار", "Today": "امروز", "Saved locally on this device. No activity is sent to a service.": "گزارش فقط روی همین دستگاه ذخیره می‌شود و برای هیچ سرویسی فرستاده نمی‌شود.", "Focus session completed": "جلسهٔ تمرکز تمام شد", "Task completed": "کار انجام شد",
  "Still to do": "کارهای باقی‌مانده", "Done today": "انجام‌شدهٔ امروز", "Focus today": "تمرکز امروز", "Your list is clear": "فهرستت خالی است", "Add a task and make the next step easy.": "کاری اضافه کن تا قدم بعدی روشن باشد.",
  "Remove task": "حذف کار", "What needs your attention?": "چه کاری در اولویت است؟", "General": "عمومی", "YOUR PLAN": "برنامهٔ تو", "Today's next steps": "قدم‌های بعدی امروز", "POMODORO": "پومودورو", "Make room to focus": "برای تمرکز وقت بگذار", "Short break": "استراحت کوتاه", "Long break": "استراحت بلند", "Pause": "مکث", "Resume": "ادامه", "Start focus": "شروع تمرکز", "IN SESSION": "در حال انجام", "READY": "آماده", "FOCUS SESSION": "جلسهٔ تمرکز", "Session": "جلسه", "open": "باز",
  "YOUR INBOX": "صندوق اعلان‌ها", "Mark all read": "خواندن همه", "Close": "بستن", "Notifications stay on this device. Snoozed items return when the timer ends.": "اعلان‌ها روی همین دستگاه می‌مانند. یادآوری‌های تعویق‌افتاده پس از پایان زمان برمی‌گردند.", "You're all caught up": "همه‌چیز مرتب است", "Prompt completions, approvals and focus reminders will appear here.": "پایان پرامپت‌ها، تأییدهای در انتظار و یادآوری‌های تمرکز اینجا نمایش داده می‌شوند.", "Remind me in one minute": "یک دقیقهٔ دیگر یادآوری کن", "Review": "بررسی", "Snooze for 15 minutes": "تعویق ۱۵ دقیقه‌ای", "Snooze for 1 hour": "تعویق یک‌ساعته", "Mark as read": "علامت‌گذاری به‌عنوان خوانده‌شده", "Read": "خوانده‌شده",
  "Search pages, repositories, actions…": "جست‌وجوی صفحه‌ها، پروژه‌ها و کارها…", "↑↓ navigate": "↑↓ جابه‌جایی", "↵ open": "↵ بازکردن", "Ctrl K close": "Ctrl K بستن", "No matching command or repository.": "کار یا پروژه‌ای پیدا نشد.",
  "QUICK CAPTURE": "ثبت سریع", "Save it before it slips away": "قبل از فراموشی ثبتش کن", "Title": "عنوان", "Note": "یادداشت", "Project": "پروژه", "Give it a short title": "عنوان کوتاهی بنویس", "Add a note or a little context…": "یادداشت یا توضیح کوتاهی اضافه کن…", "Ctrl + Enter to save · Esc to close": "Ctrl + Enter برای ذخیره · Esc برای بستن", "Save": "ذخیره", "Task": "کار",
  "New": "جدید", "Closed": "بسته‌شده", "Waiting for your decision": "در انتظار تصمیم تو", "Approved in Coucou": "در Coucou تأیید شد", "Denied in Coucou": "در Coucou رد شد", "No longer waiting for approval": "دیگر منتظر تأیید نیست", "Mute popups": "بی‌صداکردن اعلان‌ها", "Popups muted": "اعلان‌ها بی‌صدا هستند", "unread": "خوانده‌نشده", "Snoozed until": "یادآوری در", "Approval needed": "نیاز به تأیید", "Reminder": "یادآوری",
  "More": "بیشتر", "Less": "کمتر", "in your mixes": "در ترکیب‌های موسیقی‌ات", "in random picks": "در پیشنهادهای تصادفی", "notifications are back": "اعلان دوباره نمایش داده می‌شود",
  "Copy clone URL": "کپی نشانی Clone", "Clone URL copied": "نشانی Clone کپی شد", "Unpin repository": "برداشتن سنجاق پروژه", "Pin repository": "سنجاق‌کردن پروژه", "Pinned in Coucou": "در Coucou سنجاق شد", "Removed from pinned": "از سنجاق‌شده‌ها برداشته شد",
  "Browse GitHub repositories and local Git status": "مرور پروژه‌های GitHub و وضعیت محلی Git", "Save a task or note to a project · Ctrl Shift N": "ثبت کار یا یادداشت برای یک پروژه · Ctrl Shift N", "Open your daily task list and focus timer": "بازکردن فهرست کارها و زمان‌سنج تمرکز", "Review focus sessions, completed tasks and opened projects": "مرور جلسه‌های تمرکز، کارهای انجام‌شده و پروژه‌های بازشده", "Review, mute or snooze Coucou alerts": "مرور، بی‌صداکردن یا تعویق اعلان‌های Coucou", "Open your music preferences and mixes": "بازکردن سلیقه‌های موسیقی و ترکیب‌ها", "Search YouTube Music using your saved taste": "جست‌وجو در YouTube Music بر اساس سلیقهٔ ذخیره‌شده", "Fetch the latest repository details": "گرفتن تازه‌ترین اطلاعات پروژه‌ها", "Refresh repositories": "به‌روزرسانی پروژه‌ها", "Surprise me with music": "با موسیقی غافلگیرم کن",
  "Open on GitHub": "در GitHub باز شد", "Opened in VS Code": "در VS Code باز شد", "today": "امروز", "yesterday": "دیروز", "recently": "به‌تازگی", "Clean": "بدون تغییر", "No commits": "بدون Commit", "Local clone found": "نسخهٔ محلی پیدا شد", "Reading local Git status…": "در حال خواندن وضعیت محلی Git…", "Detached HEAD": "شاخهٔ جداشده",
  "Attach to a repository": "اتصال به یک پروژه", "Complete task": "انجام کار", "Mark as not done": "برگرداندن به انجام‌نشده", "Reset timer": "بازنشانی زمان‌سنج", "Switch language": "تغییر زبان", "minutes done. Take a breath or start a short break.": "دقیقه تمرکز کردی. کمی استراحت کن یا وقفهٔ کوتاهی شروع کن.", "Ready for another focus session?": "برای یک جلسهٔ تمرکز دیگر آماده‌ای؟",
  "Tasks": "تسک‌ها", "Notes": "یادداشت‌ها", "Add task": "افزودن تسک", "Add note": "یادداشت جدید", "Remove note": "حذف یادداشت", "No tasks yet": "هنوز تسکی اضافه نشده", "Nothing to note yet": "هنوز یادداشتی ثبت نشده", "Keep ideas and project details here for later.": "ایده‌ها و جزئیات پروژه را برای بعد اینجا نگه دار.",
};
Object.assign(FA_COPY, {
  "Due date": "تاریخ انجام",
  "Reminder date": "تاریخ یادآوری",
  "Reminder date (optional)": "تاریخ یادآوری (اختیاری)",
  "No reminder": "بدون یادآوری",
  "Add date": "افزودن تاریخ",
  "Today ·": "امروز ·",
  "Tomorrow ·": "فردا ·",
  "Overdue ·": "عقب‌افتاده ·",
  "Daily reminders": "یادآوری روزانه",
  "Choose when Coucou checks your plan": "زمان بررسی برنامه را انتخاب کن",
  "Repeat unfinished tasks each day": "تسک‌های ناتمام هر روز یادآوری می‌شوند",
  "Tasks repeat until done · notes remind once": "تسک‌ها تا انجام تکرار می‌شوند · یادداشت‌ها یک‌بار یادآوری می‌شوند",
  "On": "روشن",
  "Off": "خاموش",
  "Allow notifications": "فعال‌کردن اعلان‌ها",
  "Windows notification permission was not granted.": "مجوز اعلان‌های ویندوز داده نشد.",
  "Desktop notifications are available in the installed app. Your reminders are still saved in Coucou's inbox.": "اعلان دسکتاپ در نسخهٔ نصب‌شده فعال است؛ یادآورها در صندوق اعلان‌های Coucou هم ذخیره می‌شوند.",
  "Today's plan": "برنامهٔ امروز",
  "Overdue tasks": "تسک‌های عقب‌افتاده",
  "Scheduled notes": "یادداشت‌های زمان‌بندی‌شده",
  "tasks are due": "تسک سررسید شده",
  "tasks are still open": "تسک هنوز انجام نشده",
  "scheduled for today": "برای امروز زمان‌بندی شده",
  "Use system notifications and your Coucou inbox.": "از اعلان‌های سیستم و صندوق اعلان‌های Coucou استفاده کن.",
  "Reminders are off": "یادآورها خاموش‌اند",
  "Your reminder time": "زمان یادآوری",
  "The task is scheduled for today by default.": "تسک به‌صورت پیش‌فرض برای امروز ثبت می‌شود.",
  "Optional date for this note": "تاریخ این یادداشت اختیاری است",
  "Plan date": "تاریخ برنامه",
  "Plan your work": "کارهایت را برنامه‌ریزی کن",
  "Today": "امروز",
  "Tomorrow": "فردا",
  "Overdue": "عقب‌افتاده",
  "Daily reminders enabled": "یادآوری روزانه فعال شد",
  "Desktop notifications need the Coucou app.": "برای اعلان دسکتاپ باید برنامهٔ Coucou باز باشد.",
});
const EN_COPY = Object.fromEntries(Object.entries(FA_COPY).map(([en, fa]) => [fa, en]));
Object.assign(FA_COPY, {
  "Work queue": "صف کار", "Your next actions, gathered in one place.": "کارهای بعدی‌ات، یک‌جا و مرتب‌شده.",
  "Open items": "موارد باز", "Review requests": "درخواست‌های بازبینی", "Focus tasks": "کارهای تمرکز",
  "All work": "همه", "GitHub issues & PRs": "Issue و PRهای GitHub", "Reviews": "بازبینی‌ها", "Local tasks": "کارهای محلی",
  "Search titles, projects or labels…": "جست‌وجوی عنوان، پروژه یا برچسب…", "Review requested": "درخواست بازبینی", "Pull request": "درخواست ادغام", "Issue assigned": "Issue واگذارشده",
  "Open in GitHub": "بازکردن در GitHub", "Mark complete": "انجام شد", "No work matches this view.": "کاری با این فیلتر پیدا نشد.",
  "Open project": "بازکردن پروژه", "Refresh work queue": "به‌روزرسانی صف کار", "Sync your assigned GitHub work": "همگام‌سازی کارهای واگذارشدهٔ GitHub",
  "Nothing is waiting for you": "کاری در صف نیست", "Assigned work and requested reviews from GitHub will show up here.": "کارهای واگذارشده و درخواست‌های بازبینی GitHub اینجا نمایش داده می‌شوند.",
  "Connect GitHub to see assigned issues and review requests.": "برای دیدن Issueها و درخواست‌های بازبینی، GitHub را متصل کن.", "Some review requests could not be loaded.": "بارگذاری بعضی درخواست‌های بازبینی انجام نشد.",
  "Priority": "اولویت", "Urgent": "فوری", "High": "بالا", "Normal": "عادی", "Updated": "به‌روزرسانی‌شده", "comments": "نظر",
  "Focus task": "کار تمرکز", "No labels": "بدون برچسب", "Your personal task": "کار شخصی تو", "Syncing GitHub work…": "در حال همگام‌سازی کارهای GitHub…", "Complete": "انجام شد", "Draft": "پیش‌نویس",
  "Open your daily task list and focus timer": "بازکردن فهرست کارها و زمان‌سنج تمرکز", "See assigned issues and review requests alongside your focus tasks": "دیدن Issueها و درخواست‌های بازبینی کنار کارهای تمرکزت",
});
Object.assign(EN_COPY, Object.fromEntries(Object.entries(FA_COPY).map(([en, fa]) => [fa, en])));
Object.assign(FA_COPY, {
  "Search local project files": "\u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0641\u0627\u06cc\u0644\u200c\u0647\u0627\u06cc \u067e\u0631\u0648\u0698\u0647",
  "Find files, TODOs and code across your local projects.": "\u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0641\u0627\u06cc\u0644\u200c\u0647\u0627\u060c TODO\u0647\u0627 \u0648 \u06a9\u062f \u062f\u0631 \u067e\u0631\u0648\u0698\u0647\u200c\u0647\u0627\u06cc \u0645\u062d\u0644\u06cc",
  "Search file names and text...": "\u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0646\u0627\u0645 \u0641\u0627\u06cc\u0644 \u0648 \u0645\u062a\u0646...",
  "All local projects": "\u0647\u0645\u0647\u200c\u06cc \u067e\u0631\u0648\u0698\u0647\u200c\u0647\u0627\u06cc \u0645\u062d\u0644\u06cc",
  "Type at least 2 characters to search.": "\u0628\u0631\u0627\u06cc \u062c\u0633\u062a\u200c\u0648\u062c\u0648\u060c \u062d\u062f\u0627\u0642\u0644 ۲ \u06a9\u0627\u0631\u0627\u06a9\u062a\u0631 \u0648\u0627\u0631\u062f \u06a9\u0646.",
  "Searchingâ€¦": "\u062f\u0631 \u062d\u0627\u0644 \u062c\u0633\u062a\u200c\u0648\u062c\u0648â€¦",
  "No matching files or text found.": "\u0641\u0627\u06cc\u0644 \u06cc\u0627 \u0645\u062a\u0646\u06cc \u0645\u0646\u0637\u0628\u0642 \u067e\u06cc\u062f\u0627 \u0646\u0634\u062f.",
  "No local projects available. Connect GitHub and clone a project first.": "\u067e\u0631\u0648\u0698\u0647\u200c\u06cc \u0645\u062d\u0644\u06cc \u062f\u0631 \u062f\u0633\u062a\u0631\u0633 \u0646\u06cc\u0633\u062a. \u0627\u0628\u062a\u062f\u0627 GitHub \u0631\u0627 \u0645\u062a\u0635\u0644 \u0648 \u06cc\u06a9 \u067e\u0631\u0648\u0698\u0647 \u0631\u0627 clone \u06a9\u0646.",
  "Search stays on this device. Generated folders and large/binary files are skipped.": "\u062c\u0633\u062a\u200c\u0648\u062c\u0648 \u0641\u0642\u0637 \u0631\u0648\u06cc \u0627\u06cc\u0646 \u062f\u0633\u062a\u06af\u0627\u0647 \u0627\u0646\u062c\u0627\u0645 \u0645\u06cc\u200c\u0634\u0648\u062f\u061b \u067e\u0648\u0634\u0647\u200c\u0647\u0627\u06cc \u062e\u0631\u0648\u062c\u06cc \u0648 \u0641\u0627\u06cc\u0644\u200c\u0647\u0627\u06cc \u0628\u0632\u0631\u06af \u06cc\u0627 \u062f\u0648\u062f\u0648\u06cc\u06cc \u0646\u0627\u062f\u06cc\u062f\u0647 \u06af\u0631\u0641\u062a\u0647 \u0645\u06cc\u200c\u0634\u0648\u0646\u062f.",
  "File name": "\u0646\u0627\u0645 \u0641\u0627\u06cc\u0644", "Text match": "\u0645\u0637\u0627\u0628\u0642\u062a \u0645\u062a\u0646", "Open in VS Code": "\u0628\u0627\u0632\u06a9\u0631\u062f\u0646 \u062f\u0631 VS Code",
});
Object.assign(EN_COPY, Object.fromEntries(Object.entries(FA_COPY).map(([en, fa]) => [fa, en])));
let page: Page = "repositories";
let filter: Filter = "all";
let query = "";
let queueFilter: QueueFilter = "all";
let queueSearch = "";
let queueData: GitHubWorkQueue | null = null;
let queueLoading = false;
let queueError = "";
let sortBy = "updated";
let catalog: GitHubCatalog | null = null;
const projectStatuses = new Map<string, ProjectStatus>();
const localStatusLoading = new Set<string>();
let loading = false;
let loadError = "";
let pinned = readPins();
let prefs = readPrefs();
let toastTimer = 0;
let focus = readFocus();
let focusTick = 0;
let activities = readActivities();
let notifications = readNotifications();
let notificationsMuted = readNotificationPrefs();
let reminderPrefs = readReminderPrefs();
let activityDay = dayKey(Date.now());

function localeCode() { return hubLanguage === "fa" ? "fa-IR-u-ca-persian" : "en-US"; }
function formatNumber(value: number) { return new Intl.NumberFormat(localeCode()).format(value); }
function formatDate(date: Date, options: Intl.DateTimeFormatOptions) { return date.toLocaleDateString(localeCode(), options); }
function formatTime(date: Date) { return date.toLocaleTimeString(localeCode(), { hour: "numeric", minute: "2-digit" }); }
function translateText(value: string): string {
  const source = value.trim();
  let translated = hubLanguage === "fa" ? FA_COPY[source] : EN_COPY[source];
  if (!translated && hubLanguage === "fa") {
    const commentMatch = source.match(/^(\d+) comments?$/);
    if (commentMatch) translated = `${formatNumber(Number(commentMatch[1]))} نظر`;
    let match = source.match(/^(\d+) shown$/); if (match) translated = `${formatNumber(Number(match[1]))} مورد`;
    match = source.match(/^(\d+) open$/); if (match) translated = `${formatNumber(Number(match[1]))} مورد باز`;
    match = source.match(/^(\d+) notes?$/); if (match) translated = `${formatNumber(Number(match[1]))} یادداشت`;
    match = source.match(/^(\d+) unread$/); if (match) translated = `${formatNumber(Number(match[1]))} اعلان خوانده‌نشده`;
    match = source.match(/^(\d+) unique$/); if (match) translated = `${formatNumber(Number(match[1]))} پروژهٔ یکتا`;
    match = source.match(/^Updated (.+)$/); if (match) translated = `به‌روزرسانی ${translateText(match[1])}`;
    match = source.match(/^(\d+)d ago$/); if (match) translated = `${formatNumber(Number(match[1]))} روز پیش`;
    match = source.match(/^(\d+)mo ago$/); if (match) translated = `${formatNumber(Number(match[1]))} ماه پیش`;
    match = source.match(/^(\d+)y ago$/); if (match) translated = `${formatNumber(Number(match[1]))} سال پیش`;
    match = source.match(/^(\d+) changed$/); if (match) translated = `${formatNumber(Number(match[1]))} تغییر`;
    match = source.match(/^(\d+) minute focus session$/); if (match) translated = `جلسهٔ تمرکز ${formatNumber(Number(match[1]))} دقیقه‌ای`;
    match = source.match(/^(\d+) minutes done\. Take a breath or start a short break\.$/); if (match) translated = `${formatNumber(Number(match[1]))} دقیقه تمرکز کردی. کمی استراحت کن یا وقفهٔ کوتاهی شروع کن.`;
    match = source.match(/^(.+?) · (\d+ changed|Clean) · (Committed .+|No commits|Reading local Git status…|Local clone found)$/);
    if (match) translated = `${match[1]} · ${translateText(match[2])} · ${match[3].startsWith("Committed ") ? `Commit ${translateText(match[3].slice(9))}` : translateText(match[3])}`;
    match = source.match(/^Snoozed until (.+)$/); if (match) translated = `یادآوری در ${match[1]}`;
    match = source.match(/^Approval needed · (.+)$/); if (match) translated = `نیاز به تأیید · ${match[1]}`;
    match = source.match(/^Reminder · (.+)$/); if (match) translated = `یادآوری · ${match[1]}`;
    match = source.match(/^More (.+) in your mixes$/); if (match) translated = `سبک ${match[1]} بیشتر در ترکیب موسیقی`;
    match = source.match(/^Less (.+) in random picks$/); if (match) translated = `سبک ${match[1]} کمتر در پیشنهادهای تصادفی`;
  }
  if (translated == null) return value;
  return value === source ? translated : value.replace(source, translated);
}
function localizeTree(node: Node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const text of textNodes) {
    const original = text.textContent ?? "";
    const translated = translateText(original);
    if (translated !== original) text.textContent = translated;
  }
  if (node instanceof Element) {
    const elements = [node, ...node.querySelectorAll("*")];
    for (const element of elements) for (const name of ["title", "placeholder", "aria-label"]) {
      const value = element.getAttribute(name);
      if (value) { const translated = translateText(value); if (translated !== value) element.setAttribute(name, translated); }
    }
  }
}

function readPins(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORE_PINS) ?? "[]") as string[]); }
  catch { return new Set(); }
}
function readPrefs(): MusicPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_MUSIC) ?? "null") as Partial<MusicPrefs> | null;
    return { ...emptyPrefs(), ...saved, tastes: Array.isArray(saved?.tastes) ? saved.tastes : emptyPrefs().tastes, weights: saved?.weights ?? {}, recent: Array.isArray(saved?.recent) ? saved.recent : [] };
  } catch { return emptyPrefs(); }
}
function savePrefs() { localStorage.setItem(STORE_MUSIC, JSON.stringify(prefs)); }
function savePins() { localStorage.setItem(STORE_PINS, JSON.stringify([...pinned])); }
function readFocus(): FocusData {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_FOCUS) ?? "null") as Partial<FocusData> | null;
    const tasks = Array.isArray(saved?.tasks) ? saved.tasks.map((task) => ({
      ...task,
      // Older tasks were implicitly part of the day they were created.
      scheduledFor: task.scheduledFor === undefined && task.kind !== "note" ? dayKey(task.createdAt) : task.scheduledFor ?? null,
    })) : [];
    return { tasks, mode: saved?.mode ?? "focus", focusMinutes: saved?.focusMinutes ?? 25, remaining: saved?.remaining ?? 1500, running: saved?.running ?? false, endAt: saved?.endAt ?? null, sessions: Array.isArray(saved?.sessions) ? saved.sessions : [] };
  } catch { return { tasks: [], mode: "focus", focusMinutes: 25, remaining: 1500, running: false, endAt: null, sessions: [] }; }
}
function saveFocus() { localStorage.setItem(STORE_FOCUS, JSON.stringify(focus)); }
function readActivities(): ActivityItem[] {
  try { const saved = JSON.parse(localStorage.getItem(STORE_ACTIVITY) ?? "[]"); return Array.isArray(saved) ? saved : []; }
  catch { return []; }
}
function saveActivities() { localStorage.setItem(STORE_ACTIVITY, JSON.stringify(activities)); }
function readNotifications(): HubNotification[] {
  try { const saved = JSON.parse(localStorage.getItem(STORE_NOTIFICATIONS) ?? "[]"); return Array.isArray(saved) ? saved : []; }
  catch { return []; }
}
function saveNotifications() { localStorage.setItem(STORE_NOTIFICATIONS, JSON.stringify(notifications)); }
function readNotificationPrefs(): boolean {
  try { return JSON.parse(localStorage.getItem(STORE_NOTIFICATION_PREFS) ?? "false") === true; }
  catch { return false; }
}
function saveNotificationPrefs() { localStorage.setItem(STORE_NOTIFICATION_PREFS, JSON.stringify(notificationsMuted)); }
function readReminderPrefs(): ReminderPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_REMINDER_PREFS) ?? "null") as Partial<ReminderPrefs> | null;
    return { enabled: saved?.enabled !== false, time: /^\d{2}:\d{2}$/.test(saved?.time ?? "") ? saved!.time! : "09:00", delivered: Array.isArray(saved?.delivered) ? saved!.delivered!.filter((key): key is string => typeof key === "string") : [] };
  } catch { return { enabled: true, time: "09:00", delivered: [] }; }
}
function saveReminderPrefs() { localStorage.setItem(STORE_REMINDER_PREFS, JSON.stringify(reminderPrefs)); }
function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function todayKey() { return dayKey(Date.now()); }
function planDateLabel(value: string | null | undefined, kind: "task" | "note"): string {
  if (!value) return kind === "note" ? "No reminder" : "Add date";
  const date = new Date(`${value}T12:00:00`);
  const formatted = formatDate(date, { weekday: "short", month: "short", day: "numeric" });
  const today = todayKey();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = dayKey(tomorrowDate.getTime());
  const prefix = value < today ? "Overdue" : value === today ? "Today" : value === tomorrow ? "Tomorrow" : "";
  const visiblePrefix = prefix ? translateText(prefix) : "";
  return visiblePrefix ? `${visiblePrefix} · ${formatted}` : formatted;
}
function saveItemSchedule(item: FocusTask, dateInput: HTMLInputElement, label: HTMLElement) {
  item.scheduledFor = dateInput.value || null;
  label.textContent = planDateLabel(item.scheduledFor, item.kind === "note" ? "note" : "task");
  saveFocus();
  processPlanReminders();
  if (page === "focus") renderFocus();
}
function planDatePicker(item: FocusTask, kind: "task" | "note", className = "plan-date-control"): HTMLElement {
  const label = h("label", { class: className, title: kind === "note" ? "Reminder date" : "Due date" });
  const dateLabel = h("span", { class: "plan-date-label", text: planDateLabel(item.scheduledFor, kind) });
  const input = h("input", {
    class: "plan-date-input",
    type: "date",
    value: item.scheduledFor ?? "",
    "aria-label": kind === "note" ? "Reminder date" : "Due date",
    onchange: (event: Event) => saveItemSchedule(item, event.currentTarget as HTMLInputElement, dateLabel),
  }) as HTMLInputElement;
  label.append(svg(ICONS.clock, 12), dateLabel, input);
  return label;
}
async function enablePlanReminders() {
  if (!IS_TAURI) { toast("Desktop notifications need the Coucou app."); return; }
  reminderPrefs.enabled = true;
  saveReminderPrefs();
  toast("Daily reminders enabled");
  processPlanReminders();
  if (page === "focus") renderFocus();
}
function addPlanReminder(id: string, title: string, detail: string) {
  const at = Date.now();
  if (notifications.some((item) => item.id === id)) return;
  const notice: HubNotification = { id, kind: "reminder", title, detail, project: "Daily plan", at, read: false, status: "done", snoozedUntil: null };
  notifications.unshift(notice);
  notifications = notifications.slice(0, 150);
  saveNotifications();
  updateNotificationBadge();
  if (!notificationsMuted && !document.hidden) toast(title);
  if (document.querySelector(".notification-overlay")) drawNotifications();
  if (reminderPrefs.enabled && IS_TAURI) void Bridge.planNotification(title, detail).then((shown) => {
    if (shown === false) console.warn("Windows could not display the Coucou reminder.");
  });
}
function processPlanReminders() {
  if (!reminderPrefs.enabled) return;
  const now = new Date();
  const [hour, minute] = reminderPrefs.time.split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) return;
  const today = todayKey();
  const delivered = new Set(reminderPrefs.delivered);
  const pendingTasks = focus.tasks.filter((item) => item.kind !== "note" && !item.doneAt && item.scheduledFor && item.scheduledFor <= today);
  const dueTasks = pendingTasks.filter((item) => item.scheduledFor === today && !delivered.has(`task:${item.id}:${today}`));
  const overdueTasks = pendingTasks.filter((item) => item.scheduledFor! < today && !delivered.has(`task:${item.id}:${today}`));
  const dueNotes = focus.tasks.filter((item) => item.kind === "note" && item.scheduledFor === today && !delivered.has(`note:${item.id}:${today}`));
  if (!dueTasks.length && !overdueTasks.length && !dueNotes.length) return;
  const digest = (kind: "today" | "overdue" | "notes", items: FocusTask[]) => {
    if (!items.length) return;
    const keys = items.map((item) => `${item.kind === "note" ? "note" : "task"}:${item.id}:${today}`);
    keys.forEach((key) => delivered.add(key));
    const names = items.slice(0, 3).map((item) => item.title).join(" · ");
    const extra = items.length > 3 ? (hubLanguage === "fa" ? ` و ${formatNumber(items.length - 3)} مورد دیگر` : ` and ${formatNumber(items.length - 3)} more`) : "";
    let title = "Today's plan";
    let detail = `${formatNumber(items.length)} ${kind === "overdue" ? "tasks are still open" : kind === "notes" ? "scheduled for today" : "tasks are due"}: ${names}${extra}`;
    if (hubLanguage === "fa") {
      title = kind === "overdue" ? "تسک‌های عقب‌افتاده" : kind === "notes" ? "یادداشت‌های زمان‌بندی‌شده" : "برنامهٔ امروز";
      const countLabel = kind === "overdue" ? "تسک ناتمام" : kind === "notes" ? "یادداشت یا قرار" : "تسک برای امروز";
      detail = `${formatNumber(items.length)} ${countLabel}: ${names}${extra}`;
    }
    const id = `plan-${kind}-${today}-${items.map((item) => item.id).sort().join("-")}`;
    addPlanReminder(id, title, detail);
  };
  digest("today", dueTasks);
  digest("overdue", overdueTasks);
  digest("notes", dueNotes);
  reminderPrefs.delivered = [...delivered].slice(-1000);
  saveReminderPrefs();
}
function recordActivity(kind: ActivityKind, title: string, repo = "", detail = "", minutes?: number) {
  activities.unshift({ id: crypto.randomUUID(), kind, title, repo, detail, at: Date.now(), ...(minutes == null ? {} : { minutes }) });
  activities = activities.filter((item) => Date.now() - item.at < 120 * 86_400_000).slice(0, 600);
  saveActivities();
}
function toast(message: string) {
  let el = document.querySelector<HTMLElement>(".hub-toast");
  if (!el) { el = h("div", { class: "hub-toast" }); document.body.append(el); }
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (el) el.hidden = true; }, 2200);
}
function unreadNotificationCount(): number {
  const now = Date.now();
  return notifications.filter((item) => !item.read && (!item.snoozedUntil || item.snoozedUntil <= now)).length;
}
function updateNotificationBadge() {
  const count = unreadNotificationCount();
  notificationBadge.hidden = count === 0;
  notificationBadge.textContent = count > 99 ? "99+" : String(count);
  notificationButton.classList.toggle("has-notifications", count > 0);
}
function addAgentNotification(event: AgentNotificationEvent) {
  if (notifications.some((item) => item.id === event.id)) return;
  notifications.unshift({ ...event, read: false, status: event.kind === "approval" ? "pending" : "done", snoozedUntil: null });
  notifications = notifications.slice(0, 150);
  saveNotifications();
  updateNotificationBadge();
  if (!notificationsMuted) toast(event.kind === "approval" ? `Approval needed · ${event.project}` : event.title);
  if (document.querySelector(".notification-overlay")) drawNotifications();
}
function addFocusNotification(title: string, detail: string) {
  const at = Date.now();
  const notice: HubNotification = { id: `focus-${at}`, kind: "focus", title, detail, project: "Focus timer", at, read: false, status: "done", snoozedUntil: null };
  notifications.unshift(notice);
  notifications = notifications.slice(0, 150);
  saveNotifications();
  updateNotificationBadge();
  if (!notificationsMuted) toast(notice.title);
  if (document.querySelector(".notification-overlay")) drawNotifications();
}
function resolveApproval(event: ApprovalResolutionEvent) {
  const notice = notifications.find((item) => item.id === event.id || item.requestId === event.id);
  if (!notice) return;
  notice.status = event.status === "closed" ? "expired" : "done";
  notice.detail = event.status === "approved" ? "Approved in Coucou" : event.status === "denied" ? "Denied in Coucou" : "No longer waiting for approval";
  saveNotifications();
  if (document.querySelector(".notification-overlay")) drawNotifications();
}
function drawNotifications() {
  const list = document.querySelector<HTMLElement>(".notification-list");
  const count = document.querySelector<HTMLElement>(".notification-count");
  const muteButton = document.querySelector<HTMLButtonElement>(".notification-mute");
  if (!list || !count || !muteButton) return;
  const unread = unreadNotificationCount();
  count.textContent = unread ? `${unread} unread` : "All caught up";
  muteButton.textContent = notificationsMuted ? "Popups muted" : "Mute popups";
  muteButton.classList.toggle("muted", notificationsMuted);
  clear(list);
  if (!notifications.length) {
    list.append(h("div", { class: "notification-empty" }, h("span", { class: "notification-empty-icon" }, svg(ICONS.bell, 17)), h("b", { text: "You're all caught up" }), h("span", { text: "Prompt completions, approvals and focus reminders will appear here." })));
    return;
  }
  for (const item of notifications) {
    const snoozed = Boolean(item.snoozedUntil && item.snoozedUntil > Date.now());
    const row = h("article", { class: `notification-item ${item.read ? "read" : "unread"} ${item.kind} ${snoozed ? "snoozed" : ""}` });
    row.append(h("span", { class: `notification-icon ${item.kind}` }, svg(item.kind === "approval" ? ICONS.bang : item.kind === "focus" ? ICONS.timer : item.kind === "reminder" ? ICONS.bell : item.kind === "error" ? ICONS.xmark : ICONS.check, 13)));
    const statusText = snoozed ? `Snoozed until ${formatTime(new Date(item.snoozedUntil!))}` : item.status === "pending" ? "Waiting for your decision" : item.status === "expired" ? "Closed" : item.read ? "Read" : "New";
    const copy = h("div", { class: "notification-copy" }, h("div", { class: "notification-title-line" }, h("b", { text: item.title }), h("time", { text: formatTime(new Date(item.at)) })), h("p", { text: item.detail }), h("div", { class: "notification-meta" }, item.project || "Coucou", h("span", { text: statusText })));
    const actions = h("div", { class: "notification-actions" });
    if (!snoozed && !item.read) {
      if (item.kind === "approval" && item.status === "pending") {
        actions.append(h("button", { class: "notice-action", title: "Remind me in one minute", text: "1m", onclick: () => snoozeNotification(item.id, 60_000) }));
        actions.append(h("button", { class: "notice-action review", text: "Review", onclick: () => { document.querySelector(".notification-overlay")?.remove(); void Bridge.focusWindow(true); } }));
      } else if (item.kind === "reminder") {
        actions.append(h("button", { class: "notice-action review", text: "Review", onclick: () => { markNotificationRead(item.id); document.querySelector(".notification-overlay")?.remove(); setPage("focus"); } }));
      } else {
        actions.append(h("button", { class: "notice-action", title: "Snooze for 15 minutes", text: "15m", onclick: () => snoozeNotification(item.id, 15 * 60_000) }));
        actions.append(h("button", { class: "notice-action", title: "Snooze for 1 hour", text: "1h", onclick: () => snoozeNotification(item.id, 60 * 60_000) }));
      }
      actions.append(h("button", { class: "notice-action", title: "Mark as read", text: "Read", onclick: () => markNotificationRead(item.id) }));
    }
    row.append(copy, actions);
    list.append(row);
  }
}
function snoozeNotification(id: string, duration: number) {
  const item = notifications.find((notice) => notice.id === id);
  if (!item) return;
  item.snoozedUntil = Date.now() + duration;
  saveNotifications();
  updateNotificationBadge();
  drawNotifications();
}
function markNotificationRead(id: string) {
  const item = notifications.find((notice) => notice.id === id);
  if (!item) return;
  item.read = true;
  item.snoozedUntil = null;
  saveNotifications();
  updateNotificationBadge();
  drawNotifications();
}
function openNotificationCenter() {
  if (document.querySelector(".notification-overlay")) return;
  const list = h("div", { class: "notification-list" });
  const muteButton = h("button", { class: "notification-mute", onclick: () => {
    notificationsMuted = !notificationsMuted;
    saveNotificationPrefs();
    drawNotifications();
  } });
  const close = () => overlay.remove();
  const overlay = h("div", { class: "notification-overlay" }, h("section", { class: "notification-center", role: "dialog", "aria-modal": "true", "aria-label": "Notifications" },
    h("header", { class: "notification-head" }, h("div", {}, h("div", { class: "eyebrow", text: "YOUR INBOX" }), h("h2", { text: "Notifications" }), h("span", { class: "notification-count" })), h("div", { class: "notification-head-actions" }, muteButton, h("button", { class: "notification-mark-all", text: "Mark all read", onclick: () => {
      notifications = notifications.map((item) => ({ ...item, read: true, snoozedUntil: null }));
      saveNotifications();
      updateNotificationBadge();
      drawNotifications();
    } }), h("button", { class: "capture-close", title: "Close", text: "×", onclick: close }))),
    list,
    h("footer", { class: "notification-footer", text: "Notifications stay on this device. Snoozed items return when the timer ends." }),
  ));
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", (event) => { if ((event as KeyboardEvent).key === "Escape") close(); });
  document.body.append(overlay);
  drawNotifications();
  muteButton.focus();
}
function processSnoozedNotifications() {
  const now = Date.now();
  const due = notifications.filter((item) => !item.read && item.snoozedUntil && item.snoozedUntil <= now);
  if (due.length) {
    for (const item of due) item.snoozedUntil = null;
    saveNotifications();
    if (!notificationsMuted) toast(due.length === 1 ? `Reminder · ${due[0].title}` : `${due.length} notifications are back`);
    if (document.querySelector(".notification-overlay")) drawNotifications();
  }
  updateNotificationBadge();
}

const logo = h("div", { class: "brand" },
  h("div", { class: "brand-mark" }, mochiPortrait({
    size: 46, greet: true, follow: true, idleMoods: ["wink", "lookAround", "hop", "whistle"],
    clickMoods: ["giggle", "love", "excited", "spin", "shy"], label: "Mochi",
  })),
  h("div", { class: "brand-copy" }, h("strong", { text: "Coucou Hub" }), h("small", { text: "Your workspace, together" })),
);
const repoNav = h("button", { class: "nav-button active", onclick: () => setPage("repositories") }, svg(ICONS.stack, 16), h("span", { text: "Projects" }));
const queueNav = h("button", { class: "nav-button", title: "See assigned issues and review requests alongside your focus tasks", onclick: () => setPage("queue") }, svg(ICONS.check, 16), h("span", { text: "Work queue" }));
const musicNav = h("button", { class: "nav-button", onclick: () => setPage("music") }, svg(ICONS.music, 16), h("span", { text: "Music for work" }));
const focusNav = h("button", { class: "nav-button", onclick: () => setPage("focus") }, svg(ICONS.timer, 16), h("span", { text: "Focus & tasks" }));
const activityNav = h("button", { class: "nav-button", onclick: () => setPage("activity") }, svg(ICONS.clock, 16), h("span", { text: "Daily history" }));
const accountAvatar = h("div", { class: "avatar", text: "GH" });
const accountName = h("b", { text: "GitHub" });
const accountNote = h("small", { text: "Connected account" });
const title = h("h1", { text: "Projects" });
const subtitle = h("div", { class: "subtitle", text: "See local Git activity and open your GitHub projects." });
const headerAction = h("button", { class: "toolbar-button primary", onclick: () => { if (page === "repositories") void loadRepos(); else if (page === "queue") void loadQueue(); else if (page === "music") openMusicSearch(randomQuery()); else openQuickCapture(); } }, svg(ICONS.refresh, 13), h("span", { text: "Refresh" }));
const commandButton = h("button", { class: "command-shortcut", title: "Search Coucou Hub", onclick: openCommandPalette }, svg(ICONS.search, 12), h("kbd", { text: "Ctrl K" }));
const projectSearchButton = h("button", { class: "command-shortcut project-search-shortcut", title: "Search local project files", onclick: openProjectSearch }, svg(ICONS.search, 12), h("kbd", { text: "Ctrl Shift F" }));
const languageButton = h("button", { class: "language-switch", title: "Switch language", "aria-label": "Switch language", text: hubLanguage === "en" ? "فارسی" : "English", onclick: toggleHubLanguage });
const notificationBadge = h("span", { class: "notification-badge", hidden: true });
const notificationButton = h("button", { class: "notification-shortcut", title: "Notifications", "aria-label": "Open notifications", onclick: openNotificationCenter }, svg(ICONS.bell, 15), notificationBadge);
const mainContent = h("div", { class: "page-content" });
const rootEl = h("div", { class: "hub" },
  h("aside", { class: "sidebar" }, logo,
    h("div", { class: "nav-label", text: "Workspace" }), repoNav, queueNav, focusNav, activityNav, musicNav,
    h("div", { class: "sidebar-spacer" }),
    h("div", { class: "free-note" }, h("b", { text: "Free by design" }), "Local preferences and GitHub's free API. No paid add-on."),
    h("div", { class: "account" }, accountAvatar, h("div", { class: "account-copy" }, accountName, accountNote)),
  ),
  h("main", { class: "main" },
    h("header", { class: "main-header" },
      h("div", { class: "heading-copy" }, h("div", { class: "eyebrow", text: "COUCOU WORKSPACE" }), title, subtitle),
      h("div", { class: "header-tools" }, languageButton, projectSearchButton, commandButton, notificationButton, headerAction),
    ),
    mainContent,
  ),
);
root.replaceChildren(rootEl);
document.documentElement.lang = hubLanguage;
document.documentElement.dir = hubLanguage === "fa" ? "rtl" : "ltr";
localizeTree(document.documentElement);
const localeObserver = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "childList") record.addedNodes.forEach(localizeTree);
    else if (record.type === "characterData" && record.target instanceof Text) {
      const value = record.target.textContent ?? "";
      const translated = translateText(value);
      if (translated !== value) record.target.textContent = translated;
    }
    else if (record.type === "attributes" && record.target instanceof Element) {
      const name = record.attributeName;
      const value = name ? record.target.getAttribute(name) : null;
      if (name && value) { const translated = translateText(value); if (translated !== value) record.target.setAttribute(name, translated); }
    }
  }
});
localeObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["title", "placeholder", "aria-label"] });

function toggleHubLanguage() {
  hubLanguage = hubLanguage === "en" ? "fa" : "en";
  localStorage.setItem(STORE_HUB_LANGUAGE, hubLanguage);
  document.documentElement.lang = hubLanguage;
  document.documentElement.dir = hubLanguage === "fa" ? "rtl" : "ltr";
  languageButton.textContent = hubLanguage === "en" ? "فارسی" : "English";
  for (const overlay of document.querySelectorAll(".notification-overlay,.quick-capture-overlay,.command-overlay,.project-search-overlay")) overlay.remove();
  setPage(page);
  localizeTree(document.documentElement);
}

function setPage(next: Page) {
  const enteringQueue = next === "queue" && page !== "queue";
  page = next;
  repoNav.classList.toggle("active", next === "repositories");
  queueNav.classList.toggle("active", next === "queue");
  musicNav.classList.toggle("active", next === "music");
  focusNav.classList.toggle("active", next === "focus");
  activityNav.classList.toggle("active", next === "activity");
  const actionText = next === "repositories" || next === "queue" ? "Refresh" : next === "music" ? "Surprise me" : "Quick capture";
  headerAction.replaceChildren(svg(next === "repositories" || next === "queue" ? ICONS.refresh : next === "music" ? ICONS.music : ICONS.plus, 13), document.createTextNode(actionText));
  title.textContent = next === "repositories" ? "Projects" : next === "queue" ? "Work queue" : next === "music" ? "Music for work" : next === "activity" ? "Daily history" : "Focus & tasks";
  subtitle.textContent = next === "repositories"
    ? "See local Git activity and open your GitHub projects."
    : next === "queue" ? "Your next actions, gathered in one place."
      : next === "music" ? "A little music discovery, tuned to your taste."
      : next === "activity" ? "A private, local timeline of your work."
        : "Plan today's work and protect a little time to focus.";
  renderPage();
  // Each page eases in rather than snapping into place.
  mainContent.classList.remove("page-in");
  void mainContent.offsetWidth;
  mainContent.classList.add("page-in");
  if (enteringQueue) void loadQueue();
}

/**
 * A small burst of confetti from an element — the reward for ticking a task off.
 * Lives on <body>, so the list re-rendering underneath doesn't cut it short.
 */
function popConfetti(from: HTMLElement) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const r = from.getBoundingClientRect();
  const colors = ["#FF6B6B", "#FFD166", "#06D6A0", "#4CC9F0", "#B794F6", "#FF8FAB"];
  const layer = h("div", { class: "confetti-layer", "aria-hidden": "true" });
  layer.style.left = `${r.left + r.width / 2}px`;
  layer.style.top = `${r.top + r.height / 2}px`;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 26 + Math.random() * 34;
    const bit = h("i");
    bit.style.background = colors[i % colors.length];
    bit.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * dist - 18}px`);
    bit.style.setProperty("--rot", `${Math.round(Math.random() * 720 - 360)}deg`);
    bit.style.animationDelay = `${Math.random() * 60}ms`;
    layer.append(bit);
  }
  document.body.append(layer);
  window.setTimeout(() => layer.remove(), 1100);
}

async function loadRepos() {
  loading = true;
  loadError = "";
  renderRepos();
  try {
    catalog = await Bridge.hubRepositories();
    accountName.textContent = catalog.login;
    accountAvatar.textContent = catalog.login.slice(0, 2).toUpperCase();
    projectStatuses.clear();
    localStatusLoading.clear();
    const localPaths = [...new Set(catalog.repositories.flatMap((repo) => repo.localPath ? [repo.localPath] : []))];
    for (const path of localPaths) localStatusLoading.add(path);
    renderRepos();
    void loadLocalStatuses(localPaths);
  } catch (error) {
    loadError = String(error).replace(/^Error:\s*/, "");
  } finally {
    loading = false;
    renderRepos();
  }
}

async function loadQueue() {
  queueLoading = true;
  queueError = "";
  renderQueue();
  try {
    queueData = await Bridge.hubWorkQueue();
  } catch (error) {
    queueError = String(error).replace(/^Error:\s*/, "");
  } finally {
    queueLoading = false;
    renderQueue();
  }
}

async function loadLocalStatuses(paths: string[]) {
  let next = 0;
  const workers = Array.from({ length: Math.min(4, paths.length) }, async () => {
    while (next < paths.length) {
      const path = paths[next++];
      try {
        projectStatuses.set(path, await Bridge.projectStatusLocal(path));
      } catch {
        // GitHub browsing remains useful when a local clone is unavailable.
      } finally {
        localStatusLoading.delete(path);
      }
    }
  });
  await Promise.all(workers);
  if (page === "repositories") renderRepos();
}

function visibleRepos(): GitHubRepository[] {
  const all = catalog?.repositories ?? [];
  const normalized = query.toLowerCase().trim();
  const result = all.filter((repo) => {
    if (filter === "private" && !repo.private) return false;
    if (filter === "public" && repo.private) return false;
    if (filter === "pinned" && !pinned.has(repo.fullName)) return false;
    if (!normalized) return true;
    return [repo.fullName, repo.description ?? "", repo.language ?? ""].join(" ").toLowerCase().includes(normalized);
  });
  return result.sort((a, b) => sortBy === "stars" ? b.stars - a.stars : sortBy === "name" ? a.fullName.localeCompare(b.fullName) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function renderRepos() {
  clear(mainContent);
  if (loading && !catalog) {
    mainContent.append(h("div", { class: "repo-empty mochi-empty" },
      mochiPortrait({ size: 64, state: "searching" }),
      h("span", { text: "Loading your repositories…" })));
    return;
  }
  if (loadError && !catalog) {
    mainContent.append(h("div", { class: "repo-error" }, mochiPortrait({ size: 64, state: "question", idleMoods: ["curious"] }), h("b", { text: "GitHub could not be reached" }), h("span", { text: loadError }), h("div", { style: "display:flex;justify-content:center;gap:8px;margin-top:14px" }, h("button", { class: "toolbar-button", text: "Settings", onclick: () => void Bridge.openSettingsWindow() }), h("button", { class: "toolbar-button", text: "Try again", onclick: () => void loadRepos() }))));
    return;
  }
  const repos = catalog?.repositories ?? [];
  const localRepos = repos.filter((repo) => repo.localPath);
  const needsAttention = localRepos.filter((repo) => (projectStatuses.get(repo.localPath!)?.changedFiles ?? 0) > 0).length;
  const stat = (label: string, value: number, hint: string) => h("div", { class: "stat-card" }, h("div", { class: "stat-label", text: label }), h("div", { class: "stat-value" }, formatNumber(value), h("small", { text: hint })));
  mainContent.append(h("div", { class: "stats" },
    stat("Projects", repos.length, "on GitHub"),
    stat("Local clones", localRepos.length, "found on this PC"),
    stat("Needs attention", needsAttention, "with uncommitted changes"),
  ));

  const search = h("input", { type: "search", placeholder: "Search by name, description or language…", value: query, oninput: (event: Event) => { query = (event.target as HTMLInputElement).value; renderRepoCards(); } }) as HTMLInputElement;
  const filters = h("div", { class: "filters" });
  const options: [Filter, string][] = [["all", "All"], ["public", "Public"], ["private", "Private"], ["pinned", "Pinned"]];
  for (const [key, label] of options) filters.append(h("button", { class: `filter ${filter === key ? "active" : ""}`, text: label, onclick: () => { filter = key; renderRepos(); } }));
  const sort = h("select", { class: "sort", onchange: (event: Event) => { sortBy = (event.target as HTMLSelectElement).value; renderRepoCards(); } },
    h("option", { value: "updated", text: "Recently updated" }), h("option", { value: "stars", text: "Most stars" }), h("option", { value: "name", text: "Name A–Z" }));
  sort.value = sortBy;
  const count = h("span", { class: "result-count" });
  const grid = h("div", { class: "repo-grid" });
  const scroll = h("div", { class: "repo-scroll" }, grid);
  mainContent.append(h("div", { class: "repo-toolbar" }, h("label", { class: "search-wrap" }, svg(ICONS.search, 13), search), filters, sort, count), scroll);
  renderRepoCards();

  function renderRepoCards() {
    const filtered = visibleRepos();
    count.textContent = `${filtered.length} shown`;
    clear(grid);
    if (!filtered.length) {
      grid.append(h("div", { class: "repo-empty", text: repos.length ? "No repositories match these filters." : "No repositories found." }));
      return;
    }
    filtered.forEach((repo, index) => grid.append(repoCard(repo, index)));
  }
}

const languageColors: Record<string, string> = { Python: "#3978c5", TypeScript: "#3b82c4", JavaScript: "#e8c64a", PHP: "#858fc3", Rust: "#d67c52", HTML: "#e6784b", CSS: "#7b75dc", Java: "#d26d59" };
function repoCard(repo: GitHubRepository, index: number): HTMLElement {
  const card = h("article", { class: "repo-card", style: `animation-delay:${Math.min(index, 8) * 24}ms` });
  const badges = h("div", { class: "repo-badges" });
  if (repo.private) badges.append(h("span", { class: "badge private", text: "Private" }));
  if (repo.fork) badges.append(h("span", { class: "badge", text: "Fork" }));
  if (repo.archived) badges.append(h("span", { class: "badge archived", text: "Archived" }));
  const head = h("div", { class: "repo-head" }, h("span", { class: "repo-symbol" }, svg(repo.private ? ICONS.lock : ICONS.stack, 13)), h("b", { class: "repo-name", title: repo.fullName, text: repo.fullName }), badges);
  const description = h("div", { class: "repo-description", text: repo.description || "No description yet." });
  const lang = repo.language ? h("span", {}, h("i", { class: "language-dot", style: `background:${languageColors[repo.language] ?? "#9887ed"}` }), repo.language) : null;
  const meta = h("div", { class: "repo-meta" }, lang, h("span", {}, svg(ICONS.star, 10), formatNumber(repo.stars)), h("span", {}, svg(ICONS.fork, 10), formatNumber(repo.forks)), h("span", { text: `Updated ${timeAgo(repo.updatedAt)}` }));
  let localStatus: HTMLElement | null = null;
  if (repo.localPath) {
    const status = projectStatuses.get(repo.localPath);
    const copy = status?.error
      ? status.error
      : status
        ? `${status.branch || "Detached HEAD"} · ${status.changedFiles ? `${status.changedFiles} changed` : "Clean"} · ${status.lastCommitAt ? `Committed ${timeAgo(new Date(status.lastCommitAt * 1000).toISOString())}` : "No commits"}`
        : localStatusLoading.has(repo.localPath) ? "Reading local Git status…" : "Local clone found";
    localStatus = h("div", { class: `repo-local-status ${status?.changedFiles ? "dirty" : ""}`, title: status?.lastCommit ?? repo.localPath },
      svg(status?.changedFiles ? ICONS.doc : ICONS.branch, 11), h("span", { text: copy }));
  }
  const foot = h("div", { class: "repo-foot" });
  foot.append(h("button", { class: "repo-action", onclick: () => openProjectOnGitHub(repo) }, svg(ICONS.arrowUpRight, 11), "GitHub"));
  if (repo.localPath) foot.append(h("button", { class: "repo-action", onclick: () => openProjectInVSCode(repo) }, svg(ICONS.code, 11), "Open Code"));
  foot.append(h("button", { class: "repo-action", title: "Copy clone URL", onclick: () => void navigator.clipboard.writeText(repo.cloneUrl).then(() => toast("Clone URL copied")).catch(() => toast(repo.cloneUrl)) }, svg(ICONS.copy, 11), "Clone URL"));
  const isPinned = pinned.has(repo.fullName);
  foot.append(h("button", { class: `repo-action pin ${isPinned ? "pinned" : ""}`, title: isPinned ? "Unpin repository" : "Pin repository", onclick: () => {
    if (pinned.has(repo.fullName)) pinned.delete(repo.fullName); else pinned.add(repo.fullName);
    savePins();
    if (filter === "pinned") renderRepos(); else renderRepos();
    toast(pinned.has(repo.fullName) ? "Pinned in Coucou" : "Removed from pinned");
  } }, svg(ICONS.pin, 11), isPinned ? "Pinned" : "Pin"));
  card.append(head, description, meta, ...(localStatus ? [localStatus] : []), foot);
  return card;
}

function openProjectOnGitHub(repo: GitHubRepository) {
  recordActivity("project", repo.name, repo.fullName, "Opened on GitHub");
  void Bridge.openUrl(repo.htmlUrl);
  if (page === "activity") renderActivity();
}
function openProjectInVSCode(repo: GitHubRepository) {
  if (!repo.localPath) return;
  void Bridge.openInVSCode(repo.localPath).then(() => {
    recordActivity("project", repo.name, repo.fullName, "Opened in VS Code");
    if (page === "activity") renderActivity();
  });
}

function timeAgo(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "recently";
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function openMusicSearch(search: string) {
  if (!search.trim()) return;
  const url = new URL("https://music.youtube.com/search");
  url.searchParams.set("q", search);
  void Bridge.openUrl(url.toString());
  prefs.recent = [{ query: search, taste: prefs.tastes.find((t) => search.toLowerCase().includes(t.toLowerCase())) ?? prefs.tastes[0] ?? "music", mood: prefs.mood, at: Date.now() }, ...prefs.recent.filter((entry) => entry.query !== search)].slice(0, 8);
  savePrefs();
  toast("YouTube Music search opened in your browser");
  if (page === "music") renderMusic();
}

function weightedTaste(): string {
  const tastes = prefs.tastes.length ? prefs.tastes : ["music mix"];
  const weights = tastes.map((taste) => Math.max(.2, 1 + (prefs.weights[taste] ?? 0)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let pick = Math.random() * total;
  for (let i = 0; i < tastes.length; i++) { pick -= weights[i]; if (pick <= 0) return tastes[i]; }
  return tastes[0];
}

function randomQuery(): string {
  const taste = weightedTaste();
  const terms: Record<Mood, string[]> = {
    focus: ["mix for focus", "work session mix", "long DJ set"],
    energy: ["remix mix", "high energy DJ set", "non stop mix"],
    chill: ["chill mix", "late night set", "smooth playlist"],
  };
  return `${taste} ${terms[prefs.mood][Math.floor(Math.random() * terms[prefs.mood].length)]}`;
}

function addTaste(value: string) {
  const taste = value.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!taste || prefs.tastes.some((item) => item.toLowerCase() === taste.toLowerCase())) return;
  prefs.tastes.push(taste);
  savePrefs();
  renderMusic();
}

function rateTaste(taste: string, amount: number) {
  prefs.weights[taste] = Math.max(-0.8, Math.min(5, (prefs.weights[taste] ?? 0) + amount));
  savePrefs();
  toast(amount > 0 ? `More ${taste} in your mixes` : `Less ${taste} in random picks`);
  renderMusic();
}

function renderMusic() {
  clear(mainContent);
  const tasteInput = h("input", { class: "taste-input", placeholder: "Add a sound you like…", maxlength: "40" }) as HTMLInputElement;
  const searchInput = h("input", { placeholder: "e.g. Persian rap remix for night drive", onkeydown: (event: Event) => { if ((event as KeyboardEvent).key === "Enter") openMusicSearch(searchInput.value); } }) as HTMLInputElement;
  const tasteList = h("div", { class: "taste-list" });
  for (const taste of prefs.tastes) tasteList.append(h("span", { class: "taste-chip" }, taste, h("button", { title: "Remove preference", text: "×", onclick: () => { prefs.tastes = prefs.tastes.filter((item) => item !== taste); delete prefs.weights[taste]; savePrefs(); renderMusic(); } })));
  const add = () => { addTaste(tasteInput.value); tasteInput.value = ""; };
  const addBtn = h("button", { text: "Add", onclick: add });
  tasteInput.addEventListener("keydown", (event) => { if (event.key === "Enter") add(); });

  const moods: [Mood, string, string][] = [["focus", "◌", "Focus"], ["energy", "↗", "High energy"], ["chill", "☾", "Chill"]];
  const moodGrid = h("div", { class: "mood-options" });
  for (const [mood, icon, label] of moods) moodGrid.append(h("button", { class: `mood ${prefs.mood === mood ? "active" : ""}`, onclick: () => { prefs.mood = mood; savePrefs(); renderMusic(); } }, `${icon}  ${label}`));

  const recent = h("div", { class: "recent-list" });
  if (!prefs.recent.length) recent.append(h("div", { class: "music-copy", text: "Your searches will show up here. Rate a vibe to tune future random picks." }));
  for (const item of prefs.recent) {
    recent.append(h("div", { class: "recent-query" },
      h("button", { class: "recent-main", title: "Search again", text: `♫  ${item.query}`, onclick: () => openMusicSearch(item.query) }),
      h("button", { class: "rate-button", title: "More like this", text: "♡", onclick: () => rateTaste(item.taste, 1) }),
      h("button", { class: "rate-button down", title: "Less like this", text: "−", onclick: () => rateTaste(item.taste, -0.5) }),
    ));
  }

  const hero = h("section", { class: "music-panel music-hero" },
    h("div", { class: "music-orb" }, svg(ICONS.music, 29)),
    h("div", {}, h("div", { class: "music-badge", text: "♪  YOUTUBE MUSIC" }), h("h2", { text: "Soundtrack your focus" }), h("p", { text: "Coucou remembers the vibes you add and tunes random music searches with your feedback." })),
  );
  const customSearch = h("section", { class: "music-panel" }, h("h3", { text: "Find a vibe" }), h("div", { class: "music-copy", text: "Search YouTube Music using your own words." }), h("div", { class: "music-search" }, searchInput, h("button", { text: "Search", onclick: () => openMusicSearch(searchInput.value) })));
  const tastes = h("section", { class: "music-panel" }, h("h3", { text: "What do you like?" }), h("div", { class: "music-copy", text: "Saved only on this device. Add or remove styles anytime." }), tasteList, h("div", { class: "taste-add" }, tasteInput, addBtn));
  const mood = h("section", { class: "music-panel" }, h("h3", { text: "Pick a mood" }), moodGrid, h("button", { class: "toolbar-button primary", style: "width:100%;justify-content:center", onclick: () => openMusicSearch(randomQuery()) }, svg(ICONS.shuffle, 13), "Surprise me"));
  const recentPanel = h("section", { class: "music-panel" }, h("h3", { text: "Recent discoveries" }), recent);
  const note = h("div", { class: "music-free-note" }, "Free tier: YouTube Music plays with ads. Coucou opens a search; choose a result and press play. Music background play may require YouTube Music Premium.");
  mainContent.append(h("div", { class: "music-layout" }, hero, customSearch, tastes, mood, recentPanel, note));
}

function focusMinutesFor(mode: FocusMode): number {
  return mode === "focus" ? focus.focusMinutes : mode === "short" ? 5 : 15;
}
function beginFocusMode(mode: FocusMode) {
  focus.mode = mode;
  focus.running = false;
  focus.endAt = null;
  focus.remaining = focusMinutesFor(mode) * 60;
  saveFocus();
  renderFocus();
}
function fmtClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const clock = `${Math.floor(safe / 60).toString().padStart(2, "0")}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
  return hubLanguage === "fa" ? clock.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]) : clock;
}
function finishFocusSession() {
  if (!focus.running || !focus.endAt || focus.endAt > Date.now()) return;
  const finished = focus.mode;
  if (finished === "focus") focus.sessions.push({ at: Date.now(), minutes: focus.focusMinutes });
  focus.mode = finished === "focus" ? "short" : "focus";
  focus.running = false;
  focus.endAt = null;
  focus.remaining = focusMinutesFor(focus.mode) * 60;
  focus.sessions = focus.sessions.filter((session) => Date.now() - session.at < 35 * 86_400_000);
  saveFocus();
  addFocusNotification(finished === "focus" ? "Focus session complete" : "Break complete", finished === "focus" ? `${focus.focusMinutes} minutes done. Take a breath or start a short break.` : "Ready for another focus session?");
  window.clearInterval(focusTick);
  focusTick = 0;
  if (page === "focus") renderFocus();
}

function renderActivity() {
  clear(mainContent);
  const selected = new Date(`${activityDay}T00:00:00`);
  const today = dayKey(Date.now());
  const dayFocus = focus.sessions.filter((session) => dayKey(session.at) === activityDay);
  const dayTasks = focus.tasks.filter((task) => task.kind !== "note" && task.doneAt && dayKey(task.doneAt) === activityDay);
  const dayProjects = activities.filter((item) => item.kind === "project" && dayKey(item.at) === activityDay);
  const minutes = dayFocus.reduce((sum, session) => sum + session.minutes, 0);
  const uniqueProjects = new Set(dayProjects.map((item) => item.repo || item.title)).size;
  const entries: Array<{ kind: ActivityKind; title: string; project: string; detail: string; at: number }> = [
    ...dayFocus.map((session) => ({ kind: "focus" as const, title: `${session.minutes} minute focus session`, project: "", detail: "Focus session completed", at: session.at })),
    ...dayTasks.map((task) => ({ kind: "task" as const, title: task.title, project: task.repo, detail: "Task completed", at: task.doneAt! })),
    ...dayProjects.map((item) => ({ kind: item.kind, title: item.title, project: item.repo, detail: item.detail, at: item.at })),
  ].sort((a, b) => b.at - a.at);
  const stats = h("div", { class: "stats activity-stats" },
    h("div", { class: "stat-card" }, h("div", { class: "stat-label", text: "Focused" }), h("div", { class: "stat-value" }, formatNumber(minutes), h("small", { text: "minutes" }))),
    h("div", { class: "stat-card" }, h("div", { class: "stat-label", text: "Tasks completed" }), h("div", { class: "stat-value", text: formatNumber(dayTasks.length) })),
    h("div", { class: "stat-card" }, h("div", { class: "stat-label", text: "Projects opened" }), h("div", { class: "stat-value" }, formatNumber(dayProjects.length), h("small", { text: `${uniqueProjects} unique` }))),
  );
  const previous = h("button", { class: "day-step", title: "Previous day", text: "←", onclick: () => changeActivityDay(-1) });
  const next = h("button", { class: "day-step", title: "Next day", text: "→", disabled: activityDay >= today, onclick: () => changeActivityDay(1) });
  const dateLabel = activityDay === today ? "Today" : formatDate(selected, { weekday: "long", month: "long", day: "numeric" });
  const list = h("div", { class: "activity-list" });
  if (!entries.length) {
    list.append(h("div", { class: "activity-empty" }, mochiPortrait({ size: 72, state: "sleeping", overhang: 18, label: "Mochi, napping" }), h("b", { text: "A quiet day so far" }), h("span", { text: "Completed focus sessions, tasks and project opens will show up here." })));
  } else {
    for (const entry of entries) {
      list.append(h("article", { class: `activity-item ${entry.kind}` },
        h("span", { class: `activity-icon ${entry.kind}` }, svg(entry.kind === "focus" ? ICONS.timer : entry.kind === "task" ? ICONS.check : ICONS.code, 13)),
        h("div", { class: "activity-copy" }, h("b", { text: entry.title }), h("span", { text: entry.detail }), entry.project ? h("small", { text: entry.project }) : null),
        h("time", { text: formatTime(new Date(entry.at)) }),
      ));
    }
  }
  mainContent.append(stats, h("section", { class: "activity-panel" },
    h("div", { class: "activity-panel-head" }, h("div", {}, h("div", { class: "eyebrow", text: "LOCAL WORK LOG" }), h("h2", { text: dateLabel }), h("span", { class: "activity-date" }, formatDate(selected, { month: "long", day: "numeric", year: "numeric" }))), h("div", { class: "day-controls" }, previous, next, activityDay !== today ? h("button", { class: "day-today", text: "Today", onclick: () => { activityDay = today; renderActivity(); } }) : null)),
    list,
    h("div", { class: "activity-privacy", text: "Saved locally on this device. No activity is sent to a service." }),
  ));
}
function changeActivityDay(amount: number) {
  const [year, month, day] = activityDay.split("-").map(Number);
  activityDay = dayKey(new Date(year, month - 1, day + amount).getTime());
  renderActivity();
}

function saveCapturedItem(title: string, repo: string, kind: "task" | "note", note = "", scheduledFor: string | null | undefined = undefined) {
  const createdAt = Date.now();
  focus.tasks.unshift({ id: crypto.randomUUID(), title, repo, createdAt, doneAt: null, kind, note: note.trim(), scheduledFor: scheduledFor === undefined ? (kind === "task" ? dayKey(createdAt) : null) : scheduledFor });
  saveFocus();
  processPlanReminders();
}

function openQuickCapture(initialKind: "task" | "note" = "task") {
  if (document.querySelector(".quick-capture-overlay")) return;
  let kind: "task" | "note" = initialKind;
  const titleInput = h("input", { class: "capture-title", placeholder: "Give it a short title", maxlength: "120" }) as HTMLInputElement;
  const noteInput = h("textarea", { class: "capture-note", placeholder: "Add a note or a little context…", rows: "3", maxlength: "1000" }) as HTMLTextAreaElement;
  const scheduleCaption = h("label", { class: "capture-label", text: kind === "task" ? "Due date" : "Reminder date (optional)" });
  const scheduleInput = h("input", { class: "capture-date", type: "date", value: kind === "task" ? todayKey() : "", "aria-label": kind === "task" ? "Due date" : "Reminder date" }) as HTMLInputElement;
  const scheduleHint = h("small", { text: kind === "task" ? "The task is scheduled for today by default." : "Optional date for this note" });
  const repoOptions: HTMLOptionElement[] = [h("option", { value: "", text: "General" })];
  for (const repo of catalog?.repositories ?? []) repoOptions.push(h("option", { value: repo.fullName, text: repo.fullName }));
  const repoPicker = h("select", { class: "capture-repo" }, ...repoOptions) as HTMLSelectElement;
  const taskType = h("button", { class: `capture-type ${kind === "task" ? "active" : ""}`, text: "Task", onclick: () => chooseKind("task") });
  const noteType = h("button", { class: `capture-type ${kind === "note" ? "active" : ""}`, text: "Note", onclick: () => chooseKind("note") });
  const overlay = h("div", { class: "quick-capture-overlay" });
  const close = () => overlay.remove();
  const submit = () => {
    const title = titleInput.value.trim().replace(/\s+/g, " ");
    if (!title) { titleInput.focus(); return; }
    saveCapturedItem(title, repoPicker.value, kind, noteInput.value, scheduleInput.value || null);
    close();
    toast(kind === "task" ? "Task saved to Focus" : "Note saved to Focus");
    if (page === "focus") renderFocus();
  };
  function chooseKind(next: "task" | "note") {
    kind = next;
    taskType.classList.toggle("active", next === "task");
    noteType.classList.toggle("active", next === "note");
    noteInput.placeholder = next === "task" ? "Add a note or a little context…" : "Write down the idea or details…";
    scheduleCaption.textContent = next === "task" ? "Due date" : "Reminder date (optional)";
    scheduleHint.textContent = next === "task" ? "The task is scheduled for today by default." : "Optional date for this note";
    scheduleInput.value = next === "task" ? todayKey() : "";
    scheduleInput.setAttribute("aria-label", next === "task" ? "Due date" : "Reminder date");
  }
  const dialog = h("section", { class: "quick-capture-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Quick capture" },
    h("div", { class: "capture-head" }, h("div", {}, h("div", { class: "eyebrow", text: "QUICK CAPTURE" }), h("h2", { text: "Save it before it slips away" })), h("button", { class: "capture-close", title: "Close", text: "×", onclick: close })),
    h("div", { class: "capture-types" }, taskType, noteType),
    h("label", { class: "capture-label", text: "Title" }), titleInput,
    h("label", { class: "capture-label", text: "Note" }), noteInput,
    h("label", { class: "capture-label", text: "Project" }), repoPicker,
    scheduleCaption,
    h("div", { class: "capture-date-row" }, svg(ICONS.clock, 14), scheduleInput, scheduleHint),
    h("div", { class: "capture-footer" }, h("span", { text: "Ctrl + Enter to save · Esc to close" }), h("button", { class: "toolbar-button primary", onclick: submit }, svg(ICONS.plus, 12), "Save")),
  );
  overlay.append(dialog);
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(); });
  dialog.addEventListener("keydown", (event) => {
    const key = event as KeyboardEvent;
    if (key.key === "Escape") { key.preventDefault(); close(); }
    else if (key.key === "Enter" && (key.ctrlKey || key.metaKey)) { key.preventDefault(); submit(); }
  });
  document.body.append(overlay);
  if (kind === "note") noteInput.placeholder = "Write down the idea or details…";
  titleInput.focus();
}

function renderFocus() {
  window.clearInterval(focusTick);
  clear(mainContent);
  const openTasks = focus.tasks.filter((task) => task.kind !== "note" && !task.doneAt);
  const notes = focus.tasks.filter((task) => task.kind === "note")
    .sort((a, b) => (a.scheduledFor ?? "9999-12-31").localeCompare(b.scheduledFor ?? "9999-12-31") || b.createdAt - a.createdAt);
  const completedToday = focus.tasks.filter((task) => task.kind !== "note" && task.doneAt && new Date(task.doneAt).toDateString() === new Date().toDateString());
  const sessionsToday = focus.sessions.filter((session) => new Date(session.at).toDateString() === new Date().toDateString());
  const focusedMinutes = sessionsToday.reduce((sum, session) => sum + session.minutes, 0);
  const stats = h("div", { class: "stats focus-stats" },
    h("div", { class: "stat-card" }, h("div", { class: "stat-label", text: "Still to do" }), h("div", { class: "stat-value", text: formatNumber(openTasks.length) })),
    h("div", { class: "stat-card" }, h("div", { class: "stat-label", text: "Done today" }), h("div", { class: "stat-value", text: formatNumber(completedToday.length) })),
    h("div", { class: "stat-card" }, h("div", { class: "stat-label", text: "Focus today" }), h("div", { class: "stat-value" }, formatNumber(focusedMinutes), h("small", { text: "minutes" }))),
  );

  const taskList = h("div", { class: "focus-task-list task-items" });
  const noteList = h("div", { class: "focus-task-list note-items" });
  function drawTasks() {
    clear(taskList);
    const list = focus.tasks.filter((task) => task.kind !== "note" && (!task.doneAt || new Date(task.doneAt).toDateString() === new Date().toDateString()))
      .sort((a, b) => Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt)) || (a.scheduledFor ?? "9999-12-31").localeCompare(b.scheduledFor ?? "9999-12-31"));
    if (!list.length) {
      taskList.append(h("div", { class: "focus-empty task-empty" }, mochiPortrait({ size: 64, follow: true, idleMoods: ["whistle", "lookAround", "hop", "curious"], clickMoods: ["giggle", "excited"] }), h("b", { text: "No tasks yet" }), h("span", { text: "Add a task and make the next step easy." })));
      return;
    }
    for (const task of list) {
      const done = Boolean(task.doneAt);
      const repo = task.repo ? catalog?.repositories.find((item) => item.fullName === task.repo) : null;
      const row = h("div", { class: `focus-task ${done ? "done" : ""} ${!done && task.scheduledFor && task.scheduledFor < todayKey() ? "overdue" : ""}` });
      row.append(h("button", { class: `task-check ${done ? "checked" : ""}`, title: done ? "Mark as not done" : "Complete task", onclick: (event: Event) => {
        if (!done) popConfetti(event.currentTarget as HTMLElement);
        task.doneAt = done ? null : Date.now();
        saveFocus();
        renderFocus();
      } }, done ? "✓" : ""));
      const taskMeta = h("div", { class: "plan-item-meta" }, task.repo ? h("small", { class: "task-project", text: repo?.name ?? task.repo }) : null, planDatePicker(task, "task"));
      row.append(h("div", { class: "task-copy" }, h("b", { text: task.title }), task.note ? h("small", { class: "task-detail", text: task.note }) : null, taskMeta));
      row.append(h("button", { class: "task-delete", title: "Remove task", text: "×", onclick: () => {
        focus.tasks = focus.tasks.filter((item) => item.id !== task.id);
        saveFocus();
        renderFocus();
      } }));
      taskList.append(row);
    }
  }
  function drawNotes() {
    clear(noteList);
    if (!notes.length) {
      noteList.append(h("div", { class: "focus-empty note-empty" }, h("span", { class: "note-empty-mark" }, svg(ICONS.doc, 16)), h("b", { text: "Nothing to note yet" }), h("span", { text: "Keep ideas and project details here for later." })));
      return;
    }
    for (const note of notes) {
      const repo = note.repo ? catalog?.repositories.find((item) => item.fullName === note.repo) : null;
      const noteMeta = h("div", { class: "plan-item-meta" }, note.repo ? h("small", { class: "task-project", text: repo?.name ?? note.repo }) : null, planDatePicker(note, "note"));
      const card = h("article", { class: "focus-note-card" },
        h("span", { class: "note-mark", title: "Note" }, svg(ICONS.doc, 14)),
        h("div", { class: "task-copy note-copy" }, h("b", { text: note.title }), note.note ? h("small", { class: "task-detail", text: note.note }) : null, noteMeta),
        h("button", { class: "task-delete", title: "Remove note", text: "×", onclick: () => {
          focus.tasks = focus.tasks.filter((item) => item.id !== note.id);
          saveFocus();
          renderFocus();
        } }),
      );
      noteList.append(card);
    }
  }
  drawTasks();
  drawNotes();

  const taskInput = h("input", { id: "focus-task-input", placeholder: "What needs your attention?", maxlength: "120" }) as HTMLInputElement;
  const taskDateInput = h("input", { class: "task-compose-date", type: "date", value: todayKey(), title: "Due date", "aria-label": "Due date" }) as HTMLInputElement;
  const repoOptions: HTMLOptionElement[] = [h("option", { value: "", text: "General" })];
  for (const repo of catalog?.repositories ?? []) repoOptions.push(h("option", { value: repo.fullName, text: repo.fullName }));
  const repoPicker = h("select", { class: "focus-repo-select", title: "Attach to a repository" }, ...repoOptions) as HTMLSelectElement;
  const addTask = () => {
    const value = taskInput.value.trim().replace(/\s+/g, " ");
    if (!value) { taskInput.focus(); return; }
    saveCapturedItem(value, repoPicker.value, "task", "", taskDateInput.value || null);
    taskInput.value = "";
    renderFocus();
    document.getElementById("focus-task-input")?.focus();
  };
  taskInput.addEventListener("keydown", (event) => { if (event.key === "Enter") addTask(); });
  const addButton = h("button", { class: "toolbar-button primary", onclick: addTask }, svg(ICONS.plus, 12), "Add task");
  const taskComposer = h("div", { class: "task-composer" }, taskInput, taskDateInput, repoPicker, addButton);
  const reminderTimeInput = h("input", { class: "reminder-time-picker", type: "time", value: reminderPrefs.time, title: "Your reminder time", "aria-label": "Your reminder time", onchange: (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (/^\d{2}:\d{2}$/.test(value)) { reminderPrefs.time = value; saveReminderPrefs(); processPlanReminders(); }
  } }) as HTMLInputElement;
  const reminderToggle = h("button", { class: `reminder-toggle ${reminderPrefs.enabled ? "active" : ""}`, text: reminderPrefs.enabled ? "On" : "Off", onclick: () => {
    if (reminderPrefs.enabled) { reminderPrefs.enabled = false; saveReminderPrefs(); renderFocus(); }
    else void enablePlanReminders();
  } });
  const reminderSettings = h("div", { class: `plan-reminder-settings ${reminderPrefs.enabled ? "enabled" : ""}` },
    h("span", { class: "reminder-icon" }, svg(ICONS.bell, 13)),
    h("div", { class: "reminder-copy" }, h("b", { text: "Daily reminders" }), h("small", { text: "Tasks repeat until done · notes remind once" })),
    reminderTimeInput,
    reminderToggle,
  );

  const circumference = 2 * Math.PI * 62;
  const timerSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  timerSvg.setAttribute("viewBox", "0 0 160 160");
  timerSvg.classList.add("timer-ring");
  const makeCircle = (className: string) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "80"); circle.setAttribute("cy", "80"); circle.setAttribute("r", "62");
    circle.classList.add(className);
    return circle;
  };
  timerSvg.append(makeCircle("timer-track"));
  const progress = makeCircle("timer-progress");
  progress.style.strokeDasharray = String(circumference);
  timerSvg.append(progress);
  const timeLabel = h("div", { class: "timer-time", text: fmtClock(focus.remaining) });
  const modeLabel = h("div", { class: "timer-mode-label", text: "FOCUS SESSION" });
  const modes = h("div", { class: "timer-modes" });
  const modeButtons: Record<FocusMode, HTMLButtonElement> = {
    focus: h("button", { class: `timer-mode ${focus.mode === "focus" ? "active" : ""}`, text: "Focus", onclick: () => beginFocusMode("focus") }),
    short: h("button", { class: `timer-mode ${focus.mode === "short" ? "active" : ""}`, text: "Short break", onclick: () => beginFocusMode("short") }),
    long: h("button", { class: `timer-mode ${focus.mode === "long" ? "active" : ""}`, text: "Long break", onclick: () => beginFocusMode("long") }),
  };
  modes.append(modeButtons.focus, modeButtons.short, modeButtons.long);
  const timerButtons = h("div", { class: "timer-buttons" });
  const startButton = h("button", { class: "timer-start", text: focus.running ? "Pause" : focus.remaining < focusMinutesFor(focus.mode) * 60 ? "Resume" : "Start focus", onclick: () => {
    if (focus.running && focus.endAt) {
      focus.remaining = Math.max(0, Math.ceil((focus.endAt - Date.now()) / 1000));
      focus.running = false;
      focus.endAt = null;
    } else {
      if (focus.remaining <= 0) focus.remaining = focusMinutesFor(focus.mode) * 60;
      focus.running = true;
      focus.endAt = Date.now() + focus.remaining * 1000;
    }
    saveFocus();
    renderFocus();
  } });
  const resetButton = h("button", { class: "timer-reset", title: "Reset timer", onclick: () => beginFocusMode(focus.mode) }, svg(ICONS.refresh, 13));
  timerButtons.append(startButton, resetButton);

  const timer = h("section", { class: `focus-panel timer-panel ${focus.running ? "running" : ""}` },
    h("div", { class: "focus-panel-head" }, h("div", {}, h("div", { class: "eyebrow", text: "POMODORO" }), h("h2", { text: "Make room to focus" })), h("span", { class: "timer-state", text: focus.running ? "IN SESSION" : "READY" })),
    modes,
    h("div", { class: "timer-visual" }, timerSvg, h("div", { class: "timer-center" }, timeLabel, modeLabel)),
    focus.mode === "focus" ? h("div", { class: "timer-lengths" }, "Session", ...[15, 25, 45].map((minutes) => h("button", { class: `length-choice ${focus.focusMinutes === minutes ? "active" : ""}`, text: `${minutes}m`, onclick: () => {
      focus.focusMinutes = minutes;
      if (!focus.running) focus.remaining = minutes * 60;
      saveFocus(); renderFocus();
    } }))) : null,
    timerButtons,
    h("div", { class: "session-count" }, `${sessionsToday.length} focus ${sessionsToday.length === 1 ? "session" : "sessions"} completed today`),
  );

  const tasksPanel = h("section", { class: "focus-panel tasks-panel" },
    h("div", { class: "focus-panel-head" }, h("div", {}, h("div", { class: "eyebrow", text: "YOUR PLAN" }), h("h2", { text: "Plan your work" })), h("span", { class: "task-count", text: `${openTasks.length} open` })),
    taskComposer,
    reminderSettings,
    h("section", { class: "focus-section tasks-section" }, h("div", { class: "focus-section-head" }, h("div", { class: "focus-section-title" }, svg(ICONS.check, 13), h("b", { text: "Tasks" })), h("span", { class: "focus-section-count task-section-count", text: `${openTasks.length} open` })), taskList),
    h("section", { class: `focus-section notes-section ${notes.length ? "" : "notes-section-empty"}` }, h("div", { class: "focus-section-head" }, h("div", { class: "focus-section-title notes-title" }, svg(ICONS.doc, 13), h("b", { text: "Notes" })), h("div", { class: "notes-head-actions" }, h("span", { class: "focus-section-count note-section-count", text: `${notes.length} notes` }), h("button", { class: "note-add-button", title: "Add note", onclick: () => openQuickCapture("note") }, svg(ICONS.plus, 12), h("span", { text: "Add note" })))), noteList),
  );
  mainContent.append(stats, h("div", { class: "focus-layout" }, tasksPanel, timer));

  function tick() {
    if (focus.running && focus.endAt) {
      const remaining = Math.ceil((focus.endAt - Date.now()) / 1000);
      if (remaining <= 0) {
        finishFocusSession();
        return;
      }
      focus.remaining = remaining;
      timeLabel.textContent = fmtClock(remaining);
      startButton.textContent = "Pause";
      timer.classList.add("running");
      const total = focusMinutesFor(focus.mode) * 60;
      progress.style.strokeDashoffset = String(circumference * (1 - Math.min(1, remaining / total)));
    } else {
      const total = focusMinutesFor(focus.mode) * 60;
      progress.style.strokeDashoffset = String(circumference * (1 - Math.min(1, focus.remaining / total)));
    }
  }
  tick();
  focusTick = window.setInterval(tick, 1000);
}

function openProjectSearch() {
  if (document.querySelector(".project-search-overlay")) return;
  let sequence = 0;
  let selected = 0;
  let timer = 0;
  const input = h("input", { class: "project-search-input", placeholder: "Search file names and text...", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const projects: SearchProject[] = (catalog?.repositories ?? []).flatMap((repo) => repo.localPath ? [{ name: repo.fullName, path: repo.localPath }] : []);
  const scope = h("select", { class: "project-search-scope", "aria-label": "Project scope" }, h("option", { value: "all", text: "All local projects" })) as HTMLSelectElement;
  for (const project of projects) scope.append(h("option", { value: project.path, text: project.name }));
  const status = h("div", { class: "project-search-status", text: projects.length ? "Type at least 2 characters to search." : "No local projects available. Connect GitHub and clone a project first." });
  const results = h("div", { class: "project-search-results", role: "listbox" });
  const overlay = h("div", { class: "project-search-overlay" }, h("section", { class: "project-search-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Search local project files" },
    h("div", { class: "project-search-heading" }, h("div", {}, h("div", { class: "eyebrow", text: "COUCOU WORKSPACE" }), h("h2", { text: "Search local project files" }), h("p", { text: "Find files, TODOs and code across your local projects." })), h("button", { class: "capture-close", "aria-label": "Close", text: "×", onclick: () => overlay.remove() })),
    h("div", { class: "project-search-controls" }, h("label", { class: "project-search-field" }, svg(ICONS.search, 16), input), scope),
    status,
    results,
    h("div", { class: "project-search-foot" }, h("span", { text: "Search stays on this device. Generated folders and large/binary files are skipped." }), h("kbd", { text: "ESC" }), h("kbd", { text: "↑ ↓" }), h("kbd", { text: "↵" })),
  ));
  const close = () => { window.clearTimeout(timer); overlay.remove(); };
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(); });

  function draw(hits: ProjectSearchHit[]) {
    clear(results);
    selected = Math.min(selected, Math.max(0, hits.length - 1));
    hits.forEach((hit, index) => results.append(h("button", {
      class: `project-search-hit ${selected === index ? "selected" : ""}`,
      role: "option", "aria-selected": selected === index,
      onclick: () => { close(); void Bridge.openProjectFile(hit.path, hit.line); },
    }, h("span", { class: "project-search-hit-icon" }, svg(hit.kind === "file" ? ICONS.doc : ICONS.code, 15)),
    h("span", { class: "project-search-hit-copy" }, h("b", { text: hit.relativePath }), h("small", { text: `${hit.project} · ${hit.kind === "file" ? "File name" : `Line ${hit.line} · Text match`}` }), hit.kind === "content" ? h("code", { text: hit.preview }) : null),
    h("span", { class: "project-search-hit-open", text: "Open in VS Code" }))));
  }

  async function runSearch() {
    const term = input.value.trim();
    const request = ++sequence;
    selected = 0;
    clear(results);
    if (term.length < 2) { status.textContent = projects.length ? "Type at least 2 characters to search." : "No local projects available. Connect GitHub and clone a project first."; return; }
    if (!projects.length) { status.textContent = "No local projects available. Connect GitHub and clone a project first."; return; }
    status.textContent = "Searching...";
    const selectedProjects = scope.value === "all" ? projects : projects.filter((project) => project.path === scope.value);
    try {
      const hits = await Bridge.searchLocalProjects(selectedProjects, term) ?? [];
      if (request !== sequence || !overlay.isConnected) return;
      draw(hits);
      status.textContent = hits.length ? `${hits.length} result${hits.length === 1 ? "" : "s"} · showing up to 100` : "No matching files or text found.";
    } catch (error) {
      if (request !== sequence || !overlay.isConnected) return;
      status.textContent = String(error);
    }
  }

  input.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => void runSearch(), 220); });
  scope.addEventListener("change", () => void runSearch());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const items = results.querySelectorAll<HTMLButtonElement>(".project-search-hit");
      if (items.length) { event.preventDefault(); selected = (selected + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length; items.forEach((item, index) => item.classList.toggle("selected", index === selected)); items[selected]?.scrollIntoView({ block: "nearest" }); }
    } else if (event.key === "Enter") { event.preventDefault(); results.querySelectorAll<HTMLButtonElement>(".project-search-hit")[selected]?.click(); }
  });
  document.body.append(overlay);
  input.focus();
}

interface HubCommand { title: string; detail: string; icon: string; run: () => void }
function openCommandPalette() {
  if (document.querySelector(".command-overlay")) return;
  let selected = 0;
  const search = h("input", { class: "command-input", placeholder: "Search pages, repositories, actions…", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const results = h("div", { class: "command-results", role: "listbox" });
  const overlay = h("div", { class: "command-overlay" }, h("div", { class: "command-palette" },
    h("div", { class: "command-search" }, svg(ICONS.search, 15), search, h("kbd", { text: "ESC" })),
    results,
    h("div", { class: "command-footer" }, h("span", { text: "↑↓ navigate" }), h("span", { text: "↵ open" }), h("span", { text: "Ctrl K close" })),
  ));
  const close = () => overlay.remove();
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(); });

  function commands(): HubCommand[] {
    const term = search.value.trim().toLowerCase();
    const pages: HubCommand[] = [
      { title: "Projects", detail: "Browse GitHub repositories and local Git status", icon: ICONS.stack, run: () => setPage("repositories") },
      { title: "Work queue", detail: "See assigned issues and review requests alongside your focus tasks", icon: ICONS.check, run: () => setPage("queue") },
      { title: "Quick capture", detail: "Save a task or note to a project · Ctrl Shift N", icon: ICONS.plus, run: openQuickCapture },
      { title: "Search local project files", detail: "Find files, TODOs and code · Ctrl Shift F", icon: ICONS.search, run: openProjectSearch },
      { title: "Focus & tasks", detail: "Open your daily task list and focus timer", icon: ICONS.timer, run: () => { setPage("focus"); window.setTimeout(() => document.getElementById("focus-task-input")?.focus(), 50); } },
      { title: "Daily history", detail: "Review focus sessions, completed tasks and opened projects", icon: ICONS.clock, run: () => setPage("activity") },
      { title: "Notifications", detail: "Review, mute or snooze Coucou alerts", icon: ICONS.bell, run: openNotificationCenter },
      { title: "Music for work", detail: "Open your music preferences and mixes", icon: ICONS.music, run: () => setPage("music") },
      { title: "Surprise me with music", detail: "Search YouTube Music using your saved taste", icon: ICONS.shuffle, run: () => { setPage("music"); openMusicSearch(randomQuery()); } },
      { title: "Refresh repositories", detail: "Fetch the latest repository details", icon: ICONS.refresh, run: () => { setPage("repositories"); void loadRepos(); } },
      { title: "Refresh work queue", detail: "Sync your assigned GitHub work", icon: ICONS.refresh, run: () => { if (page !== "queue") setPage("queue"); else void loadQueue(); } },
    ];
    const repos = (catalog?.repositories ?? []).filter((repo) => !term || `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""}`.toLowerCase().includes(term))
      .slice(0, 8).map((repo): HubCommand => ({
        title: repo.fullName,
        detail: repo.localPath ? `Open in VS Code · ${repo.localPath}` : `Open on GitHub · ${repo.language ?? "Repository"}`,
        icon: repo.localPath ? ICONS.code : ICONS.stack,
        run: () => repo.localPath ? openProjectInVSCode(repo) : openProjectOnGitHub(repo),
      }));
    if (term.startsWith(">")) return pages.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(term.slice(1).trim()));
    return term ? [...repos, ...pages.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(term))] : pages;
  }

  function draw() {
    clear(results);
    const items = commands();
    selected = Math.min(selected, Math.max(0, items.length - 1));
    if (!items.length) {
      results.append(h("div", { class: "command-empty", text: "No matching command or repository." }));
      return;
    }
    items.forEach((item, index) => results.append(h("button", {
      class: `command-item ${selected === index ? "selected" : ""}`,
      role: "option",
      "aria-selected": selected === index,
      onclick: () => { close(); item.run(); },
    }, h("span", { class: "command-icon" }, svg(item.icon, 14)), h("span", { class: "command-label" }, h("b", { text: item.title }), h("small", { text: item.detail })), svg(ICONS.chevronRight, 12))));
  }

  search.addEventListener("input", () => { selected = 0; draw(); });
  search.addEventListener("keydown", (event) => {
    const key = event as KeyboardEvent;
    if (key.key === "Escape") { key.preventDefault(); close(); }
    else if (key.key === "ArrowDown" || key.key === "ArrowUp") { key.preventDefault(); const length = results.querySelectorAll(".command-item").length; selected = (selected + (key.key === "ArrowDown" ? 1 : length - 1)) % Math.max(1, length); draw(); }
    else if (key.key === "Enter") { key.preventDefault(); results.querySelectorAll<HTMLButtonElement>(".command-item")[selected]?.click(); }
  });
  draw();
  document.body.append(overlay);
  search.focus();
}

interface QueueEntry {
  id: string;
  title: string;
  project: string;
  kind: "issue" | "pullRequest" | "review" | "task";
  url?: string;
  updatedAt: number;
  labels: string[];
  comments: number;
  taskId?: string;
  draft?: boolean;
}

function queueEntries(): QueueEntry[] {
  const github: QueueEntry[] = (queueData?.items ?? []).map((item) => ({
    id: item.id, title: item.title, project: item.repository, kind: item.kind,
    url: item.htmlUrl, updatedAt: Date.parse(item.updatedAt) || Date.parse(item.createdAt) || 0,
    labels: item.labels, comments: item.comments, draft: item.draft,
  }));
  const local: QueueEntry[] = focus.tasks
    .filter((task) => !task.doneAt && task.kind !== "note")
    .map((task) => ({ id: `local:${task.id}`, taskId: task.id, title: task.title, project: task.repo || "General", kind: "task", updatedAt: task.createdAt, labels: [], comments: 0 }));
  return [...github, ...local];
}

function queuePriority(item: QueueEntry): number {
  const labels = item.labels.join(" ").toLowerCase();
  if (/\b(p0|urgent|critical|blocker)\b/.test(labels)) return 0;
  if (item.kind === "review") return 1;
  if (/\b(p1|high)\b/.test(labels)) return 2;
  if (item.kind === "task") return 3;
  return 4;
}

function completeQueueTask(taskId: string) {
  const task = focus.tasks.find((item) => item.id === taskId);
  if (!task || task.doneAt) return;
  task.doneAt = Date.now();
  saveFocus();
  recordActivity("task", task.title, task.repo, "Task completed");
  renderQueue();
  toast("Task completed");
}

function renderQueue() {
  if (page !== "queue") return;
  clear(mainContent);
  const entries = queueEntries();
  const reviews = entries.filter((item) => item.kind === "review").length;
  const localCount = entries.filter((item) => item.kind === "task").length;
  const stat = (label: string, value: number, hint: string) => h("div", { class: "stat-card" }, h("div", { class: "stat-label", text: label }), h("div", { class: "stat-value" }, formatNumber(value), h("small", { text: hint })));
  mainContent.append(h("div", { class: "stats queue-stats" },
    stat("Open items", entries.length, "need your attention"),
    stat("Review requests", reviews, "waiting on your review"),
    stat("Focus tasks", localCount, "saved in Coucou"),
  ));

  const search = h("input", { type: "search", placeholder: "Search titles, projects or labels…", value: queueSearch }) as HTMLInputElement;
  const filters = h("div", { class: "filters queue-filters" });
  const options: [QueueFilter, string][] = [["all", "All work"], ["github", "GitHub issues & PRs"], ["reviews", "Reviews"], ["local", "Local tasks"]];
  for (const [key, label] of options) filters.append(h("button", { class: `filter ${queueFilter === key ? "active" : ""}`, text: label, onclick: () => { queueFilter = key; renderQueue(); } }));
  const resultCount = h("span", { class: "result-count" });
  const toolbar = h("div", { class: "repo-toolbar queue-toolbar" }, h("label", { class: "search-wrap" }, svg(ICONS.search, 13), search), filters, resultCount);
  const scroll = h("div", { class: "queue-scroll" });
  const list = h("div", { class: "queue-list" });
  scroll.append(list);
  mainContent.append(toolbar);
  if (queueLoading) mainContent.append(h("div", { class: "queue-status loading" }, h("span", { class: "queue-spinner" }), h("span", { text: "Syncing GitHub work…" })));
  if (queueError) mainContent.append(h("div", { class: "queue-status error" }, h("div", {}, h("b", { text: "Connect GitHub to see assigned issues and review requests." }), h("span", { text: queueError })), h("button", { class: "toolbar-button", text: "Settings", onclick: () => void Bridge.openSettingsWindow() })));
  if (queueData?.warning) mainContent.append(h("div", { class: "queue-status warning" }, h("span", { text: "Some review requests could not be loaded." }), h("small", { text: queueData.warning })));
  mainContent.append(scroll);

  const renderCards = () => {
    const normalized = queueSearch.trim().toLowerCase();
    const filtered = entries.filter((item) => {
      if (queueFilter === "github" && item.kind === "task") return false;
      if (queueFilter === "reviews" && item.kind !== "review") return false;
      if (queueFilter === "local" && item.kind !== "task") return false;
      return !normalized || [item.title, item.project, ...item.labels].join(" ").toLowerCase().includes(normalized);
    }).sort((a, b) => queuePriority(a) - queuePriority(b) || b.updatedAt - a.updatedAt);
    resultCount.textContent = `${formatNumber(filtered.length)} shown`;
    clear(list);
    if (!filtered.length) {
      const empty = entries.length
        ? h("div", { class: "queue-empty", text: "No work matches this view." })
        : h("div", { class: "queue-empty" }, h("span", { class: "queue-empty-mark" }, svg(ICONS.check, 18)), h("b", { text: "Nothing is waiting for you" }), h("span", { text: "Assigned work and requested reviews from GitHub will show up here." }));
      list.append(empty);
      return;
    }
    for (const [index, item] of filtered.entries()) {
      const typeLabel = item.kind === "review" ? "Review requested" : item.kind === "pullRequest" ? "Pull request" : item.kind === "issue" ? "Issue assigned" : "Focus task";
      const kindIcon = item.kind === "task" ? ICONS.check : item.kind === "review" ? ICONS.branch : item.kind === "pullRequest" ? ICONS.code : ICONS.bang;
      const priority = queuePriority(item);
      const card = h("article", { class: `queue-card ${item.kind}`, style: `animation-delay:${Math.min(index, 8) * 24}ms` });
      const heading = h("div", { class: "queue-card-heading" },
        h("span", { class: `queue-kind-icon ${item.kind}` }, svg(kindIcon, 14)),
        h("div", { class: "queue-card-title" }, h("b", { text: item.title }), h("span", { text: item.project })),
        h("div", { class: "queue-badges" },
          h("span", { class: `queue-kind-badge ${item.kind}`, text: typeLabel }),
          priority <= 2 && item.kind !== "review" ? h("span", { class: `queue-priority p${priority}`, text: priority === 0 ? "Urgent" : "High" }) : null,
          item.draft ? h("span", { class: "queue-draft", text: "Draft" }) : null,
        ),
      );
      const metadata = h("div", { class: "queue-card-meta" },
        item.labels.length ? h("div", { class: "queue-labels" }, ...item.labels.slice(0, 4).map((label) => h("span", { class: "queue-label", text: label }))) : h("span", { class: "queue-no-labels", text: item.kind === "task" ? "Your personal task" : "No labels" }),
        h("span", { class: "queue-updated", text: `${item.comments ? `${formatNumber(item.comments)} comments · ` : ""}${item.updatedAt ? `Updated ${timeAgo(new Date(item.updatedAt).toISOString())}` : ""}` }),
      );
      const actions = h("div", { class: "queue-card-actions" });
      const linkedRepo = catalog?.repositories.find((repo) => repo.fullName.toLowerCase() === item.project.toLowerCase() && repo.localPath);
      if (item.kind === "task" && item.taskId) {
        if (linkedRepo) actions.append(h("button", { class: "queue-action", onclick: () => openProjectInVSCode(linkedRepo) }, svg(ICONS.code, 13), h("span", { text: "Open project" })));
        actions.append(h("button", { class: "queue-action complete", title: "Mark complete", "aria-label": "Mark complete", onclick: () => completeQueueTask(item.taskId!) }, svg(ICONS.check, 14), h("span", { text: "Complete" })));
      } else if (item.url) {
        if (linkedRepo) actions.append(h("button", { class: "queue-action", onclick: () => openProjectInVSCode(linkedRepo) }, svg(ICONS.code, 13), h("span", { text: "Open project" })));
        actions.append(h("button", { class: "queue-action open", onclick: () => void Bridge.openUrl(item.url!) }, svg(ICONS.arrowUpRight, 13), h("span", { text: "Open in GitHub" })));
      }
      card.append(heading, metadata, actions);
      list.append(card);
    }
  };
  search.addEventListener("input", () => { queueSearch = search.value; renderCards(); });
  renderCards();
}

function renderPage() {
  if (page === "music") renderMusic();
  else if (page === "focus") renderFocus();
  else if (page === "activity") renderActivity();
  else if (page === "queue") renderQueue();
  else renderRepos();
}

void loadRepos();
updateNotificationBadge();
void onEvent<AgentNotificationEvent>("hub-agent-notification", addAgentNotification);
void onEvent<ApprovalResolutionEvent>("hub-approval-resolved", resolveApproval);
processSnoozedNotifications();
processPlanReminders();
window.setInterval(processSnoozedNotifications, 15_000);
window.setInterval(processPlanReminders, 30_000);
window.setInterval(() => { if (focus.running && focus.endAt && focus.endAt <= Date.now()) finishFocusSession(); }, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    processSnoozedNotifications();
    processPlanReminders();
    if (focus.running && focus.endAt && focus.endAt <= Date.now()) finishFocusSession();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    openProjectSearch();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
  } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    openQuickCapture();
  }
});
