/* eslint-disable no-magic-numbers */
import { Cardano, Serialization } from '@cardano-sdk/core';
import {
  assembleMidgardSignedTx,
  computeMidgardNativeTxId,
  createMidgardNativeTxDraft,
  serializeUnsignedCardanoPreviewTx
} from '../native-signing';

const ADDRESS_A = Cardano.PaymentAddress(
  'addr_test1qpeg0n942wz3kx7vhmcgwa9t58r9spp4x2x32vfllm4ddkj2he0ldswjwtvp7drsjqmyzugmjhmypdhu3vez5rkkuj5s74q4yw'
);
const SCRIPT_WITHDRAWAL = {
  quantity: 0n,
  stakeAddress: Cardano.RewardAccount.fromCredential(
    {
      hash: '66'.repeat(28) as Cardano.Credential['hash'],
      type: Cardano.CredentialType.ScriptHash
    },
    0
  )
};

const createPreviewBody = (): Cardano.TxBody => ({
  fee: 170_000n,
  inputs: [
    {
      index: 0,
      txId: Cardano.TransactionId('11'.repeat(32))
    }
  ],
  networkId: 0 as Cardano.NetworkId,
  outputs: [
    {
      address: ADDRESS_A,
      value: { coins: 3_000_000n }
    }
  ],
  referenceInputs: [
    {
      index: 1,
      txId: Cardano.TransactionId('22'.repeat(32))
    }
  ],
  validityInterval: {
    invalidHereafter: Cardano.Slot(100),
    invalidBefore: Cardano.Slot(10)
  }
});

describe('midgard native signing', () => {
  test('serializes the reviewed unsigned Cardano preview deterministically', () => {
    const body = createPreviewBody();

    expect(serializeUnsignedCardanoPreviewTx({ body })).toEqual(
      new Serialization.Transaction(
        Serialization.TransactionBody.fromCore(body),
        Serialization.TransactionWitnessSet.fromCore({ signatures: new Map() }),
        undefined
      ).toCbor()
    );
  });

  test('materializes a native draft and computes a stable Midgard tx id', () => {
    const draft = createMidgardNativeTxDraft({ body: createPreviewBody() });
    const signed = assembleMidgardSignedTx(draft, [{ publicKey: '33'.repeat(32), signature: '44'.repeat(64) }]);

    expect(draft.signingHash).toBe(draft.tx.compact.transactionBodyHash.toString('hex'));
    expect(signed.txId).toBe(computeMidgardNativeTxId(signed.tx));
    expect(signed.signingHash).toBe(draft.signingHash);
    expect(signed.tx.compact.transactionWitnessSetHash.toString('hex')).not.toEqual(
      draft.tx.compact.transactionWitnessSetHash.toString('hex')
    );
  });

  test('assembles native address witnesses as encoded vkey witness byte strings', () => {
    const draft = createMidgardNativeTxDraft({ body: createPreviewBody() });
    const witness = {
      publicKey: '33'.repeat(32),
      signature: '44'.repeat(64)
    };
    const signed = assembleMidgardSignedTx(draft, [witness]);

    const reader = new Serialization.CborReader(signed.cbor);
    expect(reader.readStartArray()).toBe(4);
    expect(reader.readInt()).toBe(1n);
    reader.readEncodedValue();
    reader.readEncodedValue();
    const witnessSetBytes = Buffer.from(reader.readEncodedValue());

    const witnessReader = new Serialization.CborReader(witnessSetBytes.toString('hex'));
    expect(witnessReader.readStartArray()).toBe(8);
    witnessReader.readByteString();
    const addrWitnessPreimage = Buffer.from(witnessReader.readByteString());
    const addrWitnessReader = new Serialization.CborReader(addrWitnessPreimage.toString('hex'));
    expect(addrWitnessReader.readStartArray()).toBe(1);

    const encodedWitness = Buffer.from(addrWitnessReader.readByteString()).toString('hex');
    expect(encodedWitness).toBe(Serialization.VkeyWitness.fromCore([witness.publicKey, witness.signature]).toCbor());
  });

  test('preserves zero-ADA script withdrawals and script integrity hashes', () => {
    const scriptIntegrityHash = '99'.repeat(32) as NonNullable<Cardano.TxBody['scriptIntegrityHash']>;
    const draft = createMidgardNativeTxDraft({
      body: {
        ...createPreviewBody(),
        scriptIntegrityHash,
        withdrawals: [SCRIPT_WITHDRAWAL]
      }
    });

    const observersReader = new Serialization.CborReader(draft.tx.body.requiredObserversPreimageCbor.toString('hex'));
    expect(observersReader.readStartArray()).toBe(1);
    expect(Buffer.from(observersReader.readByteString()).toString('hex')).toBe('66'.repeat(28));
    observersReader.readEndArray();
    expect(draft.tx.body.scriptIntegrityHash.toString('hex')).toBe(scriptIntegrityHash);
  });

  test('rejects unsupported Cardano preview features in phase 1', () => {
    expect(() =>
      createMidgardNativeTxDraft({
        auxiliaryData: {} as Cardano.AuxiliaryData,
        body: createPreviewBody()
      })
    ).toThrow('auxiliary data');

    expect(() =>
      createMidgardNativeTxDraft({
        body: {
          ...createPreviewBody(),
          certificates: [
            {
              __typename: Cardano.CertificateType.Registration,
              deposit: 2_000_000n,
              stakeCredential: {
                hash: '55'.repeat(28) as Cardano.Credential['hash'],
                type: Cardano.CredentialType.KeyHash
              }
            }
          ]
        }
      })
    ).toThrow('certificates');
  });

  test('rejects non-zero or non-script withdrawals in phase 1', () => {
    expect(() =>
      createMidgardNativeTxDraft({
        body: {
          ...createPreviewBody(),
          withdrawals: [{ ...SCRIPT_WITHDRAWAL, quantity: 1n }]
        }
      })
    ).toThrow('zero-ADA script withdrawals');

    expect(() =>
      createMidgardNativeTxDraft({
        body: {
          ...createPreviewBody(),
          withdrawals: [
            {
              quantity: 0n,
              stakeAddress: Cardano.RewardAccount.fromCredential(
                {
                  hash: '77'.repeat(28) as Cardano.Credential['hash'],
                  type: Cardano.CredentialType.KeyHash
                },
                0
              )
            }
          ]
        }
      })
    ).toThrow('script withdrawals');
  });
});
