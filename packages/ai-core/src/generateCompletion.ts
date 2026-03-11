interface ChatCompletionChoice {
  message?: {
    content?: string;
  };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  error?: {
    message?: string;
  };
}

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export async function generateCompletion(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const responseData = (await response.json()) as ChatCompletionResponse;

  if (!response.ok) {
    const message = responseData.error?.message ?? "OpenAI request failed.";
    throw new Error(`OpenAI request failed with status ${response.status}: ${message}`);
  }

  const generatedText = responseData.choices?.[0]?.message?.content?.trim();

  if (!generatedText) {
    throw new Error("OpenAI returned an empty completion.");
  }

  return generatedText;
}
