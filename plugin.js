export const meta = {
  apiVersion: 1,
  key: "rexcoding-yu_artdance",
  name: "ArtDance Video",
  icon: "text:AD",
  description: {
    en: "Artbox Artdance video generation with Doubao-compatible client APIs",
    zh: "Artbox Artdance 视频生成（客户端兼容豆包接口）",
  },
  version: "1.0.2",
  author: { name: "Custom" },
  website: "https://artbox.top/docs",
  baseUrl: "https://artbox.top/v1",
  models: [
    "Artdance 2 Mini-480p",
    "Artdance 2 Mini-720p",
    "Artdance 2.0-480p",
    "Artdance 2.0-720p",
    "Artdance 2.0-1080p",
    "Artdance 2.0-4K",
    "Artdance 2.5-480p",
    "Artdance 2.5-720p",
    "Artdance 2.5-1080p",
    "Artdance Fast-720p",
  ],
  fetchMode: "per_task",
  usageSchema: {
    // Requested output duration. Artbox bills completed seconds at the model unit price.
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
  },
  usageExamples: [
    { label: "5s", facts: { seconds: 5 } },
    { label: "8s", facts: { seconds: 8 } },
    { label: "15s", facts: { seconds: 15 } },
  ],
  routes: [
    { method: "POST", path: "/artdance/api/v3/contents/generations/tasks", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/artdance/api/v3/contents/generations/tasks/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }],
};

function trimmed(value) {
  return String(value || "").trim();
}

function publicHttpURL(value, field) {
  const url = trimmed(value);
  if (!url) return "";
  const lower = url.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
    throw new Error((field || "media reference") + " must be a public HTTP URL");
  }
  return url;
}

function mediaURL(item, key, field) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  let value = item[key];
  if (value && typeof value === "object" && !Array.isArray(value)) value = value.url;
  return publicHttpURL(value, field);
}

function parseSeconds(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) {
    throw new Error("seconds must be between 1 and 3600");
  }
  return seconds;
}

// Artbox requires aspect_ratio on every submit. Doubao clients send ratio.
function parseAspectRatio(value) {
  const raw = trimmed(value).toLowerCase().replace(/\s+/g, "");
  if (!raw || raw === "adaptive") return "adaptive";
  const parts = raw.replace(/[x*/]/g, ":").split(":");
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (parts.length !== 2 || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 99 || height > 99) {
    throw new Error("aspect_ratio must look like 16:9");
  }
  return width + ":" + height;
}

function pushUnique(list, value) {
  const url = trimmed(value);
  if (url && !list.includes(url)) list.push(url);
}

function imageRole(item) {
  return trimmed(item && item.role)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function parseDoubaoContent(content) {
  const texts = [];
  const images = [];
  const videoURLs = [];
  const audioURLs = [];
  let startImageURL = "";
  let endImageURL = "";
  if (!Array.isArray(content)) {
    return { texts: texts, images: images, videoURLs: videoURLs, audioURLs: audioURLs, startImageURL: startImageURL, endImageURL: endImageURL };
  }
  for (const item of content) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
      continue;
    }
    const image = mediaURL(item, "image_url", "image_url") || mediaURL(item, "image", "image");
    if (image) {
      const role = imageRole(item);
      if (role === "first_frame" && !startImageURL) startImageURL = image;
      else if (role === "last_frame" && !endImageURL) endImageURL = image;
      else pushUnique(images, image);
      continue;
    }
    const video = mediaURL(item, "video_url", "video_url") || mediaURL(item, "video", "video");
    if (video) {
      pushUnique(videoURLs, video);
      continue;
    }
    const audio = mediaURL(item, "audio_url", "audio_url") || mediaURL(item, "audio", "audio");
    if (audio) pushUnique(audioURLs, audio);
  }
  return { texts: texts, images: images, videoURLs: videoURLs, audioURLs: audioURLs, startImageURL: startImageURL, endImageURL: endImageURL };
}

