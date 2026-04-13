import { Wallet } from '@lace/cardano';

const MIDGARD_SUPPORTED_CHAINS: ReadonlyArray<Wallet.ChainName> = ['Mainnet', 'Preprod'];

type MidgardLayer1PolicyIds = typeof Wallet.MIDGARD_LAYER1_POLICY_IDS;

export const isMidgardSupportedChain = (
  chainName?: Wallet.ChainName
): chainName is typeof MIDGARD_SUPPORTED_CHAINS[number] =>
  !!chainName && MIDGARD_SUPPORTED_CHAINS.includes(chainName as typeof MIDGARD_SUPPORTED_CHAINS[number]);

export const getMidgardLayer1PolicyIds = (chainName?: Wallet.ChainName): MidgardLayer1PolicyIds | undefined =>
  isMidgardSupportedChain(chainName) ? Wallet.MIDGARD_LAYER1_POLICY_IDS : undefined;
