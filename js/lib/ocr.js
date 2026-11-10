// Rozpoznawanie tekstu ze zdjec/screenow (Tesseract.js, dziala w przegladarce,
// bez wysylania zdjec na zewnatrz). Przed rozpoznaniem obraz jest
// przygotowywany: powiekszenie, skala szarosci, kontrast, odwrocenie kolorow
// dla screenow w trybie ciemnym — to mocno poprawia jakosc na screenach z telefonu.

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TESSERACT_URL;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("brak Tesseract")));
    s.onerror = () => reject(new Error("Rozpoznawanie tekstu wymaga internetu przy pierwszym użyciu."));
    document.head.append(s);
  });
}

export async function preprocess(file) {
  const bitmap = await createImageBitmap(file);
  // screeny telefonu maja ~1080 px szerokosci: Tesseract lubi wiekszy tekst
  // drobny tekst (ulamki "1/5", jednostki "l") Tesseract czyta duzo lepiej w powiekszeniu
  const scale = Math.min(3, Math.max(1, 2600 / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  const mean = sum / (d.length / 4);
  const invert = mean < 110; // tryb ciemny -> jasne tlo, ciemny tekst
  for (let i = 0; i < d.length; i += 4) {
    let g = invert ? 255 - d[i] : d[i];
    g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128)); // kontrast
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** files: lista obrazow (kolejnosc = kolejnosc screenow). onProgress(0..1, opis). */
let progressHandler = () => {};
let workerPromise = null;

/** Jeden "pracownik" na sesje: slownik ladowany raz, ustawienia dla przepisow. */
function getWorker(T) {
  if (!T.createWorker) return null;
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await T.createWorker("pol+eng", 1, { logger: (m) => progressHandler(m) });
      await worker.setParameters({
        tessedit_pageseg_mode: "4",      // jedna kolumna o roznych rozmiarach: wiersze tabelki zostaja razem
        preserve_interword_spaces: "1",
      });
      return worker;
    })().catch((err) => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

export async function recognizeImages(files, onProgress = () => {}) {
  const T = await loadTesseract();
  const worker = await getWorker(T);
  const texts = [];
  for (let i = 0; i < files.length; i++) {
    const label = files.length > 1 ? `Zdjęcie ${i + 1} z ${files.length}: ` : "";
    onProgress(i / files.length, label + "przygotowanie obrazu…");
    let image = files[i];
    try { image = await preprocess(files[i]); } catch { /* np. HEIC — rozpoznajemy oryginal */ }
    const logger = (m) => {
      if (m.status === "recognizing text") onProgress((i + m.progress) / files.length, label + `rozpoznawanie tekstu ${Math.round(m.progress * 100)}%`);
      else if (/loading|initializ/.test(m.status)) onProgress(i / files.length, label + "pobieranie słownika (tylko za pierwszym razem)…");
    };
    progressHandler = logger;
    const { data } = worker ? await worker.recognize(image) : await T.recognize(image, "pol+eng", { logger });
    texts.push(data.text || "");
  }
  onProgress(1, "Gotowe");
  return texts.join("\n\n");
}
