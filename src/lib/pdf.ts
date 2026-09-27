// pdf.js runs only in the browser; load it lazily.
type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

async function pdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return m;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(bytes: Uint8Array) {
  const lib = await pdfjs();
  // pdf.js transfers the buffer, so give it a copy
  return lib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
}

/** Render every page of a PDF to PNG blobs (for viewing and printing). */
export async function renderPdfPages(bytes: Uint8Array, scale = 2): Promise<Blob[]> {
  const doc = await openPdf(bytes);
  const out: Blob[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    out.push(await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png")));
  }
  await doc.destroy();
  return out;
}

/** Text layer of each page (empty string for scanned pages). */
export async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const doc = await openPdf(bytes);
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim());
  }
  await doc.destroy();
  return out;
}
