import { describe, expect, it } from "vitest";
import { buildCfg } from "../src/tools/install-cfg.js";

describe("install-cfg", () => {
  it("writes uri and token into the cfg", () => {
    const cfg = buildCfg("http://127.0.0.1:3001/gsi", "abc");
    expect(cfg).toContain('"uri"       "http://127.0.0.1:3001/gsi"');
    expect(cfg).toContain('"token" "abc"');
    expect(cfg).toContain('"abilities"     "1"');
  });
});
