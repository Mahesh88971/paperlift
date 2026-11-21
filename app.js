const byId = (id) => document.getElementById(id);
const stage = byId("drop-zone");
const original = byId("source-image");
const sourceName = byId("source-name");
const transcript = byId("transcript");
const editor = byId("editor");
const working = byId("working");
const status = byId("output-status");
const language = byId("language");
const fileInput = byId("file-input");
const cameraButton = byId("open-camera");
const uploadButton = byId("upload");
const scanButton = byId("rescan");
const copyButton = byId("copy");
const downloadButton = byId("download");
const cameraDialog = byId("camera-dialog");
const video = byId("camera-video");
const cameraMessage = byId("camera-message");
const captureButton = byId("capture");
const previewDialog = byId("preview-dialog");
const toast = byId("toast");

const assets = new URL("./assets/ocr/", import.meta.url);
const maxUpload = 20 * 1024 * 1024;
const supportedFormat = /\.(png|jpe?g|webp)$/i;
const supportedType = /^image\/(png|jpeg|webp)$/;

let source = null;
let busy = false;
let dragDepth = 0;
let stream = null;
let cameraRequest = 0;
let scriptPromise;
let copyTimer;
let toastTimer;
let workerCache = new Map();

function announce(message) {
  byId("announcement").textContent = message;
}

function notify(message, kind = "success") {
  clearTimeout(toastTimer);
  toast.dataset.state = kind;
  byId("toast-icon").setAttribute("href", kind === "error" ? "#i-alert" : "#i-check");
  byId("toast-text").textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, kind === "error" ? 8000 : 3200);
}

function setStatus(state, label) {
  status.hidden = false;
  status.dataset.state = state;
  status.textContent = label;
}

function refreshOutput() {
  const text = transcript.value;
  const words = text.trim().split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  const characters = Array.from(text).length;
  byId("word-count").textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
  byId("character-count").textContent = `${characters.toLocaleString()} ${characters === 1 ? "character" : "characters"}`;
  copyButton.disabled = downloadButton.disabled = busy || !text.trim();
}

function setBusy(next) {
  busy = next;
  for (const control of [cameraButton, uploadButton, scanButton, language]) control.disabled = next;
  transcript.readOnly = next || !source;
  editor.setAttribute("aria-busy", String(next));
  refreshOutput();
}

function setProgress(value, label) {
  byId("working-title").textContent = label;
  byId("progress-label").textContent = `${value}%`;
  byId("progress-bar").style.width = `${value}%`;
  stage.style.setProperty("--scan-position", `${3 + value * .94}%`);
}

function prepareOCRImage(image) {
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadEngine() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("tesseract.min.js", assets);
      script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("OCR engine unavailable"));
      script.onerror = () => { script.remove(); reject(new Error("OCR engine unavailable")); };
      document.head.append(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

function preloadEngine() {
  void loadEngine().catch(() => {});
}

async function recognize(url, selectedLanguage) {
  let timer;
  let finished = false;
  let fail;
  const failure = new Promise((_, reject) => {
    fail = reject;
    timer = setTimeout(() => reject(new Error("Scan timed out")), 90_000);
  });
  const job = async () => {
    const tesseract = await loadEngine();
    if (finished) return;

    let worker = workerCache.get(selectedLanguage);
    if (!worker) {
      worker = await tesseract.createWorker(selectedLanguage.split("+"), tesseract.OEM.LSTM_ONLY, {
        workerPath: new URL("worker.min.js", assets).href,
        corePath: assets.href.slice(0, -1),
        langPath: assets.href.slice(0, -1),
        workerBlobURL: false,
        errorHandler: (error) => fail(new Error(String(error))),
      });
      await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.AUTO });
      workerCache.set(selectedLanguage, worker);
    }

    const image = new Image();
    image.src = url;
    await image.decode();
    const ocrImage = prepareOCRImage(image);

    const result = await worker.recognize(ocrImage, {}, {
      logger: ({ status: phase, progress }) => {
        if (finished) return;
        if (phase === "recognizing text") {
          setProgress(25 + Math.round(progress * 73), "Reading your page");
        } else if (phase === "loading language traineddata") {
          setProgress(8 + Math.round(progress * 12), "Loading language model");
        } else if (phase === "initializing api") {
          setProgress(23, "Preparing scanner");
        }
      },
    });
    return result.data;
  };
  try {
    return await Promise.race([job(), failure]);
  } finally {
    finished = true;
    clearTimeout(timer);
  }
}

