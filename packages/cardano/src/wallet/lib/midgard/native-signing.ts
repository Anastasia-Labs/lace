import { Cardano, Serialization } from '@cardano-sdk/core';
import blake2b from 'blake2b-no-wasm';

const MIDGARD_NATIVE_TX_VERSION = 1n;
const MIDGARD_POSIX_TIME_NONE = -1n;
const MIDGARD_NATIVE_NETWORK_ID_NONE = 255n;
const MIDGARD_HASH_BYTES = 32;

type MidgardHash = Buffer;
type MidgardTxValidity = 'FailedScript' | 'TxIsValid';

export interface MidgardUnsignedCardanoPreview {
  auxiliaryData?: Cardano.AuxiliaryData;
  body: Cardano.TxBody;
}

export interface MidgardNativeSignatureWitness {
  publicKey: string;
  signature: string;
}

export interface MidgardNativeTxBodyCanonical {
  auxiliaryDataHash: MidgardHash;
  fee: bigint;
  mintPreimageCbor: Buffer;
  networkId: bigint;
  outputsPreimageCbor: Buffer;
  referenceInputsPreimageCbor: Buffer;
  requiredObserversPreimageCbor: Buffer;
  requiredSignersPreimageCbor: Buffer;
  scriptIntegrityHash: MidgardHash;
  spendInputsPreimageCbor: Buffer;
  validityIntervalEnd: bigint;
  validityIntervalStart: bigint;
}

export interface MidgardNativeTxBodyFull {
  auxiliaryDataHash: MidgardHash;
  fee: bigint;
  mintPreimageCbor: Buffer;
  mintRoot: MidgardHash;
  networkId: bigint;
  outputsPreimageCbor: Buffer;
  outputsRoot: MidgardHash;
  referenceInputsPreimageCbor: Buffer;
  referenceInputsRoot: MidgardHash;
  requiredObserversPreimageCbor: Buffer;
  requiredObserversRoot: MidgardHash;
  requiredSignersPreimageCbor: Buffer;
  requiredSignersRoot: MidgardHash;
  scriptIntegrityHash: MidgardHash;
  spendInputsPreimageCbor: Buffer;
  spendInputsRoot: MidgardHash;
  validityIntervalEnd: bigint;
  validityIntervalStart: bigint;
}

export interface MidgardNativeTxWitnessSetCanonical {
  addrTxWitsPreimageCbor: Buffer;
  datumTxWitsPreimageCbor: Buffer;
  redeemerTxWitsPreimageCbor: Buffer;
  scriptTxWitsPreimageCbor: Buffer;
}

export interface MidgardNativeTxWitnessSetFull {
  addrTxWitsPreimageCbor: Buffer;
  addrTxWitsRoot: MidgardHash;
  datumTxWitsPreimageCbor: Buffer;
  datumTxWitsRoot: MidgardHash;
  redeemerTxWitsPreimageCbor: Buffer;
  redeemerTxWitsRoot: MidgardHash;
  scriptTxWitsPreimageCbor: Buffer;
  scriptTxWitsRoot: MidgardHash;
}

export interface MidgardNativeTxCompact {
  transactionBodyHash: MidgardHash;
  transactionWitnessSetHash: MidgardHash;
  validity: MidgardTxValidity;
  version: bigint;
}

export interface MidgardNativeTxFull {
  body: MidgardNativeTxBodyFull;
  compact: MidgardNativeTxCompact;
  version: bigint;
  witnessSet: MidgardNativeTxWitnessSetFull;
}

export interface MidgardNativeTxDraft {
  cardanoPreviewCbor: Serialization.TxCBOR;
  signingHash: string;
  tx: MidgardNativeTxFull;
  txId: Cardano.TransactionId;
}

export interface MidgardSignedTx {
  cbor: string;
  signingHash: string;
  tx: MidgardNativeTxFull;
  txId: Cardano.TransactionId;
}

