import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ override: true });

const PORT = Number(process.env.PORT || 3000);
const ALLOWED_MODELS = new Set([
  "gemini-3.1-flash-image-preview",
]);
const DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const ALLOWED_OPENAI_MODELS = new Set(["gpt-image-1.5-2025-12-16"]);
const DEFAULT_PROVIDER = "gemini";

const USD_TO_BRL = 5.33;
const PRICE_BRL_CENTS = new Map([
  ["gemini:gemini-3.1-flash-image-preview", Math.round(0.067 * USD_TO_BRL * 100)],
  ["openai:gpt-image-1.5-2025-12-16", Math.round(0.04 * USD_TO_BRL * 100)],
]);

const costState = {
  totalBRLCents: 0,
  totalGenerations: 0,
};

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY não encontrado no .env");
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();

app.use(express.static("public"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 14,
  },
});

function parseModelSelection(value) {
  if (typeof value !== "string" || !value.includes(":")) {
    return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
  }
  const [provider, model] = value.split(":", 2).map((s) => s.trim());
  if (!provider || !model) return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
  return { provider, model };
}

function getCostForSelection(modelSelection) {
  if (typeof modelSelection !== "string") return 0;
  return PRICE_BRL_CENTS.get(modelSelection) ?? 0;
}

function incrementCost(costCents) {
  costState.totalBRLCents += costCents;
  costState.totalGenerations += 1;
}

app.get("/api/cost", (req, res) => {
  return res.json({
    usdToBrl: USD_TO_BRL,
    totalGenerations: costState.totalGenerations,
    totalCostBRL: (costState.totalBRLCents / 100).toFixed(2),
  });
});

async function openaiGenerateImage({ model, prompt, imageFiles, baseIndex }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não encontrado no .env");
  }

  const files = Array.isArray(imageFiles) ? imageFiles : [];
  const images = files.filter((f) => f?.mimetype?.startsWith("image/"));
  const parsedBaseIndex = Number.isFinite(Number(baseIndex)) ? Number(baseIndex) : null;
  const orderedImages =
    typeof parsedBaseIndex === "number" && Number.isInteger(parsedBaseIndex) && parsedBaseIndex >= 0 && parsedBaseIndex < images.length
      ? [images[parsedBaseIndex], ...images.slice(0, parsedBaseIndex), ...images.slice(parsedBaseIndex + 1)]
      : images;

  if (orderedImages.length > 0) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", "1024x1024");
    for (const img of orderedImages) {
      form.append(
        "image[]",
        new Blob([img.buffer], { type: img.mimetype }),
        img.originalname || "image.png",
      );
    }

    const editResp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });

    const editData = await editResp.json().catch(() => null);
    if (!editResp.ok) throw new Error(editData?.error?.message || "Erro ao chamar a OpenAI.");

    const item = editData?.data?.[0];
    const base64 = item?.b64_json;
    if (typeof base64 === "string" && base64) {
      return { mimeType: "image/png", base64 };
    }

    const url = item?.url;
    if (typeof url === "string" && url) {
      const imageResp = await fetch(url);
      if (!imageResp.ok) {
        throw new Error(`Erro ao baixar a imagem gerada (${imageResp.status}).`);
      }
      const mimeType = imageResp.headers.get("content-type") || "image/png";
      const arrayBuffer = await imageResp.arrayBuffer();
      const imageBase64 = Buffer.from(arrayBuffer).toString("base64");
      return { mimeType, base64: imageBase64 };
    }

    throw new Error("OpenAI não retornou imagem.");
  }

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1024x1024",
    }),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.error?.message || "Erro ao chamar a OpenAI.");

  const item = data?.data?.[0];
  const base64 = item?.b64_json;
  if (typeof base64 === "string" && base64) {
    return { mimeType: "image/png", base64 };
  }

  const url = item?.url;
  if (typeof url === "string" && url) {
    const imageResp = await fetch(url);
    if (!imageResp.ok) {
      throw new Error(`Erro ao baixar a imagem gerada (${imageResp.status}).`);
    }
    const mimeType = imageResp.headers.get("content-type") || "image/png";
    const arrayBuffer = await imageResp.arrayBuffer();
    const imageBase64 = Buffer.from(arrayBuffer).toString("base64");
    return { mimeType, base64: imageBase64 };
  }

  throw new Error("OpenAI não retornou imagem.");
}

app.post("/api/generate", upload.array("images", 14), async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const modelSelection = typeof req.body?.model === "string" ? req.body.model.trim() : "";
    const openaiBaseIndexRaw = typeof req.body?.openaiBaseIndex === "string" ? req.body.openaiBaseIndex.trim() : "";
    const openaiBaseIndex = openaiBaseIndexRaw ? Number.parseInt(openaiBaseIndexRaw, 10) : null;
    const { provider, model: rawModel } = parseModelSelection(modelSelection);
    const costCents = getCostForSelection(modelSelection);

    if (!prompt) {
      return res.status(400).json({ error: "Prompt é obrigatório." });
    }

    const parts = [{ text: prompt }];

    const files = Array.isArray(req.files) ? req.files : [];
    for (const file of files) {
      if (!file?.mimetype?.startsWith("image/")) {
        return res.status(400).json({ error: "Apenas imagens são aceitas." });
      }
    }

    if (provider === "openai") {
      if (!ALLOWED_OPENAI_MODELS.has(rawModel)) {
        return res.status(400).json({ error: "Modelo OpenAI inválido." });
      }
      const result = await openaiGenerateImage({
        model: rawModel,
        prompt,
        imageFiles: files,
        baseIndex: openaiBaseIndex,
      });
      incrementCost(costCents);
      return res.json({
        ...result,
        modelUsed: `openai:${rawModel}`,
        costBRL: (costCents / 100).toFixed(2),
        totalCostBRL: (costState.totalBRLCents / 100).toFixed(2),
        totalGenerations: costState.totalGenerations,
      });
    }

    if (provider !== "gemini") {
      return res.status(400).json({ error: "Provider inválido." });
    }

    const model = ALLOWED_MODELS.has(rawModel) ? rawModel : DEFAULT_MODEL;

    for (const file of files) {
      parts.push({
        inlineData: {
          mimeType: file.mimetype,
          data: file.buffer.toString("base64"),
        },
      });
    }

    const response = await ai.models.generateContent({
      model,
      contents: parts,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    const candidate = response?.candidates?.[0]?.content?.parts || [];
    const imagePart = candidate.find((p) => p?.inlineData?.data);

    if (!imagePart?.inlineData?.data) {
      return res.status(502).json({ error: "Nenhuma imagem foi retornada pelo modelo." });
    }

    incrementCost(costCents);
    return res.json({
      mimeType: imagePart.inlineData.mimeType || "image/png",
      base64: imagePart.inlineData.data,
      modelUsed: `gemini:${model}`,
      costBRL: (costCents / 100).toFixed(2),
      totalCostBRL: (costState.totalBRLCents / 100).toFixed(2),
      totalGenerations: costState.totalGenerations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido.";
    return res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado: http://localhost:${PORT}`);
});