function submitIntent(model, prompt, media, seconds, generateAudio, aspectRatio) {
  const hasReference = media.images.length > 0 || media.videoURLs.length > 0 || media.audioURLs.length > 0 || !!media.startImageURL || !!media.endImageURL;
  if (!trimmed(prompt) && !hasReference) throw new Error("content is required");
  const requestBody = { model: model, prompt: trimmed(prompt), aspect_ratio: parseAspectRatio(aspectRatio) };
  if (seconds !== undefined) requestBody.seconds = seconds;
  if (media.images.length) requestBody.images = media.images;
  if (media.startImageURL) requestBody.start_image_url = media.startImageURL;
  if (media.endImageURL) requestBody.end_image_url = media.endImageURL;
  if (media.videoURLs.length) requestBody.video_urls = media.videoURLs;
  if (media.audioURLs.length) requestBody.audio_urls = media.audioURLs;
  if (generateAudio === true) requestBody.generate_audio = true;
  return {
    kind: "submit",
    model: model,
    action: hasReference ? "image_to_video" : "text_to_video",
    requestBody: requestBody,
  };
}

function apiRoot(baseUrl) {
  const base = trimmed(baseUrl).replace(/\/+$/, "");
  return /\/v1$/i.test(base) ? base : base + "/v1";
}

function generationsURL(baseUrl, taskId) {
  const root = apiRoot(baseUrl);
  if (taskId) return root + "/video/generations/" + encodeURIComponent(taskId);
  return root + "/video/generations";
}

function videosContentURL(baseUrl, taskId) {
  const id = trimmed(taskId);
  if (!id) return "";
  return apiRoot(baseUrl) + "/videos/" + encodeURIComponent(id) + "/content";
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function videoURLFromBody(body) {
  const root = objectValue(body);
  const metadata = objectValue(root.metadata);
  const content = objectValue(root.content);
  const output = objectValue(root.output);
  const data = objectValue(root.data);
  const result = objectValue(root.result);
  const candidates = [
    root.video_url,
    root.download_url,
    root.result_url,
    root.file_url,
    root.play_url,
    root.output_url,
    root.url,
    metadata.video_url,
    metadata.download_url,
    metadata.url,
    content.video_url,
    content.url,
    output.video_url,
    output.url,
    data.video_url,
    data.url,
    result.video_url,
    result.url,
  ];
  for (const candidate of candidates) {
    const url = trimmed(candidate);
    if (url) return url;
  }
  const found = [];
  collectHTTPURLs(root, found);
  for (const url of found) {
    if (/\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(url)) return url;
  }
  return "";
}

function collectHTTPURLs(value, found) {
  if (typeof value === "string") {
    const url = trimmed(value);
    if (url.toLowerCase().indexOf("http://") === 0 || url.toLowerCase().indexOf("https://") === 0) found.push(url);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHTTPURLs(item, found);
    return;
  }
  if (!value || typeof value !== "object") return;
  const keys = Object.keys(value);
  for (const key of keys) collectHTTPURLs(value[key], found);
}

function taskModel(task) {
  const properties = objectValue(task && task.properties);
  const fromProps = trimmed(properties.origin_model_name || properties.upstream_model_name);
  if (fromProps) return fromProps;
  return trimmed(objectValue(task && task.data).model);
}

function doubaoStatus(task) {
  const status = String((task && task.status) || "").toUpperCase();
  if (status === "SUCCESS") return "succeeded";
  if (status === "FAILURE") return "failed";
  if (status === "IN_PROGRESS") return "running";
  return "queued";
}

function usageSeconds(req) {
  let seconds = Number((req && (req.seconds !== undefined ? req.seconds : req.duration)) || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = 5;
  return Math.min(seconds, 3600);
}

function responsesInput(req) {
  const texts = [];
  const images = [];
  const input = req.input;
  if (typeof input === "string") texts.push(input);
  else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const content = item.content === undefined ? [item] : Array.isArray(item.content) ? item.content : [item.content];
      for (const part of content) {
        if (typeof part === "string") {
          texts.push(part);
          continue;
        }
        if (!part || typeof part !== "object" || Array.isArray(part)) continue;
        if (["input_text", "text"].includes(part.type) && typeof part.text === "string") texts.push(part.text);
        if (["input_image", "image_url"].includes(part.type)) {
          let image = part.image_url;
          if (image && typeof image === "object") image = image.url;
          if (trimmed(image)) images.push(trimmed(image));
        }
      }
    }
  }
  return {
    prompt: texts
      .filter(function (text) {
        return trimmed(text);
      })
      .join("\n"),
    images: images,
  };
}

