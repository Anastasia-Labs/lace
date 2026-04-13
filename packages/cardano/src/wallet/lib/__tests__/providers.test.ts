import { isUsingMidgardProviders } from '../providers';
import { MidgardTxSubmitProvider } from '../midgard/tx-submit-provider';
import { MidgardUtxoProvider } from '../midgard/utxo-provider';

describe('isUsingMidgardProviders', () => {
  test('returns true when both tx submit and utxo providers are Midgard-backed', () => {
    const providers = {
      txSubmitProvider: Object.create(MidgardTxSubmitProvider.prototype),
      utxoProvider: Object.create(MidgardUtxoProvider.prototype)
    } as Parameters<typeof isUsingMidgardProviders>[0];

    expect(isUsingMidgardProviders(providers)).toBe(true);
  });

  test('returns false when one of the providers is not Midgard-backed', () => {
    const providers = {
      txSubmitProvider: Object.create(MidgardTxSubmitProvider.prototype),
      utxoProvider: {}
    } as Parameters<typeof isUsingMidgardProviders>[0];

    expect(isUsingMidgardProviders(providers)).toBe(false);
  });
});
