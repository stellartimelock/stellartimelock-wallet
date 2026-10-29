// Web storage (Metro picks index.ts on native).
// Helpers never throw: reads return `fallback`, writes return `false`.
// Values supported: string | number | boolean | null (JSON-serialized on disk).
// Usage: import { storage } from "@/src/utils/storage"; await storage.getItem(key, fallback);
// No Keychain on web — secure* helpers reuse AsyncStorage (no expo-secure-store).

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  AssertNoExtras,
  AuthenticatedReadResult,
  StorageBase,
  StorageItemValue,
} from "./storage-base";

export class Storage extends StorageBase {
  // General KV — backed by AsyncStorage (its built-in web shim uses IndexedDB).
  async getItem<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return this.retrieve(raw, fallback);
    } catch (e) {
      this.warn("getItem", key, e);
      return fallback;
    }
  }

  async setItem<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.warn("setItem", key, e);
      return false;
    }
  }

  async removeItem(key: string): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch (e) {
      this.warn("removeItem", key, e);
      return false;
    }
  }

  // Browsers have no Keychain — secure* helpers fall through to AsyncStorage.
  async secureGet<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null> {
    return this.getItem(key, fallback);
  }

  async secureSet<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean> {
    return this.setItem(key, value);
  }

  async secureRemove(key: string): Promise<boolean> {
    return this.removeItem(key);
  }

  async secureGetAuthenticated<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
    promptMessage: string,
  ): Promise<Fallback | null> {
    const read = await this.secureReadAuthenticated(key, fallback, promptMessage);
    return read.value ?? fallback;
  }

  async secureReadAuthenticated<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
    _promptMessage: string,
  ): Promise<AuthenticatedReadResult<Fallback>> {
    void _promptMessage;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw === null) return { promptSucceeded: true, value: null };
      return { promptSucceeded: true, value: this.retrieve(raw, fallback) };
    } catch (e) {
      this.warn("secureReadAuthenticated", key, e);
      return { promptSucceeded: false, value: null };
    }
  }

  async secureSetAuthenticated<Value extends StorageItemValue>(
    key: string,
    value: Value,
    _promptMessage: string,
  ): Promise<boolean> {
    void _promptMessage;
    return this.setItem(key, value);
  }
}

export const storage = new Storage();

// Compile-time guard: any new method must be declared in storage-base.ts first.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional compile-time-only assertion
type _NoExtras = AssertNoExtras<Exclude<keyof Storage, keyof StorageBase>>;
