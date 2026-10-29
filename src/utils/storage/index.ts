// Native storage (Metro picks index.web.ts on web).
// Helpers never throw: reads return `fallback`, writes return `false`.
// Values supported: string | number | boolean | null (JSON-serialized on disk).
// Usage: import { storage } from "@/src/utils/storage"; await storage.getItem(key, fallback);

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  AssertNoExtras,
  AuthenticatedReadResult,
  StorageBase,
  StorageItemValue,
} from "./storage-base";

export class Storage extends StorageBase {
  // General KV — backed by AsyncStorage.
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

  // Sensitive values — Keychain (iOS) / EncryptedSharedPreferences (Android).
  async secureGet<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null> {
    try {
      const raw = await SecureStore.getItemAsync(key);
      return this.retrieve(raw, fallback);
    } catch (e) {
      this.warn("secureGet", key, e);
      return fallback;
    }
  }

  async secureSet<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.warn("secureSet", key, e);
      return false;
    }
  }

  async secureRemove(key: string): Promise<boolean> {
    try {
      await SecureStore.deleteItemAsync(key);
      return true;
    } catch (e) {
      this.warn("secureRemove", key, e);
      return false;
    }
  }

  async secureSetAuthenticated<Value extends StorageItemValue>(
    key: string,
    value: Value,
    promptMessage: string,
  ): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(key, JSON.stringify(value), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        requireAuthentication: true,
        authenticationPrompt: promptMessage,
      });
      return true;
    } catch (e) {
      this.warn("secureSetAuthenticated", key, e);
      return false;
    }
  }

  async secureGetAuthenticated<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
    promptMessage: string,
  ): Promise<Fallback | null> {
    const read = await this.secureReadAuthenticated(key, fallback, promptMessage);
    if (!read.promptSucceeded || read.value === null) return fallback;
    return read.value;
  }

  async secureReadAuthenticated<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
    promptMessage: string,
  ): Promise<AuthenticatedReadResult<Fallback>> {
    try {
      const raw = await SecureStore.getItemAsync(key, {
        requireAuthentication: true,
        authenticationPrompt: promptMessage,
      });
      if (raw === null) return { promptSucceeded: true, value: null };
      const value = this.retrieve(raw, fallback);
      return { promptSucceeded: true, value };
    } catch (e) {
      this.warn("secureReadAuthenticated", key, e);
      return { promptSucceeded: false, value: null };
    }
  }
}

export const storage = new Storage();

// Compile-time guard: any new method must be declared in storage-base.ts first.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional compile-time-only assertion
type _NoExtras = AssertNoExtras<Exclude<keyof Storage, keyof StorageBase>>;
