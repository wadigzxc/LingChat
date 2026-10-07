// Local fake CDP responses test transport only; NOT a browser or RAF benchmark.
import test from "node:test";
import assert from "node:assert/strict";
import * as cdp from "./cdp.mjs";
class UnitSocket extends EventTarget {
  constructor() {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(text) {
    const request = JSON.parse(text);
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify(
            request.method === "bad"
              ? { id: request.id, error: { message: "unit protocol failure" } }
              : { id: request.id, result: { method: request.method, params: request.params } }
          ),
        })
      )
    );
  }
  close() {
    this.dispatchEvent(new Event("close"));
  }
}
test("CDP correlates commands and fails loudly on protocol errors or disconnect", async () => {
  const client = await cdp.connectCdp("ws://127.0.0.1:9223/devtools/page/unit", UnitSocket);
  const results = await Promise.all([
    client.call("one", { value: 1 }),
    client.call("two", { value: 2 }),
  ]);
  assert.equal(results[0].method, "one");
  assert.equal(results[1].params.value, 2);
  await assert.rejects(client.call("bad"), /unit protocol failure/);
  client.close();
  await assert.rejects(client.call("after-close"), /closed/);
});
