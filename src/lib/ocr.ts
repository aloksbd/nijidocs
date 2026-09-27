// On-device OCR. The image never leaves the browser; only the language
// models (English + Nepali) are downloaded from a public CDN on first use.
import type { Worker } from "tesseract.js";
import { pdfText, renderPdfPages } from "./pdf";

let workerPromise: Promise<Worker> | null = null;
async function worker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) => createWorker(["eng", "nep"]));
  }
  return workerPromise;
}

async function ocrImage(img: Blob): Promise<string> {
  const w = await worker();
  const { data } = await w.recognize(img);
  return data.text;
}

const MAX_OCR_PAGES = 10;

export async function extractText(
  files: File[],
  onProgress?: (msg: string) => void,
): Promise<string> {
  const parts: string[] = [];
  let n = 0;
  for (const f of files) {
    if (f.type === "application/pdf") {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const texts = await pdfText(bytes);
      const needsOcr = texts.some((t) => t.length < 30);
      const images = needsOcr ? await renderPdfPages(bytes, 2) : [];
      for (let i = 0; i < texts.length; i++) {
        if (texts[i].length >= 30) parts.push(texts[i]);
        else if (n < MAX_OCR_PAGES) {
          onProgress?.(`Reading text from ${f.name}, page ${i + 1}`);
          parts.push(await ocrImage(images[i])); n++;
        }
      }
    } else if (f.type.startsWith("image/") && n < MAX_OCR_PAGES) {
      onProgress?.(`Reading text from ${f.name}`);
      parts.push(await ocrImage(f)); n++;
    }
  }
  return parts.join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