const sortCanonically = <T extends string>(lhs: readonly [T, unknown], rhs: readonly [T, unknown]): number => {
  if (lhs[0].length === rhs[0].length) {
    return lhs[0] > rhs[0] ? 1 : -1;
  }

  return lhs[0].length > rhs[0].length ? 1 : -1;
};

const encodeEmptyList = (): Buffer => {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(0);
  return Buffer.from(writer.encode());
};

const EMPTY_LIST_CBOR = encodeEmptyList();

const encodeNull = (): Buffer => {
  const writer = new Serialization.CborWriter();
  writer.writeNull();
  return Buffer.from(writer.encode());
};

const computeHash32 = (value: Uint8Array): MidgardHash =>
  Buffer.from(blake2b(MIDGARD_HASH_BYTES).update(Uint8Array.from(value)).digest('binary'));

const EMPTY_HASH = computeHash32(encodeNull());

const encodeByteStringArray = (items: Uint8Array[]): Buffer => {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(items.length);
  for (const item of items) {
    writer.writeByteString(item);
  }

  return Buffer.from(writer.encode());
};

const encodeMintPreimage = (mint?: Cardano.TokenMap): Buffer => {
  if (!mint || mint.size === 0) {
    return EMPTY_LIST_CBOR;
  }

  const multiassets = new Map<string, Map<string, bigint>>();
  const sortedTokenMap = new Map([...mint.entries()].sort(sortCanonically));

  for (const [assetId, quantity] of sortedTokenMap.entries()) {
    const policyId = Cardano.AssetId.getPolicyId(assetId);
    const assetName = Cardano.AssetId.getAssetName(assetId);
    if (!multiassets.has(policyId)) {
      multiassets.set(policyId, new Map());
    }
    const assetsForPolicy = multiassets.get(policyId);
    if (!assetsForPolicy) {
      throw new Error(`Failed to collect assets for policy ${policyId}`);
    }
    assetsForPolicy.set(assetName, quantity);
  }

  const writer = new Serialization.CborWriter();
  writer.writeStartMap(multiassets.size);
  for (const [policyId, assets] of [...multiassets.entries()].sort(sortCanonically)) {
    writer.writeByteString(Buffer.from(policyId, 'hex'));
    const sortedAssets = [...assets.entries()].sort(sortCanonically);
    writer.writeStartMap(sortedAssets.length);
    for (const [assetName, quantity] of sortedAssets) {
      writer.writeByteString(Buffer.from(assetName, 'hex'));
      writer.writeInt(quantity);
    }
  }

  return Buffer.from(writer.encode());
};

const encodeInputPreimage = (inputs: Cardano.TxIn[]): Buffer =>
  encodeByteStringArray(inputs.map((input) => Buffer.from(Serialization.TransactionInput.fromCore(input).toCbor(), 'hex')));

const encodeOutputPreimage = (outputs: Cardano.TxOut[]): Buffer =>
  encodeByteStringArray(
    outputs.map((output) => Buffer.from(Serialization.TransactionOutput.fromCore(output).toCbor(), 'hex'))
  );

const encodeRequiredSignersPreimage = (requiredSigners?: Cardano.TxBody['requiredExtraSignatures']): Buffer => {
  if (!requiredSigners || requiredSigners.length === 0) {
    return EMPTY_LIST_CBOR;
  }

  return encodeByteStringArray(requiredSigners.map((signer) => Buffer.from(signer, 'hex')));
};