function responsesVideoText(ctx) {
  const artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  const url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  const escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

export const native = {
  createTask: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = ctx.body.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
    const model = trimmed(body.model);
    if (!model) throw new Error("model is required");
    if (body.content !== undefined && !Array.isArray(body.content)) throw new Error("content must be an array");
    const media = parseDoubaoContent(body.content);
    const prompt = media.texts
      .filter(function (text) {
        return trimmed(text);
      })
      .join("\n") || trimmed(body.prompt);
    const seconds = parseSeconds(body.duration !== undefined ? body.duration : body.seconds);
    const aspectRatio = body.aspect_ratio !== undefined ? body.aspect_ratio : body.ratio;
    return submitIntent(model, prompt, media, seconds, body.generate_audio, aspectRatio);
  },
  taskCreated: function (ctx, task) {
    return {
      id: task.task_id,
      model: taskModel(task),
      status: "queued",
      created_at: task.created_at,
      content: {},
    };
  },
  taskStatus: function (ctx, task) {
    const status = doubaoStatus(task);
    const output = {
      id: task.task_id,
      model: taskModel(task),
      status: status,
      created_at: task.created_at,
      updated_at: task.updated_at,
      content: {},
    };
    if (status === "succeeded") {
      const url = videoURLFromBody(task.data) || trimmed(task.url) || "/v1/videos/" + task.task_id + "/content";
      output.content = { video_url: url };
    }
    if (status === "failed") {
      output.error = { message: task.fail_reason || "task failed" };
    }
    return output;
  },
  error: function (ctx, error) {
    return { error: { code: error.code, message: error.message } };
  },
};

