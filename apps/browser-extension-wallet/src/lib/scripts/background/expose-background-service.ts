import { reloadActiveWalletInBackground, setMidgardModeAndReloadInBackground, wallet$ } from './wallet';
import { exposeBackgroundService } from './services/utilityServices';

exposeBackgroundService({
  wallet$,
  reloadWallet: reloadActiveWalletInBackground,
  setMidgardModeAndReload: setMidgardModeAndReloadInBackground
});
