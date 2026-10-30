import { NextResponse } from "next/server";
import {
  ImageGenerationError,
  generateImage,
  parseImageRequest,
} from "@/lib/image-service";

/**
 * Generates one image through the local image service and stores it as an
 * upload. The design agent calls this with curl; a failure is an answer it acts
 * on (continue without the image), never a guessed path.
 *
 * Logs carry the aspect ratio, the prompt length and the outcome, never the
 * prompt or the token.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let aspectRatio: string | undefined;
  let promptLength: number | undefined;
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ImageGenerationError(400, "invalid_json", "Body must be JSON with prompt and aspectRatio");
    }
    const input = parseImageRequest(body);
    aspectRatio = input.aspectRatio;
    promptLength = input.prompt.length;

    const image = await generateImage(input);
    console.info("[images] generated", {
      aspectRatio,
      promptLength,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(image);
  } catch (err) {
    if (err instanceof ImageGenerationError) {
      // Refusals and an unavailable service are expected outcomes; only a
      // service that answered with something unusable is a failure.
      const log = err.status === 502 ? console.error : console.warn;
      log("[images] generation not completed", {
        code: err.code,
        reason: err.detail.reason,
        aspectRatio,
        promptLength,
        durationMs: Date.now() - started,
      });
      return NextResponse.json(
        { error: err.code, message: err.message, ...err.detail },
        { status: err.status }
      );
    }
    console.error("[images] unexpected error", {
      name: (err as Error)?.name,
      aspectRatio,
      promptLength,
    });
    return NextResponse.json(
      { error: "image_generation_failed", message: "Image generation failed. Continue without a generated image." },
      { status: 500 }
    );
  }
}
