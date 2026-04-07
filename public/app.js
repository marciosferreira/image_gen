const form = document.getElementById("genForm");
const imagesInput = document.getElementById("images");
const promptInput = document.getElementById("prompt");
const modelSelect = document.getElementById("model");
const submitBtn = document.getElementById("submitBtn");
const statusEl = document.getElementById("status");
const lastCostEl = document.getElementById("lastCost");
const lastModelEl = document.getElementById("lastModel");
const totalCostEl = document.getElementById("totalCost");
const totalGenEl = document.getElementById("totalGen");
const resultSection = document.getElementById("result");
const resultImg = document.getElementById("resultImg");
const downloadLink = document.getElementById("downloadLink");
const uploadsPreview = document.getElementById("uploadsPreview");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");
let previewObjectUrls = [];
let openaiBaseIndex = 0;
let selectedFiles = [];

function setStatus(text) {
  statusEl.textContent = text || "";
}

function sanitizeFilenamePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function formatTimestampForFilename(date) {
  const iso = (date instanceof Date ? date : new Date()).toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function setCosts({ lastCostBRL, lastModelUsed, totalCostBRL, totalGenerations }) {
  if (typeof lastCostBRL === "string") lastCostEl.textContent = `R$ ${lastCostBRL}`;
  if (typeof lastModelUsed === "string") lastModelEl.textContent = lastModelUsed;
  if (typeof totalCostBRL === "string") totalCostEl.textContent = `R$ ${totalCostBRL}`;
  if (typeof totalGenerations === "number") {
    totalGenEl.textContent = totalGenerations === 1 ? "(1 geração)" : `(${totalGenerations} gerações)`;
  }
}

async function refreshServerCost() {
  const resp = await fetch("/api/cost", { method: "GET" });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data) return;
  setCosts({ totalCostBRL: data.totalCostBRL, totalGenerations: data.totalGenerations });
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  imagesInput.disabled = isLoading;
  modelSelect.disabled = isLoading;
  promptInput.disabled = isLoading;
}

function clearUploadsPreview() {
  for (const url of previewObjectUrls) URL.revokeObjectURL(url);
  previewObjectUrls = [];
  uploadsPreview.innerHTML = "";
  uploadsPreview.classList.add("hidden");
}

function syncImagesInputFromSelectedFiles() {
  const dt = new DataTransfer();
  for (const file of selectedFiles) dt.items.add(file);
  imagesInput.files = dt.files;
}

function removeSelectedFileAt(index) {
  const idx = Number(index);
  if (!Number.isFinite(idx) || idx < 0 || idx >= selectedFiles.length) return;

  selectedFiles = selectedFiles.filter((_, i) => i !== idx);
  if (openaiBaseIndex === idx) openaiBaseIndex = 0;
  else if (idx < openaiBaseIndex) openaiBaseIndex = Math.max(0, openaiBaseIndex - 1);

  syncImagesInputFromSelectedFiles();
  renderUploadsPreview();
}

function setOpenaiBaseIndex(nextIndex) {
  const items = uploadsPreview.querySelectorAll(".uploads-preview__item");
  if (!items.length) return;
  const idx = Number(nextIndex);
  if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) return;
  openaiBaseIndex = idx;

  for (const item of items) {
    const itemIndex = Number(item.dataset.index);
    item.classList.toggle("uploads-preview__item--primary", itemIndex === openaiBaseIndex);
    const meta = item.querySelector(".uploads-preview__meta");
    const name = item.dataset.alt || "imagem";
    if (meta) meta.textContent = itemIndex === openaiBaseIndex ? `PRIMEIRA • ${name}` : name;
  }
}