async function scan() {
  if (!source) return;
  setBusy(true);
  editor.classList.remove("completed");
  editor.classList.add("processing");
  stage.classList.add("scanning");
  working.hidden = false;
  setProgress(0, "Preparing scanner");
  setStatus("working", "Scanning");
  announce("Scanning the printed page.");
  try {
    const { text, confidence } = await recognize(source.url, language.value);
    if (!text.trim()) {
      setStatus("error", "No text found");
      transcript.placeholder = "No text found. Try a sharper, well-lit photo with the page facing the camera.";
      notify("No text found. Try a sharper photo of the page.", "error");
      return;
    }
    transcript.value = text;
    transcript.scrollTop = 0;
    setProgress(100, "Scan complete");
    setStatus("ready", confidence < 72 ? "Check text" : "Ready");
    editor.classList.add("completed");
    announce("Scan complete. Review the extracted text against the original.");
    if (matchMedia("(max-width: 680px)").matches && !document.querySelector("dialog[open]")) {
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      byId("output-heading").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  } catch (error) {
    console.warn("Paperlift scanner:", error);
    setStatus("error", "Scan failed");
    transcript.placeholder = "Scan failed. Try scanning the page again or upload a new photo.";
    notify("The scan could not finish. Try scanning the page again.", "error");
  } finally {
    working.hidden = true;
    stage.classList.remove("scanning");
    editor.classList.remove("processing");
    setBusy(false);
  }
}

async function useImage(file, displayName = file.name || "Pasted image") {
  if (busy) return;
  if (!supportedType.test(file.type) && (file.type || !supportedFormat.test(file.name ?? ""))) {
    notify("Choose a JPG, PNG, or WebP image.", "error");
    return;
  }
  if (file.size > maxUpload) {
    notify("This image is larger than 20 MB. Choose a smaller image.", "error");
    return;
  }
  setBusy(true);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    setBusy(false);
    notify("This image could not be opened. Try another photo.", "error");
    return;
  }
  if (source) URL.revokeObjectURL(source.url);
  source = { url, file: displayName.replace(supportedFormat, "") };
  original.src = url;
  sourceName.textContent = displayName;
  sourceName.parentElement.title = displayName;
  byId("file-formats").hidden = true;
  scanButton.hidden = false;
  byId("source-empty").hidden = true;
  byId("scan-frame").hidden = false;
  byId("source-tag").hidden = false;
  byId("show-preview").hidden = false;
  byId("output-empty").hidden = true;
  editor.classList.remove("idle");
  stage.classList.add("has-source");
  transcript.value = "";
  transcript.placeholder = "Your extracted text will appear here.";
  await scan();
}

function stopCamera() {
  cameraRequest++;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  captureButton.disabled = true;
}

async function startCamera() {
  const request = ++cameraRequest;
  cameraMessage.textContent = "Waiting for camera permission…";
  cameraMessage.hidden = false;
  captureButton.disabled = true;
  cameraDialog.showModal();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
    const incoming = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    });
    if (request !== cameraRequest || !cameraDialog.open) {
      incoming.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = incoming;
    video.srcObject = stream;
    await video.play();
    if (request === cameraRequest && cameraDialog.open && video.videoWidth) {
      cameraMessage.hidden = true;
      captureButton.disabled = false;
    }
  } catch (error) {
    if (request !== cameraRequest || !cameraDialog.open) return;
    stopCamera();
    cameraMessage.textContent = error.name === "NotAllowedError"
      ? "Camera access was blocked. Check your browser permissions or upload a photo."
      : "The camera is unavailable. You can upload a photo instead.";
  }
}

function capturePage() {
  if (!video.videoWidth || !cameraDialog.open) return;
  captureButton.disabled = true;
  const request = cameraRequest;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    if (!cameraDialog.open || request !== cameraRequest) return;
    if (!blob) {
      cameraMessage.textContent = "This frame could not be captured. Try again.";
      cameraMessage.hidden = false;
      captureButton.disabled = false;
      return;
    }
    stopCamera();
    cameraDialog.close();
    void useImage(blob, "Camera capture");
  }, "image/jpeg", .94);
}

function resetCopyLabel() {
  clearTimeout(copyTimer);
  byId("copy-label").textContent = "Copy text";
  byId("copy-icon").setAttribute("href", "#i-copy");
  copyButton.classList.remove("copied");
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(transcript.value);
    resetCopyLabel();
    byId("copy-label").textContent = "Copied";
    byId("copy-icon").setAttribute("href", "#i-check");
    copyButton.classList.add("copied");
    copyTimer = setTimeout(resetCopyLabel, 1800);
    notify("Text copied to the clipboard.");
  } catch {
    transcript.focus();
    transcript.select();
    notify("Text selected. Use your browser’s Copy command.", "error");
  }
}

function downloadText() {
  const blob = new Blob([transcript.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${source.file || "paperlift-scan"}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

uploadButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (file) void useImage(file);
});

stage.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  if (!busy) {
    dragDepth++;
    stage.classList.add("dragging");
  }
});
stage.addEventListener("dragover", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = busy ? "none" : "copy";
});
stage.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) stage.classList.remove("dragging");
});
stage.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  stage.classList.remove("dragging");
  const file = event.dataTransfer.files[0];
  if (file) void useImage(file);
});
document.addEventListener("paste", (event) => {
  if (document.querySelector("dialog[open]")) return;
  const image = Array.from(event.clipboardData?.items ?? []).find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const file = image?.getAsFile();
  if (file) {
    event.preventDefault();
    void useImage(file, "Pasted image");
  }
});

cameraButton.addEventListener("click", startCamera);
captureButton.addEventListener("click", capturePage);
cameraDialog.addEventListener("close", () => {
  if (!cameraDialog.open) stopCamera();
});
byId("camera-upload").addEventListener("click", () => {
  stopCamera();
  cameraDialog.close();
  fileInput.click();
});
byId("show-preview").addEventListener("click", () => {
  const image = byId("large-preview");
  image.src = byId("image-link").href = source.url;
  image.alt = original.alt;
  previewDialog.showModal();
});
byId("open-guide").addEventListener("click", () => byId("guide-dialog").showModal());
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
scanButton.addEventListener("click", scan);
transcript.addEventListener("input", () => {
  resetCopyLabel();
  refreshOutput();
});
copyButton.addEventListener("click", copyText);
downloadButton.addEventListener("click", downloadText);
byId("dismiss-toast").addEventListener("click", () => { toast.hidden = true; });
refreshOutput();
window.addEventListener("load", () => {
  if (window.requestIdleCallback) window.requestIdleCallback(preloadEngine, { timeout: 4000 });
  else setTimeout(preloadEngine, 800);
});
