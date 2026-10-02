//! Notices when you lock the screen (or the PC goes to sleep) and when you come
//! back, so Mochi can tell you what happened while you were away.
//!
//! Event-driven, not polled: Windows posts the session changes to a hidden
//! window whose thread sleeps in GetMessage the rest of the time — zero CPU.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage, MSG,
    WINDOW_STYLE, WNDCLASSW, WS_EX_TOOLWINDOW,
};

use crate::island::WINDOW_LABEL;
use crate::log;

const WM_WTSSESSION_CHANGE: u32 = 0x02B1;
const WTS_SESSION_LOCK: usize = 0x7;
const WTS_SESSION_UNLOCK: usize = 0x8;
const WM_POWERBROADCAST: u32 = 0x0218;
const PBT_APMSUSPEND: usize = 0x4;
const PBT_APMRESUMEAUTOMATIC: usize = 0x12;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// When you left (unix ms), or 0 while you're here.
static LEFT_AT: AtomicI64 = AtomicI64::new(0);
static LOCKED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Presence {
    kind: &'static str,
    /// When you left.
    since: i64,
    away_ms: i64,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn emit(kind: &'static str, since: i64) {
    let Some(app) = APP.get() else { return };
    let away_ms = if kind == "back" { now_ms() - since } else { 0 };
    let _ = app.emit_to(WINDOW_LABEL, "presence", Presence { kind, since, away_ms });
}

/// Keeps the earliest moment you left (sleep after lock is still one absence).
fn left() {
    let now = now_ms();
    if LEFT_AT.compare_exchange(0, now, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        emit("left", now);
    }
}

fn back() {
    let since = LEFT_AT.swap(0, Ordering::SeqCst);
    if since > 0 {
        emit("back", since);
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match (msg, wparam.0) {
        (WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK) => {
            LOCKED.store(true, Ordering::SeqCst);
            left();
        }
        (WM_WTSSESSION_CHANGE, WTS_SESSION_UNLOCK) => {
            LOCKED.store(false, Ordering::SeqCst);
            back();
        }
        (WM_POWERBROADCAST, PBT_APMSUSPEND) => left(),
        // Waking without a sign-in screen: you're back now. With one, the unlock says so.
        (WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC) if !LOCKED.load(Ordering::SeqCst) => back(),
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

pub fn start(app: AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    std::thread::spawn(|| unsafe {
        let Ok(module) = GetModuleHandleW(None) else { return };
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: module.into(),
            lpszClassName: w!("CoucouPresence"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            log::line("presence: could not register the window class");
            return;
        }
        // Never shown: a tool window with no size exists only to receive messages
        // (message-only windows do not get session or power broadcasts).
        let Ok(hwnd) = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            w!("CoucouPresence"),
            w!("Coucou presence"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            None,
            None,
            Some(module.into()),
            None,
        ) else {
            log::line("presence: could not create the window");
            return;
        };
        if let Err(err) = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) {
            log::line(format!("presence: no lock notifications ({err})"));
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}
