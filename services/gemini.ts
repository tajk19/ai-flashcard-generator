import { requestUrl } from "obsidian";
import type {
  FlashcardResponse,
  GenerateFlashcardsOptions
} from "../models/flashcard";
import {
  buildFlashcardPrompt,
  buildFlashcardSchema,
  clampCardCount,
  FLASHCARD_SYSTEM_INSTRUCTION,
  validateFlashcardResponse
} from "./flashcard-generator";
import {
  MAX_OUTPUT_TOKENS,
  validateGenerationInstructions,
  validateResponseTextSize,
  validateSourceText
} from "./generation-limits";

const INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_ATTEMPTS = 3;
const SAFE_PROVIDER_ERROR_CODES = new Set([
  "invalid_request",
  "failed_precondition",
  "out_of_range",
  "parameter_unknown",
  "authentication",
  "permission_denied",
  "not_found",
  "model_not_found",
  "already_exists",
  "aborted",
  "rate_limit_exceeded",
  "safety",
  "recitation",
  "language",
  "prohibited_content",
  "spii",
  "blocklist",
  "content_blocked",
  "malformed_function_call",
  "malformed_tool_call",
  "unexpected_tool_call",
  "no_image",
  "too_many_tool_calls",
  "missing_thought_signature",
  "INVALID_ARGUMENT",
  "FAILED_PRECONDITION",
  "OUT_OF_RANGE",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RESOURCE_EXHAUSTED",
  "DEADLINE_EXCEEDED",
  "UNAVAILABLE",
  "API_KEY_INVALID",
  "BILLING_DISABLED",
  "SERVICE_DISABLED"
]);
export const GEMINI_REQUEST_TIMEOUT_MS = 90_000;

export class GeminiApiError extends Error {
  readonly statusCode: number | undefined;
  readonly apiStatus: string | undefined;

  constructor(
    message: string,
    statusCode?: number,
    apiStatus?: string
  ) {
    super(message);
    this.name = "GeminiApiError";
    this.statusCode = statusCode;
    this.apiStatus = apiStatus;
  }
}

export class GeminiRequestCancelledError extends Error {
  constructor() {
    super("Flashcard generation was cancelled.");
    this.name = "GeminiRequestCancelledError";
  }
}

export class GeminiRequestTimeoutError extends GeminiApiError {
  constructor() {
    super(
      "Gemini did not respond in time. The request may still be running; wait before generating again."
    );
    this.name = "GeminiRequestTimeoutError";
  }
}

export async function generateFlashcards(
  options: GenerateFlashcardsOptions
): Promise<FlashcardResponse> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new GeminiApiError("Gemini API key is not configured.");
  }

  throwIfCancelled(options.signal);
  validateSourceText(options.note);
  validateGenerationInstructions(options.instructions);

  const model = normalizeModelName(options.model);
  const count = clampCardCount(options.count);
  const body = JSON.stringify({
    model,
    input: buildFlashcardPrompt(options.note, count, options.instructions),
    system_instruction: FLASHCARD_SYSTEM_INSTRUCTION,
    response_format: [
      {
        type: "text",
        mime_type: "application/json",
        schema: buildFlashcardSchema(count)
      }
    ],
    generation_config: {
      max_output_tokens: MAX_OUTPUT_TOKENS,
      thinking_level: "minimal",
      thinking_summaries: "none"
    },
    stream: false,
    background: false,
    store: false
  });

  const payload = await requestWithRetry(apiKey, body, options.signal);
  throwIfCancelled(options.signal);
  const text = extractInteractionText(payload);
  try {
    validateResponseTextSize(text);
  } catch (error) {
    throw new GeminiApiError(
      error instanceof Error ? error.message : "Gemini response is too large."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiApiError("Gemini returned malformed JSON.");
  }

  return validateFlashcardResponse(parsed, count);
}

function normalizeModelName(value: string): string {
  const model = value.trim().replace(/^models\//, "");

  if (!model) {
    throw new GeminiApiError("Gemini model is not configured.");
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new GeminiApiError("Gemini model name contains invalid characters.");
  }

  return model;
}

async function requestWithRetry(
  apiKey: string,
  body: string,
  signal?: AbortSignal
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    throwIfCancelled(signal);
    try {
      const response = await raceWithCancellation(
        requestUrl({
          url: INTERACTIONS_ENDPOINT,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body,
          throw: false
        }),
        signal
      );
      throwIfCancelled(signal);

      if (response.status >= 200 && response.status < 300) {
        // Bound the complete HTTP envelope before parsing it, including output
        // metadata and unused steps. requestUrl itself buffers the transport.
        try {
          validateResponseTextSize(response.text);
        } catch {
          throw new GeminiApiError(
            "Gemini returned a JSON response larger than 1 MiB."
          );
        }
        try {
          return JSON.parse(response.text) as unknown;
        } catch {
          throw new GeminiApiError("Gemini returned a malformed HTTP response.");
        }
      }

      const error = createHttpError(response.status, response.text);
      if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      lastError = error;
    } catch (error) {
      if (error instanceof GeminiRequestCancelledError) {
        throw error;
      }

      if (error instanceof GeminiApiError) {
        if (!isRetryableStatus(error.statusCode) || attempt === MAX_ATTEMPTS) {
          throw error;
        }
      } else {
        // A lost connection does not establish whether the paid POST completed.
        // Retrying it automatically could create another charged generation.
        throw new GeminiApiError(
          "The Gemini connection was interrupted. The request may still have completed; wait before generating again."
        );
      }

      lastError = error;
    }

    await waitForRetry(attempt, signal);
  }

  if (lastError instanceof GeminiApiError) {
    throw lastError;
  }

  throw new GeminiApiError("Gemini request failed.");
}