export function buildSubmitRequest(ctx) {
  const req = ctx.requestBody || {};
  const model = ctx.upstreamModel || req.model || "";
  const prompt = trimmed(req.prompt);
  const images = Array.isArray(req.images) ? req.images : [];
  const videoURLs = Array.isArray(req.video_urls) ? req.video_urls : [];
  const audioURLs = Array.isArray(req.audio_urls) ? req.audio_urls : [];
  const startImageURL = publicHttpURL(req.start_image_url, "start_image_url");
  const endImageURL = publicHttpURL(req.end_image_url, "end_image_url");
  const hasReference = images.length > 0 || videoURLs.length > 0 || audioURLs.length > 0 || !!startImageURL || !!endImageURL;
  if (!prompt && !hasReference) throw new Error("content is required");
  const seconds = req.seconds === undefined && req.duration === undefined ? 5 : parseSeconds(req.seconds !== undefined ? req.seconds : req.duration);
  const body = {
    model: model,
    prompt: prompt,
    seconds: String(seconds),
    aspect_ratio: parseAspectRatio(req.aspect_ratio !== undefined ? req.aspect_ratio : req.ratio),
  };
  if (images.length) {
    body.image_urls = images.map(function (image) {
      return publicHttpURL(image, "image_url");
    });
  }
  if (startImageURL) body.start_image_url = startImageURL;
  if (endImageURL) body.end_image_url = endImageURL;
  if (videoURLs.length) {
    body.video_urls = videoURLs.map(function (video) {
      return publicHttpURL(video, "video_url");
    });
  }
  if (audioURLs.length) {
    body.audio_urls = audioURLs.map(function (audio) {
      return publicHttpURL(audio, "audio_url");
    });
  }
  if (req.generate_audio === true) body.generate_audio = true;
  return {
    url: generationsURL(ctx.baseUrl),
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: hasReference ? "image_to_video" : "text_to_video",
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = objectValue(resp.body);
  const taskId = trimmed(body.id || body.task_id);
  if (!taskId) throw new Error("task_id is empty");
  return { taskId: taskId, taskData: resp.body };
}

export function extractUsage(ctx) {
  return { seconds: usageSeconds(ctx.requestBody || {}) };
}

export function extractUsageOnComplete(task, taskResult, body) {
  const root = objectValue(body);
  const metadata = objectValue(root.metadata);
  const seconds = Number(root.seconds !== undefined ? root.seconds : root.duration !== undefined ? root.duration : metadata.seconds !== undefined ? metadata.seconds : metadata.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return {};
  return { seconds: Math.min(seconds, 3600) };
}

export function buildQueryRequest(ctx) {
  return {
    url: generationsURL(ctx.baseUrl, ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(ctx, body) {
  const root = objectValue(body);
  const statuses = {
    queued: "QUEUED",
    pending: "QUEUED",
    not_start: "QUEUED",
    submitted: "QUEUED",
    processing: "IN_PROGRESS",
    in_progress: "IN_PROGRESS",
    running: "IN_PROGRESS",
    completed: "SUCCESS",
    success: "SUCCESS",
    succeeded: "SUCCESS",
    failed: "FAILURE",
    error: "FAILURE",
    cancelled: "FAILURE",
    expired: "FAILURE",
  };
  const mapped = statuses[trimmed(root.status).toLowerCase()];
  const result = { status: mapped || "UNKNOWN" };
  if (!mapped) result.reason = "unrecognized status: " + String(root.status || "");
  const progress = Number(root.progress);
  if (Number.isFinite(progress) && progress > 0 && progress <= 100) result.progress = progress + "%";
  else if (result.status === "QUEUED") result.progress = "10%";
  else if (result.status === "IN_PROGRESS") result.progress = "50%";
  else if (result.status === "SUCCESS" || result.status === "FAILURE") result.progress = "100%";
  if (result.status === "SUCCESS") result.url = videoURLFromBody(root) || videosContentURL(ctx && ctx.baseUrl, ctx && ctx.taskId);
  if (result.status === "FAILURE") {
    const error = objectValue(root.error);
    result.reason = trimmed(error.message || root.message || root.status) || "task failed";
  }
  return result;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const direct = videoURLFromBody(ctx.data);
  if (direct) return { url: direct, method: ctx.clientRequest.method, credentialless: true };
  const data = objectValue(ctx.data);
  const url = videosContentURL(ctx.baseUrl, ctx.upstreamTaskId || data.id || data.task_id);
  if (!url) throw new Error("artifact_not_found");
  return {
    url: url,
    method: ctx.clientRequest.method,
    headers: { Authorization: "Bearer " + ctx.apiKey, Accept: "*/*" },
  };
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      const model = trimmed(req.model);
      if (!model) throw new Error("model is required");
      if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input)) throw new Error("input must be a string or array");
      if (req.images !== undefined && !Array.isArray(req.images)) throw new Error("images must be an array");
      if (req.metadata !== undefined && (!req.metadata || typeof req.metadata !== "object" || Array.isArray(req.metadata))) {
        throw new Error("metadata must be an object");
      }
      const input = responsesInput(req);
      const media = parseDoubaoContent(req.metadata && req.metadata.content);
      const prompt = input.prompt || media.texts.join("\n") || trimmed(req.prompt);
      for (const image of [req.image, req.input_reference].concat(req.images || [], input.images)) {
        const url = publicHttpURL(image, "image_url");
        if (url) pushUnique(media.images, url);
      }
      const seconds = parseSeconds(req.seconds !== undefined ? req.seconds : req.duration !== undefined ? req.duration : req.metadata && req.metadata.duration);
      const generateAudio = req.generate_audio === true || (req.metadata && req.metadata.generate_audio === true);
      const aspectRatio = req.aspect_ratio !== undefined ? req.aspect_ratio : req.ratio !== undefined ? req.ratio : req.metadata && (req.metadata.aspect_ratio !== undefined ? req.metadata.aspect_ratio : req.metadata.ratio);
      return submitIntent(model, prompt, media, seconds, generateAudio, aspectRatio);
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const value = Number(String(task.progress || "").replace("%", ""));
      const progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        const text = responsesVideoText(ctx);
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: text }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE") {
        return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: state, done: true };
      }
      if (previousState && previousState.status === status && previousState.progress === progress) return { events: [], state: state, done: false };
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state: state, done: false };
    },
    renderFinal: function (ctx, _task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: responsesVideoText(ctx), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "artdance" },
      };
    },
  },
};
