import { WalletStore, SliceCreator } from '../types';
import { storage } from 'webextension-polyfill';

const MIDGARD_KEY = 'midgardEnabled';

// Helper to get initial state from storage
const getInitialMidgardState = (): boolean => {
  try {
    const stored = localStorage.getItem(MIDGARD_KEY);
    return stored ? JSON.parse(stored) : false;
  } catch {
    return false;
  }
};

export interface MidgardProviderSlice {
  isMidgardEnabled: boolean;
  setMidgardMode: (enabled: boolean) => void;
}

export const midgardProviderSlice: SliceCreator<WalletStore, MidgardProviderSlice> = ({ set }) => ({
  isMidgardEnabled: getInitialMidgardState(),

  setMidgardMode: async (enabled: boolean) => {
    set({ isMidgardEnabled: enabled });

    localStorage.setItem(MIDGARD_KEY, JSON.stringify(enabled));

    try {
      await storage.local.set({ [MIDGARD_KEY]: enabled });
    } catch (error) {
      console.warn('Failed to save Midgard state to extension storage:', error);
    }
  }
});