function renderUploadsPreview() {
  clearUploadsPreview();

  const files = selectedFiles;
  if (files.length === 0) return;

  uploadsPreview.classList.remove("hidden");
  if (openaiBaseIndex < 0 || openaiBaseIndex >= files.length) openaiBaseIndex = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file.type?.startsWith("image/")) continue;
    const url = URL.createObjectURL(file);
    previewObjectUrls.push(url);

    const item = document.createElement("div");
    item.className = "uploads-preview__item";
    item.tabIndex = 0;
    item.role = "button";
    item.dataset.fullSrc = url;
    item.dataset.alt = file.name || "Imagem selecionada";
    item.dataset.index = String(i);

    const img = document.createElement("img");
    img.src = url;
    img.alt = file.name || "Imagem selecionada";
    img.loading = "lazy";

    const baseBtn = document.createElement("button");
    baseBtn.type = "button";
    baseBtn.className = "uploads-preview__base";
    baseBtn.textContent = "Primeira";
    baseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpenaiBaseIndex(i);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "uploads-preview__remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "Remover");
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeSelectedFileAt(i);
    });

    const meta = document.createElement("div");
    meta.className = "uploads-preview__meta";
    meta.textContent = file.name || "imagem";

    if (i === openaiBaseIndex) {
      item.classList.add("uploads-preview__item--primary");
      meta.textContent = `PRIMEIRA • ${file.name || "imagem"}`;
    }

    item.appendChild(baseBtn);
    item.appendChild(removeBtn);
    item.appendChild(img);
    item.appendChild(meta);
    uploadsPreview.appendChild(item);
  }
}

imagesInput.addEventListener("change", () => {
  selectedFiles = imagesInput.files ? Array.from(imagesInput.files) : [];
  openaiBaseIndex = 0;
  renderUploadsPreview();
});

function openLightbox(src, alt) {
  lightboxImg.src = src;
  lightboxImg.alt = alt || "Imagem ampliada";
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightboxImg.removeAttribute("src");
  lightboxImg.alt = "";
}

uploadsPreview.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const item = target?.closest?.(".uploads-preview__item");
  const src = item?.dataset?.fullSrc;
  if (src) openLightbox(src, item?.dataset?.alt);
});

uploadsPreview.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const target = e.target instanceof Element ? e.target : null;
  const item = target?.closest?.(".uploads-preview__item");
  const src = item?.dataset?.fullSrc;
  if (!src) return;
  e.preventDefault();
  openLightbox(src, item?.dataset?.alt);
});

lightboxClose.addEventListener("click", () => {
  closeLightbox();
});

lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.classList.contains("hidden")) closeLightbox();
});

refreshServerCost().catch(() => null);

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  setStatus("");
  resultSection.classList.add("hidden");

  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus("Informe um prompt.");
    return;
  }

  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("model", modelSelect.value);

  const files = selectedFiles;
  for (const file of files) {
    formData.append("images", file, file.name);
  }
  if (String(modelSelect.value || "").startsWith("openai:") && files.length > 0) {
    formData.append("openaiBaseIndex", String(openaiBaseIndex));
  }

  try {
    setLoading(true);
    setStatus("Gerando...");

    const resp = await fetch("/api/generate", {
      method: "POST",
      body: formData,
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      setStatus(data?.error || "Falha ao gerar imagem.");
      return;
    }

    const mimeType = data?.mimeType || "image/png";
    const base64 = data?.base64;
    if (!base64) {
      setStatus("Resposta inválida do servidor.");
      return;
    }

    const dataUrl = `data:${mimeType};base64,${base64}`;
    resultImg.src = dataUrl;
    downloadLink.href = dataUrl;
    const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
    const modelUsed = typeof data?.modelUsed === "string" ? data.modelUsed : modelSelect.value;
    const safeModel = sanitizeFilenamePart(modelUsed) || "modelo";
    const ts = formatTimestampForFilename(new Date());
    downloadLink.download = `resultado_${safeModel}_${ts}.${ext}`;

    resultSection.classList.remove("hidden");
    setCosts({
      lastCostBRL: data?.costBRL,
      lastModelUsed: data?.modelUsed,
      totalCostBRL: data?.totalCostBRL,
      totalGenerations: data?.totalGenerations,
    });
    setStatus("Pronto.");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Erro desconhecido.");
  } finally {
    setLoading(false);
  }
});
