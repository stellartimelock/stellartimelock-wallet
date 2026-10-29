import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SWAP_ROUTE_PROVIDER,
  amountWithinRange,
  networkForTicker,
  parseProviderDestinations,
  selectSwapRoute,
} from "../src/swap/routes.ts";

const SOL_DESTINATIONS = [
  "btc:btc",
  "eth:eth",
  "xlm:xlm",
  "usdt:eth",
  "usdt:trx",
  "ltc:ltc",
];

const XLM_DESTINATIONS = ["sol:sol", "btc:btc", "eth:eth", "usdt:eth", "doge:doge"];

const BTC_DESTINATIONS = ["eth:eth", "xlm:xlm", "sol:sol", "usdt:eth"];

describe("swap route selection", () => {
  it("keeps SOL → XLM on a direct SimpleSwap route", () => {
    const selected = selectSwapRoute({
      fromTicker: "SOL",
      toTicker: "xlm",
      fromNetwork: "sol",
      toNetwork: "xlm",
      destinations: SOL_DESTINATIONS,
      displayFrom: "sol",
      displayTo: "xlm",
    });
    assert.equal(selected.ok, true);
    if (!selected.ok) return;
    assert.equal(selected.route.provider, SWAP_ROUTE_PROVIDER);
    assert.equal(selected.route.provider, "simpleswap");
    assert.equal(selected.route.kind, "direct");
    assert.equal(selected.route.fromTicker, "sol");
    assert.equal(selected.route.fromNetwork, "sol");
    assert.equal(selected.route.toTicker, "xlm");
    assert.equal(selected.route.toNetwork, "xlm");
    assert.equal(selected.route.destinationKey, "xlm:xlm");
  });

  it("selects XLM → any and any → any when the provider lists the pair", () => {
    const xlmToSol = selectSwapRoute({
      fromTicker: "xlm",
      toTicker: "sol",
      fromNetwork: "xlm",
      toNetwork: "sol",
      destinations: XLM_DESTINATIONS,
    });
    const btcToEth = selectSwapRoute({
      fromTicker: "btc",
      toTicker: "eth",
      fromNetwork: "btc",
      toNetwork: "eth",
      destinations: BTC_DESTINATIONS,
    });
    assert.equal(xlmToSol.ok, true);
    assert.equal(btcToEth.ok, true);
    if (!xlmToSol.ok || !btcToEth.ok) return;
    assert.equal(xlmToSol.route.provider, "simpleswap");
    assert.equal(xlmToSol.route.kind, "direct");
    assert.equal(btcToEth.route.kind, "direct");
    assert.equal(btcToEth.route.destinationKey, "eth:eth");
  });

  it("rejects an unsupported pair instead of bridging through another asset", () => {
    // BTC can reach XLM, and XLM can reach DOGE, but BTC cannot reach DOGE
    // directly. The selector must not invent that second hop.
    const selected = selectSwapRoute({
      fromTicker: "btc",
      toTicker: "doge",
      fromNetwork: "btc",
      toNetwork: "doge",
      destinations: BTC_DESTINATIONS,
      displayFrom: "btc",
      displayTo: "doge",
    });
    assert.equal(selected.ok, false);
    if (selected.ok) return;
    assert.equal(selected.code, "unsupported_pair");
    assert.match(selected.message, /BTC → DOGE/);
    assert.match(selected.message, /not available/);
  });

  it("rejects the same currency and an incomplete pair", () => {
    const same = selectSwapRoute({
      fromTicker: "xlm",
      toTicker: "XLM",
      fromNetwork: "xlm",
      toNetwork: "xlm",
      destinations: XLM_DESTINATIONS,
    });
    assert.equal(same.ok, false);
    if (!same.ok) assert.equal(same.code, "same_currency");

    const blank = selectSwapRoute({
      fromTicker: "  ",
      toTicker: "sol",
      fromNetwork: "xlm",
      toNetwork: "sol",
      destinations: XLM_DESTINATIONS,
    });
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.code, "incomplete");
  });

  it("uses the preferred network and ignores a same ticker on another chain", () => {
    assert.equal(networkForTicker("usdt"), "eth");
    assert.equal(networkForTicker("sol"), "sol");

    const erc20 = selectSwapRoute({
      fromTicker: "xlm",
      toTicker: "usdt",
      fromNetwork: "xlm",
      toNetwork: networkForTicker("usdt"),
      destinations: XLM_DESTINATIONS,
      displayFrom: "xlm",
      displayTo: "usdt",
    });
    assert.equal(erc20.ok, true);
    if (erc20.ok) assert.equal(erc20.route.destinationKey, "usdt:eth");

    const tronOnly = selectSwapRoute({
      fromTicker: "btc",
      toTicker: "usdt",
      fromNetwork: "btc",
      toNetwork: "eth",
      destinations: ["usdt:trx"],
      displayFrom: "btc",
      displayTo: "usdt",
    });
    assert.equal(tronOnly.ok, false);
    if (!tronOnly.ok) {
      assert.equal(tronOnly.code, "unsupported_pair");
      assert.match(tronOnly.message, /USDT · ETH/);
    }
  });

  it("parses the filtered pairs payload without treating it as a full mesh", () => {
    const parsed = parseProviderDestinations(
      {
        result: {
          "sol:sol": ["xlm:xlm", "btc:btc", "xlm:xlm"],
        },
      },
      "sol:sol",
    );
    assert.deepEqual(parsed, ["xlm:xlm", "btc:btc"]);

    const selected = selectSwapRoute({
      fromTicker: "sol",
      toTicker: "xlm",
      fromNetwork: "sol",
      toNetwork: "xlm",
      destinations: parsed,
    });
    assert.equal(selected.ok, true);
  });

  it("still sends every route through SimpleSwap via the swap proxy", () => {
    const client = readFileSync("src/swap/simpleswap-client.ts", "utf8");
    const screen = readFileSync("app/swap.tsx", "utf8");
    assert.match(client, /swapProxyBaseUrl\(\)/);
    assert.match(client, /fetchSwapSourceRoutes/);
    assert.match(client, /fetchSwapRange/);
    assert.match(client, /fixed: params\.fixed \?\? true/);
    assert.doesNotMatch(client, /feePercent|customFee|affiliateFee/);
    assert.match(screen, /fetchSwapCreate\(/);
    assert.match(screen, /fetchSwapEstimate\(/);
    assert.doesNotMatch(screen, /changenow|changelly|sideshift/i);
  });

  it("flags amounts outside the provider minimum and maximum", () => {
    assert.deepEqual(amountWithinRange(0.01, "0.076415779", "335.8"), {
      belowMinimum: true,
      aboveMaximum: false,
    });
    assert.deepEqual(amountWithinRange(1, "0.076415779", "335.8"), {
      belowMinimum: false,
      aboveMaximum: false,
    });
    assert.deepEqual(amountWithinRange(400, "0.07", "335.8"), {
      belowMinimum: false,
      aboveMaximum: true,
    });
    assert.deepEqual(amountWithinRange(1, null, null), {
      belowMinimum: false,
      aboveMaximum: false,
    });
  });
});
