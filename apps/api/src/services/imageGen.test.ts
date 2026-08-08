import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();
const imagesGenerateMock = vi.fn();
const logActivityMock = vi.fn();

vi.mock("../lib/supabase.js", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      }),
    },
  }),
}));

vi.mock("../lib/activity.js", () => ({
  logActivity: (...args: unknown[]) => logActivityMock(...args),
}));

vi.mock("openai", () => ({
  default: class {
    images = { generate: imagesGenerateMock };
  },
}));

const { generateImage } = await import("./imageGen.js");

const PARAMS = {
  topic_text: "why queue theory beats flashcards",
  vertical: "education",
  channel: "linkedin",
  brand_name: "NEXUS",
  workspace_id: "ws-1",
  piece_id: "piece-9",
};

describe("imageGen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({
      data: { publicUrl: "https://proj.supabase.co/storage/v1/object/public/vantage-media/x.png" },
    });
    imagesGenerateMock.mockResolvedValue({
      data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }],
    });
  });

  it("requests inline bytes, never an expiring URL", async () => {
    await generateImage(PARAMS);
    // The bug this pins: response_format "url" returns an OpenAI-hosted link
    // that expires in ~1h, which then got stored on the piece as image_url.
    expect(imagesGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "dall-e-3", response_format: "b64_json" }),
    );
  });

  it("returns a Supabase public URL, not an OpenAI one", async () => {
    const url = await generateImage(PARAMS);
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/public/vantage-media/x.png");
    expect(url).not.toMatch(/oaidalleapi|blob\.core\.windows\.net|openai/i);
  });

  it("stores under the workspace-namespaced generated/ prefix", async () => {
    await generateImage(PARAMS);
    const [path, body, opts] = uploadMock.mock.calls[0]!;
    expect(path).toBe("workspaces/ws-1/generated/piece-9.png");
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(opts).toMatchObject({ contentType: "image/png", upsert: true });
  });

  it("picks the channel's aspect ratio", async () => {
    await generateImage({ ...PARAMS, channel: "tiktok" });
    expect(imagesGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({ size: "1024x1792" }),
    );
  });

  it("throws when the upload fails rather than returning a broken link", async () => {
    uploadMock.mockResolvedValue({ error: { message: "bucket unavailable" } });
    await expect(generateImage(PARAMS)).rejects.toThrow(/upload failed/i);
  });

  it("throws when the model returns no image data", async () => {
    imagesGenerateMock.mockResolvedValue({ data: [{}] });
    await expect(generateImage(PARAMS)).rejects.toThrow(/no image data/i);
  });
});
