import { CREATE_CATS } from "../../data/demo-data.js";
import {
  categoryIdForCreateKey,
  creatorAccount,
  creatorNickname,
} from "./admin-character-editor-fields.js";
import {
  adminCommonCharacterCreateHtml,
  adminCommonCharacterEditHtml,
} from "./admin-character-editor-common-template.js";
import {
  adminCreatorCharacterCreateHtml,
  adminCreatorCharacterEditHtml,
} from "./admin-character-editor-creator-template.js";

export function adminCharacterEditorHtml({ character, mode = "common", title = "编辑角色", sites = [], creatorAccounts = [], isCreate = false }) {
  void sites;
  if (!character) return "";
  const isCreator = mode === "creator";
  const isCommonCreate = isCreate && !isCreator;
  const isCreatorCreate = isCreate && isCreator;
  const showAiControls = true;
  const ownerName = isCreator ? "对应账号" : creatorNickname(character.creator);
  const ownerAccount = isCreator ? character.ownerAccount || "未绑定" : creatorAccount(character.creator);
  const selectedCreatorAccount = creatorAccounts.find((account) => account.id === character.ownerUid) || null;
  const derivedSiteName = selectedCreatorAccount?.siteName || character.siteName || "选择账号后自动带出";
  const derivedSiteSlug = selectedCreatorAccount?.siteSlug || "";
  const avatarPlaceholder = isCreate ? "image" : "";
  const categoryItems = isCreator
    ? [["creator", "Creator"]]
    : CREATE_CATS.filter((item) => item.key !== "Creator").map((item) => [categoryIdForCreateKey(item.key), item.label]);

  if (isCommonCreate) {
    return adminCommonCharacterCreateHtml({ character, title, categoryItems, avatarPlaceholder, showAiControls });
  }
  if (!isCreator) {
    return adminCommonCharacterEditHtml({ character, title, categoryItems, showAiControls, ownerName, ownerAccount });
  }
  if (isCreatorCreate) {
    return adminCreatorCharacterCreateHtml({ character, title, avatarPlaceholder, showAiControls, creatorAccounts, derivedSiteName, derivedSiteSlug });
  }
  return adminCreatorCharacterEditHtml({ character, title, showAiControls, ownerName, ownerAccount, derivedSiteName, derivedSiteSlug });
}
