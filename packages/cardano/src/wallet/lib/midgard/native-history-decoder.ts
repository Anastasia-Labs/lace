/* eslint-disable consistent-return, max-statements */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { MidgardTxProvenance, withMidgardTxProvenance } from './provenance';

const MIDGARD_NATIVE_TX_VERSION_V1 = 1n;
const MIDGARD_NATIVE_TX_VERSION_V2 = 2n;
const MIDGARD_POSIX_TIME_NONE = -1n;
const MIDGARD_NATIVE_NETWORK_ID_NONE = 255n;
const MIDGARD_UNSIGNED_ZERO = 0n;
const MIDGARD_FULL_ARRAY_LENGTH = 4;
const MIDGARD_COMPACT_ARRAY_LENGTH = 4;
const MIDGARD_BODY_ARRAY_LENGTH = 18;
const MIDGARD_WITNESS_ARRAY_LENGTH = 8;
const MIDGARD_REQUIRED_OBSERVER_LENGTH = 28;
const MIDGARD_REQUIRED_SIGNER_LENGTH = 28;
const ZERO_BLOCK_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
type MidgardRequiredExtraSignature = NonNullable<Cardano.HydratedTxBody['requiredExtraSignatures']>[number];

const readStartArray = (reader: Serialization.CborReader, expectedLength: number, fieldName: string): void => {
  const length = reader.readStartArray();

  if (length !== expectedLength) {
    throw new Error(`${fieldName} must have exactly ${expectedLength} elements`);
  }
};

const readUnsignedInt = (reader: Serialization.CborReader, fieldName: string): bigint => {
  const value = reader.readInt();

  if (value < MIDGARD_UNSIGNED_ZERO) throw new Error(`${fieldName} must be unsigned`);

  return value;
};

const readSignedInt = (reader: Serialization.CborReader): bigint => reader.readInt();

const readVersion = (reader: Serialization.CborReader, fieldName: string): bigint => {
  const version = readUnsignedInt(reader, fieldName);

  if (version !== MIDGARD_NATIVE_TX_VERSION_V1 && version !== MIDGARD_NATIVE_TX_VERSION_V2) {
    throw new Error(`Unsupported Midgard native tx version in ${fieldName}`);
  }

  return version;
};

const decodeMidgardNativeByteListPreimage = (preimageCbor: Uint8Array): Buffer[] => {
  const reader = new Serialization.CborReader(Buffer.from(preimageCbor).toString('hex'));
  const items: Buffer[] = [];

  reader.readStartArray();
  while (reader.peekState() !== Serialization.CborReaderState.EndArray) {
    items.push(Buffer.from(reader.readByteString()));
  }
  reader.readEndArray();

  return items;
};

const decodeNativeInputs = (preimageCbor: Uint8Array): Cardano.TxIn[] =>
  decodeMidgardNativeByteListPreimage(preimageCbor).map((inputBytes) =>
    Serialization.TransactionInput.fromCbor(inputBytes).toCore()
  );

const decodeNativeOutputs = (preimageCbor: Uint8Array): Cardano.TxOut[] =>
  decodeMidgardNativeByteListPreimage(preimageCbor).map((outputBytes) =>
    Serialization.TransactionOutput.fromCbor(outputBytes).toCore()
  );

const decodeRequiredSigners = (preimageCbor: Uint8Array): Cardano.HydratedTxBody['requiredExtraSignatures'] => {
  const signerBytes = decodeMidgardNativeByteListPreimage(preimageCbor);
  if (signerBytes.length === 0) return undefined;

  return signerBytes.map((signer, index) => {
    if (signer.length !== MIDGARD_REQUIRED_SIGNER_LENGTH) {
      throw new Error(`midgard.required_signers[${index}] must be ${MIDGARD_REQUIRED_SIGNER_LENGTH} bytes`);
    }

    return signer.toString('hex') as MidgardRequiredExtraSignature;
  });
};

