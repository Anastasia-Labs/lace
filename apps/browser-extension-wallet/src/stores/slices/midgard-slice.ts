import { SliceCreator } from '../types';

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

  setMidgardMode: (enabled: boolean) => {
    set({ isMidgardEnabled: enabled });
    // Sync to storage
    localStorage.setItem(MIDGARD_KEY, JSON.stringify(enabled));
  }
});
