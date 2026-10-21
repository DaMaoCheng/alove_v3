export function openCallSocket({
  characterId,
  onMessage = () => {},
  onError = () => {},
  onClose = () => {},
} = {}) {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/call`);
    socket.addEventListener("open", () => {
      sendSocketEvent(socket, {
        type: "start_call",
        characterId,
      });
      resolve(socket);
    }, { once: true });
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", () => {
      onError();
      reject(new Error("WebSocket connection failed"));
    }, { once: true });
    socket.addEventListener("close", onClose);
  });
}

export function sendSocketEvent(socket, payload = {}) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

export function parseSocketPayload(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}
