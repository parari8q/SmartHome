// Pogoda z Open-Meteo (bez klucza API).

export const WEATHER_CODES = {
  0: { text: "Bezchmurnie", cat: "clear" },
  1: { text: "Prawie bezchmurnie", cat: "clear" },
  2: { text: "Częściowe zachmurzenie", cat: "cloud" },
  3: { text: "Pochmurno", cat: "cloud" },
  45: { text: "Mgła", cat: "fog" },
  48: { text: "Mgła osadzająca szron", cat: "fog" },
  51: { text: "Lekka mżawka", cat: "rain" },
  53: { text: "Mżawka", cat: "rain" },
  55: { text: "Gęsta mżawka", cat: "rain" },
  56: { text: "Marznąca mżawka", cat: "rain" },
  57: { text: "Marznąca mżawka", cat: "rain" },
  61: { text: "Lekki deszcz", cat: "rain" },
  63: { text: "Deszcz", cat: "rain" },
  65: { text: "Ulewny deszcz", cat: "rain" },
  66: { text: "Marznący deszcz", cat: "rain" },
  67: { text: "Marznący deszcz", cat: "rain" },
  71: { text: "Lekki śnieg", cat: "snow" },
  73: { text: "Śnieg", cat: "snow" },
  75: { text: "Intensywny śnieg", cat: "snow" },
  77: { text: "Śnieg ziarnisty", cat: "snow" },
  80: { text: "Przelotny deszcz", cat: "rain" },
  81: { text: "Przelotny deszcz", cat: "rain" },
  82: { text: "Gwałtowny deszcz", cat: "rain" },
  85: { text: "Przelotny śnieg", cat: "snow" },
  86: { text: "Przelotny śnieg", cat: "snow" },
  95: { text: "Burza", cat: "storm" },
  96: { text: "Burza z gradem", cat: "storm" },
  99: { text: "Burza z gradem", cat: "storm" },
};

export const THEMES = {
  "day-clear": { top: "#1d6fb8", bottom: "#6fb6e2", accent: "#ffcf6b" },
  "day-cloud": { top: "#43515f", bottom: "#7f8c98", accent: "#dfe4ea" },
  "day-fog": { top: "#525d68", bottom: "#8b97a1", accent: "#d0d7dd" },
  "day-rain": { top: "#1c4757", bottom: "#447585", accent: "#86d6f2" },
  "day-snow": { top: "#56728a", bottom: "#a9c3d4", accent: "#ffffff" },
  "day-storm": { top: "#29243d", bottom: "#4f4974", accent: "#c9bcff" },
  "night-clear": { top: "#050814", bottom: "#141d36", accent: "#b9c7e0" },
  "night-cloud": { top: "#0a0d16", bottom: "#1d2435", accent: "#9aa3b3" },
  "night-fog": { top: "#0a0d12", bottom: "#232a31", accent: "#a5afb5" },
  "night-rain": { top: "#050c14", bottom: "#132638", accent: "#66b0d8" },
  "night-snow": { top: "#0a1018", bottom: "#28374a", accent: "#dceaf2" },
  "night-storm": { top: "#0a0714", bottom: "#241d3c", accent: "#ad9af2" },
};

export function describeCode(code) {
  return WEATHER_CODES[code] || { text: "Brak danych", cat: "cloud" };
}

export function themeFor(cat, isDay) {
  return THEMES[(isDay ? "day-" : "night-") + cat] || THEMES["night-clear"];
}

export function buildWeatherUrl({ latitude, longitude }) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day" +
    "&hourly=temperature_2m,weather_code,precipitation_probability" +
    "&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min" +
    "&timezone=auto&forecast_days=2";
}

/** Kolejne `count` pelnych godzin po biezacej. */
export function nextHours(hourly, currentIso, count = 6) {
  if (!hourly || !Array.isArray(hourly.time)) return [];
  let start = hourly.time.findIndex((t) => t > currentIso);
  if (start === -1) return [];
  const out = [];
  for (let i = start; i < hourly.time.length && out.length < count; i++) {
    out.push({
      time: hourly.time[i],
      temp: Math.round(hourly.temperature_2m[i]),
      code: hourly.weather_code[i],
      precip: hourly.precipitation_probability ? hourly.precipitation_probability[i] : null,
    });
  }
  return out;
}

export function summarize(data) {
  const cur = data.current;
  const info = describeCode(cur.weather_code);
  return {
    temp: Math.round(cur.temperature_2m),
    feels: Math.round(cur.apparent_temperature),
    humidity: Math.round(cur.relative_humidity_2m),
    wind: Math.round(cur.wind_speed_10m),
    isDay: cur.is_day === 1,
    text: info.text,
    cat: info.cat,
    sunrise: data.daily?.sunrise?.[0] || null,
    sunset: data.daily?.sunset?.[0] || null,
    max: data.daily?.temperature_2m_max ? Math.round(data.daily.temperature_2m_max[0]) : null,
    min: data.daily?.temperature_2m_min ? Math.round(data.daily.temperature_2m_min[0]) : null,
    hours: nextHours(data.hourly, cur.time, 6),
  };
}
