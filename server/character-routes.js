import { polishCharacterBackstory } from "./character-polish-service.js";
import { activateUserCharacter, createUserCharacter, getCharacterDetail, listPublicCharacters } from "./character-service.js";
import { generateCharacterAvatarImage } from "./image-generation-service.js";
import { moderateAvatarImage } from "./avatar-moderation-service.js";
import { readJson, readRequestBuffer, sendJson } from "./http-utils.js";
import { getOptionalRequestUser, requireRequestUser } from "./request-user-service.js";
import { decodeUploadFilename } from "./route-utils.js";
import { deleteTemporaryAvatar, saveAvatarUpload } from "./upload-service.js";
import { AVATAR_UPLOAD_POLICY } from "./upload-policies.js";

export async function handleCharacterRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/characters") {
    sendJson(res, 200, await listPublicCharacters({
      category: requestUrl.searchParams.get("category"),
      siteSlug: requestUrl.searchParams.get("siteSlug"),
    }));
    return true;
  }
  if (req.method === "POST" && path === "/api/characters") {
    const user = await requireRequestUser(req);
    sendJson(res, 200, await createUserCharacter(user.id, await readJson(req)));
    return true;
  }
  if (req.method === "POST" && path === "/api/characters/generate-avatar") {
    const user = await requireRequestUser(req);
    sendJson(res, 200, await generateCharacterAvatarImage({ userId: user.id, payload: await readJson(req) }));
    return true;
  }
  if (req.method === "POST" && path === "/api/uploads/avatar/moderate") {
    await requireRequestUser(req);
    sendJson(res, 200, await moderateAvatarImage({
      buffer: await readRequestBuffer(req, AVATAR_UPLOAD_POLICY.maxSourceBytes || AVATAR_UPLOAD_POLICY.maxBytes),
      contentType: req.headers["content-type"],
    }));
    return true;
  }
  if (req.method === "POST" && path === "/api/uploads/avatar") {
    const user = await requireRequestUser(req);
    sendJson(res, 200, await saveAvatarUpload({
      userId: user.id,
      buffer: await readRequestBuffer(req, AVATAR_UPLOAD_POLICY.maxBytes),
      contentType: req.headers["content-type"],
      filename: decodeUploadFilename(req.headers["x-upload-filename"]),
    }));
    return true;
  }
  if (req.method === "DELETE" && path === "/api/uploads/avatar") {
    await requireRequestUser(req);
    sendJson(res, 200, await deleteTemporaryAvatar(await readJson(req)));
    return true;
  }
  if (req.method === "POST" && path === "/api/characters/polish") {
    await requireRequestUser(req);
    sendJson(res, 200, await polishCharacterBackstory(await readJson(req)));
    return true;
  }
  const activationMatch = path.match(/^\/api\/characters\/([^/]+)\/activate$/);
  if (req.method === "POST" && activationMatch) {
    const user = await requireRequestUser(req);
    sendJson(res, 200, await activateUserCharacter(user.id, decodeURIComponent(activationMatch[1])));
    return true;
  }
  if (req.method === "GET" && path.startsWith("/api/characters/")) {
    const user = await getOptionalRequestUser(req);
    sendJson(res, 200, await getCharacterDetail(path.slice("/api/characters/".length), {
      userId: user?.id || "",
      accountType: user?.account_type || user?.accountType || "personal",
      siteSlug: requestUrl.searchParams.get("siteSlug"),
    }));
    return true;
  }
  return false;
}