const decodeRequiredObservers = (
  preimageCbor: Uint8Array,
  networkId: Cardano.NetworkId | undefined
): Cardano.HydratedTxBody['withdrawals'] => {
  const observerBytes = decodeMidgardNativeByteListPreimage(preimageCbor);
  if (observerBytes.length === 0) return undefined;
  if (networkId === undefined) {
    throw new Error('midgard.required_observers require an explicit network id');
  }

  return observerBytes.map((observer, index) => {
    if (observer.length !== MIDGARD_REQUIRED_OBSERVER_LENGTH) {
      throw new Error(`midgard.required_observers[${index}] must be ${MIDGARD_REQUIRED_OBSERVER_LENGTH} bytes`);
    }

    return {
      quantity: 0n,
      stakeAddress: Cardano.RewardAccount.fromCredential(
        {
          hash: observer.toString('hex') as Cardano.Credential['hash'],
          type: Cardano.CredentialType.ScriptHash
        },
        networkId
      )
    };
  });
};

const decodeMint = (preimageCbor: Uint8Array): Cardano.TokenMap | undefined => {
  const reader = new Serialization.CborReader(Buffer.from(preimageCbor).toString('hex'));
  const state = reader.peekState();

  if (state === Serialization.CborReaderState.StartArray) {
    const length = reader.readStartArray();

    if (length !== 0) throw new Error('midgard.mint must be an empty array or a CBOR map');

    reader.readEndArray();
    return undefined;
  }

  if (state !== Serialization.CborReaderState.StartMap) {
    throw new Error('midgard.mint must be an empty array or a CBOR map');
  }

  const mint = new Map<Cardano.AssetId, bigint>();
  reader.readStartMap();
  while (reader.peekState() !== Serialization.CborReaderState.EndMap) {
    const policyId = Cardano.PolicyId(Buffer.from(reader.readByteString()).toString('hex'));

    reader.readStartMap();
    while (reader.peekState() !== Serialization.CborReaderState.EndMap) {
      const assetName = Cardano.AssetName(Buffer.from(reader.readByteString()).toString('hex'));
      const quantity = reader.readInt();

      mint.set(Cardano.AssetId.fromParts(policyId, assetName), quantity);
    }
    reader.readEndMap();
  }
  reader.readEndMap();

  return mint.size > 0 ? mint : undefined;
};

const decodeNetworkId = (value: bigint): Cardano.NetworkId | undefined => {
  if (value === MIDGARD_NATIVE_NETWORK_ID_NONE) return undefined;

  return Number(value) as Cardano.NetworkId;
};

const decodeValidityInterval = (start: bigint, end: bigint): Cardano.ValidityInterval | undefined => {
  const validityInterval: Cardano.ValidityInterval = {};

  if (start !== MIDGARD_POSIX_TIME_NONE) {
    validityInterval.invalidBefore = Cardano.Slot(Number(start));
  }
  if (end !== MIDGARD_POSIX_TIME_NONE) {
    validityInterval.invalidHereafter = Cardano.Slot(Number(end));
  }

  return Object.keys(validityInterval).length > 0 ? validityInterval : undefined;
};

const parseMidgardBody = (
  bodyBytes: Buffer
): {
  decodedOutputsPreimageCbor: Buffer;
  decodedReferenceInputsPreimageCbor: Buffer;
  requiredObserversPreimageCbor: Buffer;
  decodedSpendInputsPreimageCbor: Buffer;
  fee: bigint;
  mintPreimageCbor: Buffer;
  networkId: bigint;
  requiredSignersPreimageCbor: Buffer;
  validityIntervalEnd: bigint;
  validityIntervalStart: bigint;
} => {
  const bodyReader = new Serialization.CborReader(bodyBytes.toString('hex'));

  readStartArray(bodyReader, MIDGARD_BODY_ARRAY_LENGTH, 'transaction_full[2]');
  bodyReader.readByteString();
  const decodedSpendInputsPreimageCbor = Buffer.from(bodyReader.readByteString());
  bodyReader.readByteString();
  const decodedReferenceInputsPreimageCbor = Buffer.from(bodyReader.readByteString());
  bodyReader.readByteString();
  const decodedOutputsPreimageCbor = Buffer.from(bodyReader.readByteString());
  const fee = readUnsignedInt(bodyReader, 'transaction_full[2][6]');
  const validityIntervalStart = readSignedInt(bodyReader);
  const validityIntervalEnd = readSignedInt(bodyReader);
  bodyReader.readByteString();
  const requiredObserversPreimageCbor = Buffer.from(bodyReader.readByteString());
  bodyReader.readByteString();
  const requiredSignersPreimageCbor = Buffer.from(bodyReader.readByteString());
  bodyReader.readByteString();
  const mintPreimageCbor = Buffer.from(bodyReader.readByteString());
  bodyReader.readByteString();
  bodyReader.readByteString();
  const networkId = readUnsignedInt(bodyReader, 'transaction_full[2][17]');
  bodyReader.readEndArray();

  return {
    decodedOutputsPreimageCbor,
    decodedReferenceInputsPreimageCbor,
    decodedSpendInputsPreimageCbor,
    fee,
    mintPreimageCbor,
    networkId,
    requiredObserversPreimageCbor,
    requiredSignersPreimageCbor,
    validityIntervalEnd,
    validityIntervalStart
  };
};

