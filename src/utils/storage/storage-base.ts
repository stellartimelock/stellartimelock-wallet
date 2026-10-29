// Abstract base for the storage wrapper — shared types + helpers.
// Concrete implementations live in index.ts (native) and index.web.ts (web).

export type StorageItemKey = string;
/**
 * JSON-serializable values accepted by `storage.getItem` / `setItem`.
 *
 * The runtime layer always passes values through `JSON.stringify` on write
 * and `JSON.parse` on read, so any plain JSON-shaped value works — including
 * objects and arrays for richer cached payloads (e.g. cached vault state,
 * event archives).
 *
 * The type is intentionally permissive: anything that isn't `undefined`,
 * a function, or a symbol is accepted. We rely on JSON.stringify to filter
 * out anything that wouldn't round-trip at runtime, in exchange for letting
 * call sites pass typed interfaces (e.g. `VaultMeta`, cached vault
 * snapshots) without per-call casts — TypeScript can't structurally prove
 * that an arbitrary interface satisfies a recursive `Json`-shaped union, so
 * a narrower constraint would force casts at every storage boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: see doc comment
export type StorageItemValue = string | number | boolean | null | object | readonly any[];

// Helper for subclasses to enforce that they don't declare methods beyond
// StorageBase. Use as: type _ = AssertNoExtras<Exclude<keyof Storage, keyof StorageBase>>;
export type AssertNoExtras<T extends never> = T;

/** Result of a biometric-gated SecureStore read. `promptSucceeded` is false when the user cancels. */
export type AuthenticatedReadResult<T> = {
  promptSucceeded: boolean;
  value: T | null;
};

export abstract class StorageBase {
  protected warn(op: string, key: StorageItemKey, e: unknown) {
    console.warn(`[storage] ${op}(${key}) failed`, e);
  }

  // raw is whatever AsyncStorage / SecureStore returned: a JSON-encoded string
  // (because setItem always JSON.stringifies) or null if the key was missing.
  // We always JSON.parse so values round-trip correctly across types.
  protected retrieve<Fallback extends StorageItemValue>(
    raw: string | null,
    fallback: Fallback,
  ): Fallback | null {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as Fallback;
    } catch (e) {
      this.warn("retrieve", "parse error", e);
      return fallback;
    }
  }

  abstract getItem<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null>;
  abstract setItem<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean>;
  abstract removeItem(key: string): Promise<boolean>;
  abstract secureGet<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null>;
  abstract secureSet<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean>;
  abstract secureRemove(key: string): Promise<boolean>;
  abstract secureGetAuthenticated<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
    promptMessage: string,
  ): Promise<Fallback | null>;
  abstract secureReadAuthenticated<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
    promptMessage: string,
  ): Promise<AuthenticatedReadResult<Fallback>>;
  abstract secureSetAuthenticated<Value extends StorageItemValue>(
    key: string,
    value: Value,
    promptMessage: string,
  ): Promise<boolean>;
}
