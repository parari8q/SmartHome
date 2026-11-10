import { test } from "node:test";
import assert from "node:assert/strict";
import { ntfySubscribeLink, detectPlatform } from "../../js/notify.js";

test("rozpoznanie urzadzenia", () => {
  assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130"), "android");
  assert.equal(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"), "desktop");
});

test("Android: intent:// z pakietem ntfy i sklepem Play jako zapasem", () => {
  const l = ntfySubscribeLink("dashboard-abc", "android");
  assert.equal(l, "intent://ntfy.sh/dashboard-abc?display=Dashboard%20domowy#Intent;scheme=ntfy;package=io.heckel.ntfy;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dio.heckel.ntfy;end");
  assert.equal(ntfySubscribeLink("dashboard-abc", "desktop"), "ntfy://ntfy.sh/dashboard-abc?display=Dashboard%20domowy");
});
