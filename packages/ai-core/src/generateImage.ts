export interface GenerateImageRequest {
  prompt: string;
  model?: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  quality?: "low" | "medium" | "high" | "auto";
}

export interface GenerateImageResponse {
  imageDataUrl: string;
  mimeType: string;
  model: string;
}

interface ImageGenerationApiResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  error?: {
    message?: string;
  };
}

const OPENAI_IMAGE_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";

function resolveImageQuality(inputQuality: GenerateImageRequest["quality"]): GenerateImageRequest["quality"] {
  const envQuality = process.env.OPENAI_IMAGE_QUALITY?.trim().toLowerCase();

  if (inputQuality) {
    return inputQuality;
  }

  if (envQuality === "low" || envQuality === "medium" || envQuality === "high" || envQuality === "auto") {
    return envQuality;
  }

  return "medium";
}

export async function generateImage(input: GenerateImageRequest): Promise<GenerateImageResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = input.model ?? process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  const size = input.size ?? "1024x1024";
  const quality = resolveImageQuality(input.quality);

  const response = await fetch(OPENAI_IMAGE_GENERATIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      size,
      quality,
    }),
  });

  const responseData = (await response.json()) as ImageGenerationApiResponse;

  if (!response.ok) {
    const message = responseData.error?.message ?? "OpenAI image generation failed.";
    throw new Error(`OpenAI image generation failed with status ${response.status}: ${message}`);
  }

  const imageBase64 = responseData.data?.[0]?.b64_json?.trim();
  const imageUrl = responseData.data?.[0]?.url?.trim();

  if (imageBase64) {
    return {
      imageDataUrl: `data:image/png;base64,${imageBase64}`,
      mimeType: "image/png",
      model,
    };
  }

  if (imageUrl) {
    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      throw new Error("OpenAI image generation returned an unreadable image URL.");
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const mimeType = imageResponse.headers.get("content-type")?.trim() || "image/png";

    return {
      imageDataUrl: `data:${mimeType};base64,${imageBuffer.toString("base64")}`,
      mimeType,
      model,
    };
  }

  if (!imageBase64 && !imageUrl) {
    throw new Error("OpenAI image generation returned an empty image payload.");
  }

  throw new Error("OpenAI image generation returned an unsupported image payload.");
}