const encodeRequiredObserversPreimage = (withdrawals?: Cardano.TxBody['withdrawals']): Buffer => {
  if (!withdrawals || withdrawals.length === 0) {
    return EMPTY_LIST_CBOR;
  }

  return encodeByteStringArray(
    withdrawals
      .map(({ quantity, stakeAddress }) => {
        if (quantity !== 0n) {
          throw new Error('Midgard native signing only supports zero-ADA script withdrawals in phase 1');
        }

        const address = Cardano.Address.fromString(stakeAddress);
        if (!address) {
          throw new Error('Midgard native signing requires valid reward accounts for withdrawals in phase 1');
        }

        const rewardAddress = Cardano.RewardAddress.fromAddress(address);
        if (!rewardAddress) {
          throw new Error('Midgard native signing requires valid reward accounts for withdrawals in phase 1');
        }

        const credential = rewardAddress.getPaymentCredential();
        if (credential.type !== Cardano.CredentialType.ScriptHash) {
          throw new Error('Midgard native signing only supports script withdrawals in phase 1');
        }

        return Buffer.from(credential.hash, 'hex');
      })
      .sort((lhs, rhs) => Buffer.compare(lhs, rhs))
  );
};

const encodeHash32 = (hash: string, fieldName: string): MidgardHash => {
  const encoded = Buffer.from(hash, 'hex');
  if (encoded.length !== MIDGARD_HASH_BYTES) {
    throw new Error(`${fieldName} must be ${MIDGARD_HASH_BYTES} bytes`);
  }

  return encoded;
};

const encodeUnsignedInt = (writer: Serialization.CborWriter, value: bigint | number, fieldName: string): void => {
  const intValue = BigInt(value);
  if (intValue < 0n) {
    throw new Error(`${fieldName} must be unsigned`);
  }

  writer.writeInt(intValue);
};

const encodeBodyCompact = ({
  auxiliaryDataHash,
  fee,
  mintRoot,
  networkId,
  outputsRoot,
  referenceInputsRoot,
  requiredObserversRoot,
  requiredSignersRoot,
  scriptIntegrityHash,
  spendInputsRoot,
  validityIntervalEnd,
  validityIntervalStart
}: MidgardNativeTxBodyFull): Buffer => {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(12);
  writer.writeByteString(spendInputsRoot);
  writer.writeByteString(referenceInputsRoot);
  writer.writeByteString(outputsRoot);
  encodeUnsignedInt(writer, fee, 'midgard.body.fee');
  writer.writeInt(validityIntervalStart);
  writer.writeInt(validityIntervalEnd);
  writer.writeByteString(requiredObserversRoot);
  writer.writeByteString(requiredSignersRoot);
  writer.writeByteString(mintRoot);
  writer.writeByteString(scriptIntegrityHash);
  writer.writeByteString(auxiliaryDataHash);
  encodeUnsignedInt(writer, networkId, 'midgard.body.networkId');

  return Buffer.from(writer.encode());
};

const encodeWitnessSetCompact = (witnessSet: MidgardNativeTxWitnessSetFull): Buffer => {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(4);
  writer.writeByteString(witnessSet.addrTxWitsRoot);
  writer.writeByteString(witnessSet.scriptTxWitsRoot);
  writer.writeByteString(witnessSet.redeemerTxWitsRoot);
  writer.writeByteString(witnessSet.datumTxWitsRoot);

  return Buffer.from(writer.encode());
};

const encodeMidgardNativeTxCompact = (compact: MidgardNativeTxCompact): Buffer => {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(4);
  encodeUnsignedInt(writer, compact.version, 'midgard.compact.version');
  writer.writeByteString(compact.transactionBodyHash);
  writer.writeByteString(compact.transactionWitnessSetHash);
  writer.writeInt(compact.validity === 'TxIsValid' ? 0n : 3n);

  return Buffer.from(writer.encode());
};

