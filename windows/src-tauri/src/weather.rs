//! Weather for Mochi's outfit — umbrella in the rain, scarf in the cold,
//! sunglasses in the sun. Off until the user turns it on and picks a city.
//!
//! Open-Meteo needs no key and no account. The only thing it is ever sent is
//! the latitude and longitude of the city chosen in Settings (or the city name,
//! while searching for it). Nothing is sent while the feature is off or Coucou
//! is paused.

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::island::WINDOW_LABEL;
use crate::log;

const TIMEOUT: Duration = Duration::from_secs(10);
/// The weather changes slowly; every half hour is plenty.
const EVERY: Duration = Duration::from_secs(30 * 60);

/// Woken when the settings change, so a new city shows up without a restart.
static WAKE: std::sync::LazyLock<Notify> = std::sync::LazyLock::new(Notify::new);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    pub country: String,
    pub admin: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeatherNow {
    /// WMO weather code (0 clear … 95 thunderstorm).
    pub code: i64,
    pub temperature: f64,
    pub feels_like: f64,
    pub is_day: bool,
    pub wind: f64,
    pub city: String,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(TIMEOUT).build().unwrap_or_default()
}

/// City search for the settings window.
pub async fn search(query: String) -> Result<Vec<Place>, String> {
    let query = query.trim().to_string();
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let res = client()
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[("name", query.as_str()), ("count", "6"), ("format", "json")])
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Open-Meteo ({e})"))?;
    if !res.status().is_success() {
        return Err(format!("Open-Meteo error {}", res.status().as_u16()));
    }
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    let places = json
        .get("results")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|p| {
                    Some(Place {
                        name: p.get("name")?.as_str()?.to_string(),
                        country: p.get("country").and_then(Value::as_str).unwrap_or_default().to_string(),
                        admin: p.get("admin1").and_then(Value::as_str).unwrap_or_default().to_string(),
                        latitude: p.get("latitude")?.as_f64()?,
                        longitude: p.get("longitude")?.as_f64()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(places)
}

/// Current weather at a point.
pub async fn fetch(latitude: f64, longitude: f64, city: String) -> Result<WeatherNow, String> {
    let res = client()
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", format!("{latitude:.3}")),
            ("longitude", format!("{longitude:.3}")),
            ("current", "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m".into()),
            ("timezone", "auto".into()),
        ])
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Open-Meteo ({e})"))?;
    if !res.status().is_success() {
        return Err(format!("Open-Meteo error {}", res.status().as_u16()));
    }
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    let c = json.get("current").ok_or("No current weather in the reply")?;
    let num = |k: &str| c.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    Ok(WeatherNow {
        code: c.get("weather_code").and_then(Value::as_i64).unwrap_or(0),
        temperature: num("temperature_2m"),
        feels_like: num("apparent_temperature"),
        is_day: c.get("is_day").and_then(Value::as_i64).unwrap_or(1) == 1,
        wind: num("wind_speed_10m"),
        city,
    })
}

/// The city in the settings, when the feature is on.
fn configured(app: &AppHandle) -> Option<(f64, f64, String)> {
    let shared = app.try_state::<crate::Shared>()?;
    let s = shared.settings.lock().unwrap();
    if !s.weather_enabled || s.weather_city.is_empty() {
        return None;
    }
    Some((s.weather_latitude, s.weather_longitude, s.weather_city.clone()))
}

/// Settings changed: fetch now rather than at the next half hour.
pub fn poke() {
    WAKE.notify_one();
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(4)).await;
        loop {
            if !crate::integrations::PAUSED.load(Ordering::Relaxed) {
                if let Some((lat, lon, city)) = configured(&app) {
                    match fetch(lat, lon, city).await {
                        Ok(now) => {
                            let _ = app.emit_to(WINDOW_LABEL, "weather", now);
                        }
                        Err(err) => log::line(format!("weather: {err}")),
                    }
                } else {
                    // Turned off: tell the island to take the umbrella down.
                    let _ = app.emit_to(WINDOW_LABEL, "weather", Value::Null);
                }
            }
            // Whichever comes first: the half hour, or a settings change.
            let _ = tokio::time::timeout(EVERY, WAKE.notified()).await;
        }
    });
}
