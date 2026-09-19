import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({
  requestUrlMock: vi.fn()
}));

vi.mock("obsidian", () => ({
  requestUrl: requestUrlMock
}));

import {
  GeminiApiError,
  GeminiRequestCancelledError,
  GeminiRequestTimeoutError,
  GEMINI_REQUEST_TIMEOUT_MS,
  generateFlashcards
} from "../services/gemini";
import { MAX_RESPONSE_BYTES } from "../services/generation-limits";

interface MockResponse {
  status: number;
  text: string;
}

function httpResponse(status: number, json: unknown): MockResponse {
  return { status, text: JSON.stringify(json) };
}

const defaultOptions = {
  apiKey: "test-key",
  model: "gemini-test-model",
  note: "TCP is connection-oriented.",
  count: 10,
  instructions: "Create atomic cards from the source."
};

function completedResponse(text: string): MockResponse {
  return httpResponse(200, {
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text }]
        }
      ]
  });
}

function successfulResponse(): MockResponse {
  return completedResponse(
    JSON.stringify({
      cards: [
        {
          question: "What kind of protocol is TCP?",
          answer: "Connection-oriented.",
          evidence: "TCP is connection-oriented"
        }
      ]
    })
  );
}

describe("Gemini Interactions client", () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns structured cards and sends the configured output limit", async () => {
    requestUrlMock.mockResolvedValue(successfulResponse());

    await expect(generateFlashcards(defaultOptions)).resolves.toEqual({
      cards: [
        {
          question: "What kind of protocol is TCP?",
          answer: "Connection-oriented.",
          evidence: "TCP is connection-oriented"
        }
      ]
    });

    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    const request = requestUrlMock.mock.calls[0]?.[0] as {
      headers: Record<string, string>;
      body: string;
    };
    const body = JSON.parse(request.body) as {
      generation_config: { max_output_tokens: number };
      response_format: Array<{ schema: Record<string, unknown> }>;
    };

    expect(request.headers["x-goog-api-key"]).toBe("test-key");
    expect(body.generation_config.max_output_tokens).toBe(8_192);
    expect(JSON.stringify(body.response_format[0]?.schema)).toContain(
      "evidence"
    );
  });

  it("rejects malformed JSON from a completed interaction", async () => {
    requestUrlMock.mockResolvedValue(completedResponse("{not-json"));

    await expect(generateFlashcards(defaultOptions)).rejects.toMatchObject({
      name: "GeminiApiError",
      message: "Gemini returned malformed JSON."
    });
  });

  it("rejects incomplete interactions and completed responses without output", async () => {
    requestUrlMock.mockResolvedValueOnce(
      httpResponse(200, { status: "incomplete", steps: [] })
    );

    await expect(generateFlashcards(defaultOptions)).rejects.toThrow(
      "incomplete interaction"
    );

    requestUrlMock.mockResolvedValueOnce(
      httpResponse(200, { status: "completed", steps: [] })
    );

    await expect(generateFlashcards(defaultOptions)).rejects.toThrow(
      "no model output"
    );
  });

  it("surfaces HTTP 400 without retrying", async () => {
    requestUrlMock.mockResolvedValue(httpResponse(400, {
        error: { code: "invalid_request", message: "Bad schema" }
    }));

    await expect(generateFlashcards(defaultOptions)).rejects.toMatchObject({
      name: "GeminiApiError",
      statusCode: 400,
      apiStatus: "invalid_request",
      message:
        "Gemini rejected the request. Check the API key type, model, prompt, and project prerequisites. Error code: invalid_request (HTTP 400)."
    });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a safe nested provider reason without exposing its message", async () => {
    const privateText = "private-note-and-api-key";
    requestUrlMock.mockResolvedValue(httpResponse(400, {
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: privateText,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "API_KEY_INVALID",
            metadata: { service: "generativelanguage.googleapis.com" }
          }
        ]
      }
    }));

    const error = await generateFlashcards(defaultOptions).catch(
      (caught: unknown) => caught
    );
    expect(error).toMatchObject({
      statusCode: 400,
      apiStatus: "API_KEY_INVALID",
      message:
        "Gemini rejected the request. Check the API key type, model, prompt, and project prerequisites. Error code: API_KEY_INVALID (HTTP 400)."
    });
    expect(String(error)).not.toContain(privateText);
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("retries HTTP 429 and reports quota exhaustion after three attempts", async () => {
    vi.useFakeTimers();
    requestUrlMock.mockResolvedValue(httpResponse(429, {
        error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" }
    }));

    const generation = generateFlashcards(defaultOptions);
    const rejection = expect(generation).rejects.toMatchObject({
      statusCode: 429,
      apiStatus: "RESOURCE_EXHAUSTED",
      message: expect.stringContaining(
        "Error code: RESOURCE_EXHAUSTED (HTTP 429)."
      )
    });
    await vi.runAllTimersAsync();
    await rejection;

    expect(requestUrlMock).toHaveBeenCalledTimes(3);
  });

  it("retries a 5xx response and accepts a later successful response", async () => {
    vi.useFakeTimers();
    requestUrlMock
      .mockResolvedValueOnce(httpResponse(503, {
        error: { status: "UNAVAILABLE", message: "Try later" }
      }))
      .mockResolvedValueOnce(successfulResponse());

    const generation = generateFlashcards(defaultOptions);
    await vi.runAllTimersAsync();

    await expect(generation).resolves.toHaveProperty("cards.0.evidence");
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("rejects output larger than 1 MiB before attempting JSON parsing", async () => {
    requestUrlMock.mockResolvedValue(
      completedResponse("x".repeat(MAX_RESPONSE_BYTES + 1))
    );

    await expect(generateFlashcards(defaultOptions)).rejects.toMatchObject({
      name: "GeminiApiError",
      message: "Gemini returned a JSON response larger than 1 MiB."
    });
  });

  it("bounds the entire HTTP envelope before accessing a parsed JSON getter", async () => {
    const jsonGetter = vi.fn(() => { throw new Error("must not parse"); });
    const response = httpResponse(200, {
      padding: "x".repeat(MAX_RESPONSE_BYTES),
      status: "completed",
      steps: []
    });
    Object.defineProperty(response, "json", { get: jsonGetter });
    requestUrlMock.mockResolvedValue(response);

    await expect(generateFlashcards(defaultOptions)).rejects.toThrow("larger than 1 MiB");
    expect(jsonGetter).not.toHaveBeenCalled();
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed outer HTTP JSON without retrying a completed request", async () => {
    requestUrlMock.mockResolvedValue({ status: 200, text: "not-json" });
    await expect(generateFlashcards(defaultOptions)).rejects.toThrow("malformed HTTP response");
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("does not expose provider-echoed notes or secrets in errors", async () => {
    const privateText = "private-note-and-api-key";
    requestUrlMock.mockResolvedValueOnce(httpResponse(400, {
      error: { message: privateText, status: privateText }
    }));
    const httpError = await generateFlashcards(defaultOptions).catch((error: unknown) => error);
    expect(httpError).toBeInstanceOf(GeminiApiError);
    expect(String(httpError)).not.toContain(privateText);
    expect(String(httpError)).toContain("Error code: invalid_request (HTTP 400)");

    requestUrlMock.mockResolvedValueOnce(httpResponse(200, {
      status: privateText,
      error: { message: privateText }
    }));
    const interactionError = await generateFlashcards(defaultOptions).catch((error: unknown) => error);
    expect(interactionError).toBeInstanceOf(GeminiApiError);
    expect(String(interactionError)).not.toContain(privateText);
  });

  it("does not retry an ambiguous network failure or an HTTP timeout", async () => {
    requestUrlMock.mockRejectedValueOnce(new Error("lost response: private-api-key"));
    await expect(generateFlashcards(defaultOptions)).rejects.toThrow("connection was interrupted");
    expect(requestUrlMock).toHaveBeenCalledTimes(1);

    requestUrlMock.mockResolvedValueOnce(httpResponse(408, {}));
    await expect(generateFlashcards(defaultOptions)).rejects.toMatchObject({ statusCode: 408 });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("times out a hanging request without retrying and ignores its late result", async () => {
    vi.useFakeTimers();
    let resolveRequest: ((response: MockResponse) => void) | undefined;
    requestUrlMock.mockReturnValue(new Promise<MockResponse>((resolve) => {
      resolveRequest = resolve;
    }));
    const generation = generateFlashcards(defaultOptions);
    const rejection = expect(generation).rejects.toBeInstanceOf(GeminiRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(GEMINI_REQUEST_TIMEOUT_MS);
    await rejection;
    resolveRequest?.(successfulResponse());
    await Promise.resolve();
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts surrounding whitespace toward the 1 MiB response limit", async () => {
    const tinyJson = JSON.stringify({ cards: [] });
    requestUrlMock.mockResolvedValue(
      completedResponse(
        `${" ".repeat(MAX_RESPONSE_BYTES - tinyJson.length + 1)}${tinyJson}`
      )
    );

    await expect(generateFlashcards(defaultOptions)).rejects.toThrow(
      "larger than 1 MiB"
    );
  });

  it("rejects a generated field over 2,000 characters", async () => {
    requestUrlMock.mockResolvedValue(
      completedResponse(
        JSON.stringify({
          cards: [
            {
              question: "Q".repeat(2_001),
              answer: "A",
              evidence: "TCP is connection-oriented"
            }
          ]
        })
      )
    );

    await expect(generateFlashcards(defaultOptions)).rejects.toThrow(
      /question longer than 2.000 characters/u
    );
  });

  it("does not start a request when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateFlashcards({ ...defaultOptions, signal: controller.signal })
    ).rejects.toBeInstanceOf(GeminiRequestCancelledError);
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("ignores a late HTTP result after cancellation", async () => {
    let resolveRequest: ((response: MockResponse) => void) | undefined;
    requestUrlMock.mockReturnValue(
      new Promise<MockResponse>((resolve) => {
        resolveRequest = resolve;
      })
    );
    const controller = new AbortController();
    const generation = generateFlashcards({
      ...defaultOptions,
      signal: controller.signal
    });
    const rejection = expect(generation).rejects.toBeInstanceOf(
      GeminiRequestCancelledError
    );

    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    controller.abort();
    await rejection;

    resolveRequest?.(successfulResponse());
    await Promise.resolve();
  });

  it("uses GeminiApiError for client validation failures", async () => {
    await expect(
      generateFlashcards({ ...defaultOptions, apiKey: "" })
    ).rejects.toBeInstanceOf(GeminiApiError);
    await expect(
      generateFlashcards({ ...defaultOptions, model: "bad/model" })
    ).rejects.toBeInstanceOf(GeminiApiError);
  });
});
