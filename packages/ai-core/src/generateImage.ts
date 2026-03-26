export interface GenerateImageRequest {
  prompt: string;
  model?: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
}

export interface GenerateImageResponse {
  imageDataUrl: string;
  mimeType: string;
  model: string;
}

interface ImageGenerationApiResponse {
  data?: Array<{
    b64_json?: string;
  }>;
  error?: {
    message?: string;
  };
}

const OPENAI_IMAGE_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";

export async function generateImage(input: GenerateImageRequest): Promise<GenerateImageResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = input.model ?? process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  const size = input.size ?? "1024x1024";

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
      response_format: "b64_json",
    }),
  });

  const responseData = (await response.json()) as ImageGenerationApiResponse;

  if (!response.ok) {
    const message = responseData.error?.message ?? "OpenAI image generation failed.";
    throw new Error(`OpenAI image generation failed with status ${response.status}: ${message}`);
  }

  const imageBase64 = responseData.data?.[0]?.b64_json?.trim();

  if (!imageBase64) {
    throw new Error("OpenAI image generation returned an empty image payload.");
  }

  return {
    imageDataUrl: `data:image/png;base64,${imageBase64}`,
    mimeType: "image/png",
    model,
  };
}
