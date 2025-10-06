import { json } from "@remix-run/node";
import db from "../../../db.server";
import { generateAIImage } from "../../../services/ai-providers.server";
import type {
  GenerateImageResponse,
  ActionErrorResponse,
} from "../types";

export async function handleGenerate(
  formData: FormData,
  shop: string,
) {
  const sourceImageUrl = String(formData.get("sourceImageUrl") || "");
  const prompt = String(formData.get("prompt") || "");
  const productId = String(formData.get("productId") || "");

  if (!sourceImageUrl || !prompt) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "Missing sourceImageUrl or prompt",
    };
    return json(errorResponse, { status: 400 });
  }

  try {
    const result = await generateAIImage({
      sourceImageUrl,
      prompt,
      productId,
      modelType: "swap",
    });

    try {
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          type: "GENERATED",
          productId,
          imageUrl: result.imageUrl,
        },
      });
    } catch (loggingError) {
      console.warn("Failed to log generation event:", loggingError);
    }

    const successResponse: GenerateImageResponse = {
      ok: true,
      result: {
        ...result,
        originalSource: sourceImageUrl,
      },
    };

    return json(successResponse);
  } catch (error: any) {
    console.error("[generation] AI image generation failed:", error);

    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error?.message || "AI image generation failed",
      debug: { sourceImageUrl, prompt, errorType: error.constructor.name },
    };
    return json(errorResponse, { status: 500 });
  }
}