function createHttpError(
  statusCode: number,
  responseText = ""
): GeminiApiError {
  // Read only a short machine-readable code from the provider response. Never
  // echo its message: it can contain request text, model input, or credentials.
  const providerCode = extractProviderErrorCode(responseText);

  if (statusCode === 401 || statusCode === 403) {
    const code = providerCode ??
      (statusCode === 401 ? "authentication" : "permission_denied");
    return new GeminiApiError(
      withErrorCode(
        "Gemini rejected authorization. Select a valid auth key in plugin settings.",
        statusCode,
        code
      ),
      statusCode,
      code
    );
  }

  if (statusCode === 429) {
    const code = providerCode ?? "rate_limit_exceeded";
    return new GeminiApiError(
      withErrorCode(
        "Gemini rate limit or quota was reached. Wait a moment and try again.",
        statusCode,
        code
      ),
      statusCode,
      code
    );
  }

  if (statusCode === 408 || statusCode >= 500) {
    const code = providerCode ??
      (statusCode === 408 ? "deadline_exceeded" : "unavailable");
    return new GeminiApiError(
      withErrorCode(
        "Gemini is temporarily unavailable. Try again shortly.",
        statusCode,
        code
      ),
      statusCode,
      code
    );
  }

  if (statusCode === 400) {
    const code = providerCode ?? "invalid_request";
    return new GeminiApiError(
      withErrorCode(
        "Gemini rejected the request. Check the API key type, model, prompt, and project prerequisites.",
        statusCode,
        code
      ),
      statusCode,
      code
    );
  }

  const code = providerCode ?? defaultHttpErrorCode(statusCode);
  return new GeminiApiError(
    withErrorCode("Gemini request failed.", statusCode, code),
    statusCode,
    code
  );
}

function extractProviderErrorCode(responseText: string): string | undefined {
  // Error payloads should be tiny. Avoid parsing an unexpectedly large body,
  // and only accept identifier-shaped values from known fields.
  if (!responseText || responseText.length > 64 * 1024) {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseText) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(payload) || !isRecord(payload.error)) {
    return undefined;
  }

  const error = payload.error;
  const candidates: unknown[] = [];
  if (Array.isArray(error.details)) {
    for (const detail of error.details) {
      if (!isRecord(detail)) continue;
      candidates.push(detail.reason);
      if (isRecord(detail.errorInfo)) {
        candidates.push(detail.errorInfo.reason);
      }
    }
  }
  if (isRecord(error.errorInfo)) {
    candidates.push(error.errorInfo.reason);
  }
  candidates.push(error.code, error.status);

  for (const candidate of candidates) {
    const code = normalizeProviderErrorCode(candidate);
    if (code) return code;
  }

  return undefined;
}

function normalizeProviderErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim();
  return SAFE_PROVIDER_ERROR_CODES.has(code) ? code : undefined;
}

function defaultHttpErrorCode(statusCode: number): string {
  if (statusCode === 404) return "not_found";
  if (statusCode === 409) return "conflict";
  return "http_error";
}

function withErrorCode(
  message: string,
  statusCode: number,
  code: string
): string {
  return `${message} Error code: ${code} (HTTP ${statusCode}).`;
}

function extractInteractionText(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new GeminiApiError("Gemini returned an invalid response.");
  }

  if (payload.status !== "completed") {
    throw new GeminiApiError(
      "Gemini returned an incomplete interaction. No cards were accepted."
    );
  }

  if (!Array.isArray(payload.steps)) {
    throw new GeminiApiError("Gemini returned no output steps.");
  }

  const outputSteps = payload.steps.filter(
    (step): step is Record<string, unknown> =>
      isRecord(step) && step.type === "model_output"
  );
  const lastOutput = outputSteps[outputSteps.length - 1];

  if (!lastOutput || !Array.isArray(lastOutput.content)) {
    throw new GeminiApiError("Gemini returned no model output.");
  }

  const text = lastOutput.content
    .filter(
      (part): part is Record<string, unknown> =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text as string)
    .join("");

  if (!text.trim()) {
    throw new GeminiApiError("Gemini returned empty output.");
  }

  return text;
}

function isRetryableStatus(statusCode: number | undefined): boolean {
  return statusCode === 429 || (statusCode ?? 0) >= 500;
}

async function waitForRetry(
  attempt: number,
  signal?: AbortSignal
): Promise<void> {
  const baseDelay = 500 * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, baseDelay + jitter);
    const onAbort = (): void => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new GeminiRequestCancelledError());
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new GeminiRequestCancelledError();
  }
}

function raceWithCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new GeminiRequestCancelledError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(
      () => finish(() => reject(new GeminiRequestTimeoutError())),
      GEMINI_REQUEST_TIMEOUT_MS
    );
    const onAbort = (): void => {
      finish(() => reject(new GeminiRequestCancelledError()));
    };
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
