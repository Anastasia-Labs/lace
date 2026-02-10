import { SliceCreator } from '../types';
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

export interface MidgardSlice {
  isMidgardEnabled: boolean;
  setMidgardMode: (enabled: boolean) => void;
}

export const midgardSlice: SliceCreator<MidgardSlice, MidgardSlice> = ({ set }) => ({
  isMidgardEnabled: getInitialMidgardState(), // Initialize from storage

  setMidgardMode: async (enabled: boolean) => {
    console.log('🔍 Debug: setMidgardMode called with:', enabled);
    set({ isMidgardEnabled: enabled });
    
    // Sync to both storage systems
    localStorage.setItem(MIDGARD_KEY, JSON.stringify(enabled));
    console.log('🔍 Debug: Saved to localStorage:', enabled);
    
    // Also save to extension storage for background script
    try {
      await storage.local.set({ [MIDGARD_KEY]: enabled });
      console.log('🔍 Debug: Saved to extension storage:', enabled);
      
      // Verify it was saved
      const verify = await storage.local.get(MIDGARD_KEY);
      console.log('🔍 Debug: Verification - extension storage now contains:', verify);
    } catch (error) {
      console.warn('Failed to save Midgard state to extension storage:', error);
    }
  }
});