const encodeMidgardNativeTxBodyFull = (body: MidgardNativeTxBodyFull): Buffer => {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(18);
  writer.writeByteString(body.spendInputsRoot);
  writer.writeByteString(body.spendInputsPreimageCbor);
  writer.writeByteString(body.referenceInputsRoot);
  writer.writeByteString(body.referenceInputsPreimageCbor);
  writer.writeByteString(body.outputsRoot);
  writer.writeByteString(body.outputsPreimageCbor);
  encodeUnsignedInt(writer, body.fee, 'midgard.body.fee');
  writer.writeInt(body.validityIntervalStart);
  writer.writeInt(body.validityIntervalEnd);
  writer.writeByteString(body.requiredObserversRoot);
  writer.writeByteString(body.requiredObserversPreimageCbor);
  writer.writeByteString(body.requiredSignersRoot);
  writer.writeByteString(body.requiredSignersPreimageCbor);
  writer.writeByteString(body.mintRoot);
  writer.writeByteString(body.mintPreimageCbor);
  writer.writeByteString(body.scriptIntegrityHash);
  writer.writeByteString(body.auxiliaryDataHash);
  encodeUnsignedInt(writer, body.networkId, 'midgard.body.networkId');

  return Buffer.from(writer.encode());
};

const encodeMidgardNativeTxWitnessSetFull = (witnessSet: MidgardNativeTxWitnessSetFull): Buffer => {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(8);
  writer.writeByteString(witnessSet.addrTxWitsRoot);
  writer.writeByteString(witnessSet.addrTxWitsPreimageCbor);
  writer.writeByteString(witnessSet.scriptTxWitsRoot);
  writer.writeByteString(witnessSet.scriptTxWitsPreimageCbor);
  writer.writeByteString(witnessSet.redeemerTxWitsRoot);
  writer.writeByteString(witnessSet.redeemerTxWitsPreimageCbor);
  writer.writeByteString(witnessSet.datumTxWitsRoot);
  writer.writeByteString(witnessSet.datumTxWitsPreimageCbor);

  return Buffer.from(writer.encode());
};

const encodeMidgardNativeTxFull = (tx: MidgardNativeTxFull): string => {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(4);
  encodeUnsignedInt(writer, tx.version, 'midgard.version');
  writer.writeEncodedValue(encodeMidgardNativeTxCompact(tx.compact));
  writer.writeEncodedValue(encodeMidgardNativeTxBodyFull(tx.body));
  writer.writeEncodedValue(encodeMidgardNativeTxWitnessSetFull(tx.witnessSet));

  return Buffer.from(writer.encode()).toString('hex');
};

const materializeBody = (body: MidgardNativeTxBodyCanonical): MidgardNativeTxBodyFull => ({
  auxiliaryDataHash: body.auxiliaryDataHash,
  fee: body.fee,
  mintPreimageCbor: body.mintPreimageCbor,
  mintRoot: computeHash32(body.mintPreimageCbor),
  networkId: body.networkId,
  outputsPreimageCbor: body.outputsPreimageCbor,
  outputsRoot: computeHash32(body.outputsPreimageCbor),
  referenceInputsPreimageCbor: body.referenceInputsPreimageCbor,
  referenceInputsRoot: computeHash32(body.referenceInputsPreimageCbor),
  requiredObserversPreimageCbor: body.requiredObserversPreimageCbor,
  requiredObserversRoot: computeHash32(body.requiredObserversPreimageCbor),
  requiredSignersPreimageCbor: body.requiredSignersPreimageCbor,
  requiredSignersRoot: computeHash32(body.requiredSignersPreimageCbor),
  scriptIntegrityHash: body.scriptIntegrityHash,
  spendInputsPreimageCbor: body.spendInputsPreimageCbor,
  spendInputsRoot: computeHash32(body.spendInputsPreimageCbor),
  validityIntervalEnd: body.validityIntervalEnd,
  validityIntervalStart: body.validityIntervalStart
});

