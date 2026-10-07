// Native Node WebSocket, no new package or DevTools panel.
export async function connectCdp(url, Socket = WebSocket) {
  const socket = new Socket(url);
  let id = 0;
  let closed = false;
  const pending = new Map();
  const events = [];
  const failAll = (error) => {
    closed = true;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  socket.addEventListener("close", () => failAll(new Error("CDP socket closed")));
  socket.addEventListener("error", () => failAll(new Error("CDP WebSocket error")));
  socket.addEventListener("message", (message) => {
    try {
      const data = JSON.parse(message.data);
      if (!data.id) {
        events.push({ observedAt: new Date().toISOString(), ...data });
        return;
      }
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      clearTimeout(item.timer);
      if (data.error) item.reject(new Error(data.error.message));
      else item.resolve(data.result);
    } catch (error) {
      failAll(error);
      socket.close();
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP connect timeout"));
    }, 10000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("CDP connection error"));
      },
      { once: true }
    );
  });
  return {
    events,
    close: () => socket.close(),
    call(method, params = {}, timeoutMs = 10000) {
      if (closed) return Promise.reject(new Error("CDP socket closed"));
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`CDP timeout: ${method}`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id: requestId, method, params }));
        } catch (error) {
          pending.delete(requestId);
          clearTimeout(timer);
          reject(error);
        }
      });
    },
  };
}