export const decodeMidgardHistoryTx = (txHex: string, syntheticBlockNo = 1): Cardano.HydratedTx => {
  const reader = new Serialization.CborReader(txHex);
  const txBytes = Buffer.from(txHex, 'hex');

  readStartArray(reader, MIDGARD_FULL_ARRAY_LENGTH, 'transaction_full');

  readVersion(reader, 'transaction_full[0]');
  const compactBytes = Buffer.from(reader.readEncodedValue());
  const compactReader = new Serialization.CborReader(compactBytes.toString('hex'));
  readStartArray(compactReader, MIDGARD_COMPACT_ARRAY_LENGTH, 'transaction_full[1]');
  readVersion(compactReader, 'transaction_full[1][0]');
  const transactionBodyHash = Buffer.from(compactReader.readByteString());
  compactReader.readByteString();
  readUnsignedInt(compactReader, 'transaction_full[1][3]');
  compactReader.readEndArray();

  const bodyBytes = Buffer.from(reader.readEncodedValue());
  const {
    decodedOutputsPreimageCbor,
    decodedReferenceInputsPreimageCbor,
    decodedSpendInputsPreimageCbor,
    fee,
    mintPreimageCbor,
    networkId,
    requiredObserversPreimageCbor,
    requiredSignersPreimageCbor,
    validityIntervalEnd,
    validityIntervalStart
  } = parseMidgardBody(bodyBytes);

  const witnessReader = new Serialization.CborReader(Buffer.from(reader.readEncodedValue()).toString('hex'));
  readStartArray(witnessReader, MIDGARD_WITNESS_ARRAY_LENGTH, 'transaction_full[3]');
  while (witnessReader.peekState() !== Serialization.CborReaderState.EndArray) {
    witnessReader.skipValue();
  }
  witnessReader.readEndArray();
  reader.readEndArray();

  const txId = Cardano.TransactionId(transactionBodyHash.toString('hex'));
  const validityInterval = decodeValidityInterval(validityIntervalStart, validityIntervalEnd);
  const decodedNetworkId = decodeNetworkId(networkId);
  const blockSlot =
    validityInterval?.invalidHereafter ?? validityInterval?.invalidBefore ?? Cardano.Slot(syntheticBlockNo);

  return withMidgardTxProvenance({
    auxiliaryData: undefined,
    blockHeader: {
      blockNo: Cardano.BlockNo(syntheticBlockNo),
      hash: Cardano.BlockId(ZERO_BLOCK_HASH),
      slot: blockSlot
    },
    body: {
      fee,
      inputs: decodeNativeInputs(decodedSpendInputsPreimageCbor) as never,
      mint: decodeMint(mintPreimageCbor),
      networkId: decodedNetworkId,
      outputs: decodeNativeOutputs(decodedOutputsPreimageCbor),
      referenceInputs: decodeNativeInputs(decodedReferenceInputsPreimageCbor) as never,
      withdrawals: decodeRequiredObservers(requiredObserversPreimageCbor, decodedNetworkId),
      requiredExtraSignatures: decodeRequiredSigners(requiredSignersPreimageCbor),
      validityInterval
    },
    id: txId,
    index: 0,
    inputSource: Cardano.InputSource.inputs,
    txSize: txBytes.length,
    witness: {
      signatures: new Map()
    }
  }, MidgardTxProvenance.Layer2Native);
};

export const decodeMidgardPendingTx = (txHex: string): Cardano.HydratedTx => decodeMidgardHistoryTx(txHex, 0);
