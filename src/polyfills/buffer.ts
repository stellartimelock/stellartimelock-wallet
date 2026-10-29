// Buffer polyfill for React Native — `@stellar/stellar-sdk` requires global `Buffer`.

import { Buffer as NodeBuffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof NodeBuffer };
if (!g.Buffer) {
  g.Buffer = NodeBuffer;
}

export {};