const materializeWitnessSet = (witnessSet: MidgardNativeTxWitnessSetCanonical): MidgardNativeTxWitnessSetFull => ({
  addrTxWitsPreimageCbor: witnessSet.addrTxWitsPreimageCbor,
  addrTxWitsRoot: computeHash32(witnessSet.addrTxWitsPreimageCbor),
  datumTxWitsPreimageCbor: witnessSet.datumTxWitsPreimageCbor,
  datumTxWitsRoot: computeHash32(witnessSet.datumTxWitsPreimageCbor),
  redeemerTxWitsPreimageCbor: witnessSet.redeemerTxWitsPreimageCbor,
  redeemerTxWitsRoot: computeHash32(witnessSet.redeemerTxWitsPreimageCbor),
  scriptTxWitsPreimageCbor: witnessSet.scriptTxWitsPreimageCbor,
  scriptTxWitsRoot: computeHash32(witnessSet.scriptTxWitsPreimageCbor)
});

const deriveCompact = (
  body: MidgardNativeTxBodyFull,
  witnessSet: MidgardNativeTxWitnessSetFull,
  validity: MidgardTxValidity
): MidgardNativeTxCompact => ({
  transactionBodyHash: computeHash32(encodeBodyCompact(body)),
  transactionWitnessSetHash: computeHash32(encodeWitnessSetCompact(witnessSet)),
  validity,
  version: MIDGARD_NATIVE_TX_VERSION
});

const computeTxId = (compact: MidgardNativeTxCompact): Cardano.TransactionId =>
  Cardano.TransactionId(Buffer.from(compact.transactionBodyHash).toString('hex'));

const assertUnsupportedField = (condition: boolean, fieldName: string): void => {
  if (condition) {
    throw new Error(`Midgard native signing does not support ${fieldName} in phase 1`);
  }
};

const assertSupportedCardanoPreview = ({ auxiliaryData, body }: MidgardUnsignedCardanoPreview): void => {
  assertUnsupportedField(Boolean(auxiliaryData), 'auxiliary data');
  assertUnsupportedField(Boolean(body.auxiliaryDataHash), 'auxiliary data hashes');
  assertUnsupportedField(Boolean(body.certificates?.length), 'certificates');
  assertUnsupportedField(Boolean(body.collaterals?.length), 'collaterals');
  assertUnsupportedField(Boolean(body.collateralReturn), 'collateral return');
  assertUnsupportedField(body.totalCollateral !== undefined, 'total collateral');
  assertUnsupportedField(Boolean(body.update), 'protocol updates');
  assertUnsupportedField(Boolean(body.votingProcedures?.length), 'voting procedures');
  assertUnsupportedField(Boolean(body.proposalProcedures?.length), 'proposal procedures');
  assertUnsupportedField(body.donation !== undefined, 'donations');
};

const getValidityStart = (body: Cardano.TxBody): bigint =>
  body.validityInterval?.invalidBefore !== undefined
    ? BigInt(body.validityInterval.invalidBefore)
    : MIDGARD_POSIX_TIME_NONE;

const getValidityEnd = (body: Cardano.TxBody): bigint =>
  body.validityInterval?.invalidHereafter !== undefined
    ? BigInt(body.validityInterval.invalidHereafter)
    : MIDGARD_POSIX_TIME_NONE;

const getNetworkId = (body: Cardano.TxBody): bigint =>
  body.networkId !== undefined ? BigInt(body.networkId) : MIDGARD_NATIVE_NETWORK_ID_NONE;

// This phase-1 entrypoint only has preview-body data plus locally produced vkey
// witnesses. Body-level Midgard fields can be preserved here, but full external
// script/redeemer/datum witness bundles need a wider API surface.
const toCanonicalBody = ({ body }: MidgardUnsignedCardanoPreview): MidgardNativeTxBodyCanonical => ({
  auxiliaryDataHash: EMPTY_HASH,
  fee: body.fee,
  mintPreimageCbor: encodeMintPreimage(body.mint),
  networkId: getNetworkId(body),
  outputsPreimageCbor: encodeOutputPreimage(body.outputs),
  referenceInputsPreimageCbor: encodeInputPreimage(body.referenceInputs ?? []),
  requiredObserversPreimageCbor: encodeRequiredObserversPreimage(body.withdrawals),
  requiredSignersPreimageCbor: encodeRequiredSignersPreimage(body.requiredExtraSignatures),
  scriptIntegrityHash: body.scriptIntegrityHash
    ? encodeHash32(body.scriptIntegrityHash, 'Midgard native signing script integrity hash')
    : EMPTY_HASH,
  spendInputsPreimageCbor: encodeInputPreimage(body.inputs),
  validityIntervalEnd: getValidityEnd(body),
  validityIntervalStart: getValidityStart(body)
});

