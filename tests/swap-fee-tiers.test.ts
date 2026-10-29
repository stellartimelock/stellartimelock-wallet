import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FEE_TIERS,
  HEAVY_COINS,
  UTILITY_COINS,
  UTILITY_DESTINATION_COINS,
  coinFeeTier,
  describeSwapFee,
  selectFeeTier,
} from "../src/swap/fee-tier-config.ts";
// @ts-ignore plain JS Worker module
import { selectTier as proxySelectTier } from "../proxy/swap-worker.js";

describe("swap fee tier selection", () => {
  it("classifies the utility and heavy lists and treats everything else as meme", () => {
    for (const coin of UTILITY_COINS) {
      assert.equal(coinFeeTier(coin), "utility", coin);
    }
    for (const coin of HEAVY_COINS) {
      assert.equal(coinFeeTier(coin), "heavy", coin);
    }
    for (const coin of [
      "ada",
      "hbar",
      "nano",
      "xno",
      "iota",
      "pol",
      "matic",
      "avax",
      "avaxc",
      "dot",
      "atom",
      "near",
      "ton",
      "link",
    ]) {
      assert.equal(coinFeeTier(coin), "utility", coin);
    }
    for (const coin of ["eth", "bnb", "bnb-bsc", "BTC"]) {
      assert.equal(coinFeeTier(coin), "heavy", coin);
    }
    assert.equal(coinFeeTier("shib"), "meme");
    assert.equal(coinFeeTier("pepe"), "meme");
    assert.deepEqual(
      [...UTILITY_COINS].filter((coin) =>
        (HEAVY_COINS as readonly string[]).includes(coin),
      ),
      [],
    );
  });

  it("uses the published percents", () => {
    assert.equal(FEE_TIERS.utility.feePercent, 0.4);
    assert.equal(FEE_TIERS.heavy.feePercent, 1);
    assert.equal(FEE_TIERS.meme.feePercent, 1.4);
    assert.equal(FEE_TIERS.heavy.note, "Bitcoin tax");
  });

  it("forces utility when the destination is XLM or USDC", () => {
    assert.deepEqual([...UTILITY_DESTINATION_COINS], ["xlm", "usdc"]);
    for (const source of ["btc", "doge", "eth", "shib", "sol", "bsv"]) {
      assert.equal(selectFeeTier(source, "xlm"), "utility", source);
      assert.equal(selectFeeTier(source, "USDC"), "utility", source);
    }
    assert.equal(selectFeeTier("btc", "usdc:eth"), "utility");
    assert.equal(selectFeeTier("ETH", " xlm:xlm "), "utility");
  });

  it("does not treat other utility coins as a destination override", () => {
    assert.equal(selectFeeTier("btc", "usdt"), "heavy");
    assert.equal(selectFeeTier("btc", "sol"), "heavy");
    assert.equal(selectFeeTier("eth", "usdt"), "heavy");
    assert.equal(selectFeeTier("shib", "xrp"), "meme");
  });

  it("picks the higher tier of the two coins when the destination is not XLM or USDC", () => {
    assert.equal(selectFeeTier("xlm", "sol"), "utility");
    assert.equal(selectFeeTier("algo", "ltc"), "utility");
    assert.equal(selectFeeTier("sol", "btc"), "heavy");
    assert.equal(selectFeeTier("btc", "doge"), "heavy");
    assert.equal(selectFeeTier("bch", "bsv"), "heavy");
    assert.equal(selectFeeTier("ada", "hbar"), "utility");
    assert.equal(selectFeeTier("sol", "eth"), "heavy");
    assert.equal(selectFeeTier("eth", "btc"), "heavy");
    assert.equal(selectFeeTier("ada", "bnb"), "heavy");
    assert.equal(selectFeeTier("link", "bnb-bsc"), "heavy");
    assert.equal(selectFeeTier("btc", "shib"), "meme");
    assert.equal(selectFeeTier("pepe", "shib"), "meme");
    assert.equal(selectFeeTier("ada", "pepe"), "meme");
    assert.equal(describeSwapFee("eth", "btc").label, "Heavy");
    assert.equal(describeSwapFee("ada", "sol").feePercent, 0.4);
    assert.equal(describeSwapFee("btc", "xlm").feePercent, 0.4);
    assert.equal(describeSwapFee("doge", "sol").feePercent, 1);
  });

  it("the swap proxy picks the same tier as the app for every listed pair", () => {
    const coins = [...UTILITY_COINS, ...HEAVY_COINS, "shib", "pepe", "usdt:trx"];
    for (const from of coins) {
      for (const to of coins) {
        assert.equal(proxySelectTier(from, to), selectFeeTier(from, to), `${from}->${to}`);
      }
    }
    const worker = readFileSync("proxy/swap-worker.js", "utf8");
    for (const coin of [...UTILITY_COINS, ...HEAVY_COINS, ...UTILITY_DESTINATION_COINS]) {
      assert.match(worker, new RegExp(`"${coin}"`), coin);
    }
  });

  it("keeps every partner key out of the app; the client calls the proxy with no key header", () => {
    const client = readFileSync("src/swap/simpleswap-client.ts", "utf8");
    const config = readFileSync("src/swap/fee-tier-config.ts", "utf8");
    const proxyCfg = readFileSync("src/swap/proxy-config.ts", "utf8");
    assert.doesNotMatch(client, /x-api-key/i);
    assert.doesNotMatch(client, /api\.simpleswap\.io/);
    assert.match(client, /swapProxyBaseUrl\(\)/);
    assert.match(proxyCfg, /stl-swap-proxy\.stellartimelock\.workers\.dev\/v3/);
    for (const src of [client, config, proxyCfg]) {
      assert.doesNotMatch(src, /EXPO_PUBLIC_SIMPLESWAP_API_KEY/);
    }
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assert.doesNotMatch(client, uuid);
    assert.doesNotMatch(config, uuid);
    assert.doesNotMatch(readFileSync("proxy/swap-worker.js", "utf8"), uuid);
  });
});
