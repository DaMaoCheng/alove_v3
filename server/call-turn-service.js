import {
  VOICE_MODEL_MODE_REALTIME_CALL_FAST,
  createUserMessage,
  createUserReply,
} from "./chat-text-message-service.js";
import { logCallTurnTiming } from "./call-diagnostics-service.js";
import { resetProviderSocketForNextTurn } from "./call-provider-socket-service.js";
import { safeString, sendErrorEvent, sendEvent } from "./call-session-service.js";
import { acquireGuestReplyLockForToken, createGuestCallMessage, createGuestCallReply } from "./guest-chat-service.js";

export async function handleFinalTranscript(session, text, turnId = 0) {
  const transcript = safeString(text);
  if (!transcript || session.processing || session.closed) return;
  const normalizedTurnId = Number(turnId || session.activeTurnId || 0);
  if (!normalizedTurnId || session.completedTurnIds.has(normalizedTurnId)) {
    session.ignoredTurnCount += 1;
    sendEvent(session, "stale_turn_ignored", {
      callSessionId: session.callSessionId,
      turnId: normalizedTurnId,
      ignoredTurnCount: session.ignoredTurnCount,
    });
    return;
  }
  session.completedTurnIds.add(normalizedTurnId);
  resetProviderSocketForNextTurn(session);
  const finalAt = Date.now();
  session.processing = true;
  session.listening = false;
  session.turnId = normalizedTurnId;
  session.stageStartedAt = finalAt;

  sendEvent(session, "transcript_final", {
    callSessionId: session.callSessionId,
    turnId: normalizedTurnId,
    text: transcript,
    timing: {
      finalAt,
    },
  });
  sendEvent(session, "assistant_thinking", {
    callSessionId: session.callSessionId,
    turnId: normalizedTurnId,
    timing: {
      finalAt,
    },
  });

  let releaseGuestReplyLock = async () => {};
  const finalizedAudioBytes = session.identityType === "guest" ? Number(session.unfinalizedAudioBytes || 0) : 0;
  let guestFinalPersisted = false;
  if (session.identityType === "guest") session.unfinalizedAudioBytes = 0;
  try {
    if (session.identityType === "guest") releaseGuestReplyLock = await acquireGuestReplyLockForToken(session.guestToken);
    const userMessageStartedAt = Date.now();
    const userResult = session.identityType === "guest"
      ? await createGuestCallMessage({
        token: session.guestToken,
        characterId: session.characterId,
        text: transcript,
        callSessionId: session.callSessionId,
        turnId: normalizedTurnId,
        leaseToken: session.guestCallLeaseToken,
        replyLockHeld: true,
      })
      : await createUserMessage({
        characterId: session.characterId,
        userId: session.user.id,
        text: transcript,
      });
    if (session.identityType === "guest") {
      guestFinalPersisted = true;
      session.providerInputEpoch += 1;
    }
    const userMessageMs = Date.now() - userMessageStartedAt;
    const userMessages = Array.isArray(userResult.items) ? userResult.items : [];
    sendEvent(session, "user_message", {
      callSessionId: session.callSessionId,
      turnId: normalizedTurnId,
      userMessages,
      items: userMessages,
      session: userResult.session || null,
      timing: {
        finalAt,
        userMessageMs,
      },
    });
    if (session.identityType === "guest") {
      const messageCount = Math.max(0, Number(userResult.guest?.messageCount || 0));
      const messageLimit = Math.max(0, Number(userResult.guest?.messageLimit || 30));
      session.guestMessageLimitReached = messageLimit > 0 && messageCount >= messageLimit;
      sendEvent(session, "call_usage", {
        callSessionId: session.callSessionId,
        messageCount,
        messageLimit,
        remainingMessages: Math.max(0, messageLimit - messageCount),
      });
    }
    const sinceMessageId = userResult.items?.find((item) => item?.senderType === "user")?.id || userResult.items?.[0]?.id || "";
    const replyStartedAt = Date.now();
    const replyResult = session.identityType === "guest"
      ? await createGuestCallReply({
        token: session.guestToken,
        characterId: session.characterId,
        messageId: userResult.callUserMessageId || sinceMessageId,
        voiceModelMode: VOICE_MODEL_MODE_REALTIME_CALL_FAST,
        replyLockHeld: true,
      })
      : await createUserReply({
        characterId: session.characterId,
        userId: session.user.id,
        sinceMessageId,
        voiceModelMode: VOICE_MODEL_MODE_REALTIME_CALL_FAST,
      });
    const replyTotalMs = Date.now() - replyStartedAt;
    const replyItems = Array.isArray(replyResult.items) ? replyResult.items : [];
    const replyMessage = findAssistantTextMessage(replyItems);
    const voice = replyMessage?.voice || null;
    const basePayload = {
      callSessionId: session.callSessionId,
      turnId: normalizedTurnId,
      message: replyMessage || null,
      userMessages,
      replyMessages: replyItems,
      items: [...userMessages, ...replyItems],
      session: replyResult.session || userResult.session || null,
      timing: {
        finalAt,
        userMessageMs,
        replyTotalMs,
      },
    };
    logCallTurnTiming({
      callSessionId: session.callSessionId,
      turnId: normalizedTurnId,
      characterId: session.characterId,
      userMessageMs,
      replyTotalMs,
      assistantMessageId: replyMessage?.id || "",
      voiceAssetId: voice?.id || "",
      voiceStatus: voice?.assetStatus || "",
      ttsModel: voice?.model || "",
      languageCode: voice?.languageCode || "",
      languageLabel: voice?.languageLabel || "",
      ttsModelReason: voice?.modelReason || "",
      hasAudio: Boolean(voice?.audioUrl),
    });
    if (voice?.audioUrl && String(voice.assetStatus || "").toLowerCase() === "ready") {
      markTurnAwaitingResume(session);
      sendEvent(session, "assistant_audio", {
        ...basePayload,
        audioUrl: voice.audioUrl,
        durationSeconds: Number(voice.durationSeconds || 0),
      });
      return;
    }
    markTurnAwaitingResume(session);
    sendEvent(session, "assistant_text", basePayload);
  } catch (error) {
    if (session.identityType === "guest" && !guestFinalPersisted) session.unfinalizedAudioBytes += finalizedAudioBytes;
    sendErrorEvent(session, error);
    if (session.identityType === "guest" && error?.code === "GUEST_MESSAGE_LIMIT_REACHED") {
      session.guestMessageLimitReached = true;
      sendEvent(session, "call_ended", {
        callSessionId: session.callSessionId,
        reason: "message_limit_reached",
      });
      session.endGuestCallReason = "message_limit_reached";
      session.onMessageLimitReached?.();
      return;
    }
    markTurnAwaitingResume(session);
  } finally {
    await releaseGuestReplyLock();
  }
}

function markTurnAwaitingResume(session) {
  session.processing = false;
  session.listening = false;
  session.turnPhase = "awaiting_resume";
  session.awaitingResumeStartedAt = Date.now();
}

function findAssistantTextMessage(items = []) {
  return [...(Array.isArray(items) ? items : [])].reverse().find((item) => item?.senderType === "character" && item?.contentType === "text") || null;
}