const emptyWitnessSet = (): MidgardNativeTxWitnessSetCanonical => ({
  addrTxWitsPreimageCbor: EMPTY_LIST_CBOR,
  datumTxWitsPreimageCbor: EMPTY_LIST_CBOR,
  redeemerTxWitsPreimageCbor: EMPTY_LIST_CBOR,
  scriptTxWitsPreimageCbor: EMPTY_LIST_CBOR
});

const serializeWitnesses = (witnesses: MidgardNativeSignatureWitness[]): Buffer => {
  const uniqueWitnesses = [...new Map(witnesses.map((witness) => [witness.publicKey, witness])).values()].sort((lhs, rhs) =>
    lhs.publicKey.localeCompare(rhs.publicKey)
  );

  return encodeByteStringArray(
    uniqueWitnesses.map((witness) =>
      Buffer.from(Serialization.VkeyWitness.fromCore([witness.publicKey, witness.signature]).toCbor(), 'hex')
    )
  );
};

export const serializeUnsignedCardanoPreviewTx = ({
  auxiliaryData,
  body
}: MidgardUnsignedCardanoPreview): Serialization.TxCBOR =>
  new Serialization.Transaction(
    Serialization.TransactionBody.fromCore(body),
    Serialization.TransactionWitnessSet.fromCore({ signatures: new Map() }),
    auxiliaryData ? Serialization.AuxiliaryData.fromCore(auxiliaryData) : undefined
  ).toCbor();

export const createMidgardNativeTxDraft = (preview: MidgardUnsignedCardanoPreview): MidgardNativeTxDraft => {
  assertSupportedCardanoPreview(preview);

  const cardanoPreviewCbor = serializeUnsignedCardanoPreviewTx(preview);
  const body = materializeBody(toCanonicalBody(preview));
  const witnessSet = materializeWitnessSet(emptyWitnessSet());
  const compact = deriveCompact(body, witnessSet, 'TxIsValid');
  const tx: MidgardNativeTxFull = {
    body,
    compact,
    version: MIDGARD_NATIVE_TX_VERSION,
    witnessSet
  };

  return {
    cardanoPreviewCbor,
    signingHash: compact.transactionBodyHash.toString('hex'),
    tx,
    txId: computeTxId(compact)
  };
};

export const assembleMidgardSignedTx = (
  draft: MidgardNativeTxDraft,
  witnesses: MidgardNativeSignatureWitness[]
): MidgardSignedTx => {
  const witnessSet = materializeWitnessSet({
    addrTxWitsPreimageCbor: serializeWitnesses(witnesses),
    datumTxWitsPreimageCbor: EMPTY_LIST_CBOR,
    redeemerTxWitsPreimageCbor: EMPTY_LIST_CBOR,
    scriptTxWitsPreimageCbor: EMPTY_LIST_CBOR
  });
  const compact = deriveCompact(draft.tx.body, witnessSet, draft.tx.compact.validity);
  const tx: MidgardNativeTxFull = {
    body: draft.tx.body,
    compact,
    version: draft.tx.version,
    witnessSet
  };

  return {
    cbor: encodeMidgardNativeTxFull(tx),
    signingHash: compact.transactionBodyHash.toString('hex'),
    tx,
    txId: computeTxId(compact)
  };
};

export const computeMidgardNativeTxId = (tx: Pick<MidgardNativeTxFull, 'compact'>): Cardano.TransactionId =>
  computeTxId(tx.compact);
