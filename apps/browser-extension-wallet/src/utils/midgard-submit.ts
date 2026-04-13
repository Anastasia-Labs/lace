import { trimTrailingSlashes } from './midgard-url';

type MidgardSubmitResponse = {
  txId?: string;
  status?: string;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();

    if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
      return payload.error;
    }
  } catch {
    // Fall through to the HTTP status below when the response body is not JSON.
  }

  return `HTTP ${response.status}`;
};

export const submitMidgardTx = async ({
  expectedTxId,
  signedTxCbor,
  midgardUrl
}: {
  expectedTxId?: string;
  signedTxCbor: string;
  midgardUrl: string;
}): Promise<string> => {
  const response = await fetch(`${trimTrailingSlashes(midgardUrl)}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      // eslint-disable-next-line camelcase
      tx_cbor: signedTxCbor
    })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as MidgardSubmitResponse;
  if (typeof payload.txId !== 'string' || payload.txId.length === 0) {
    throw new Error('Midgard submit endpoint returned an invalid transaction id');
  }

  if (payload.status !== 'queued') {
    throw new Error(`Unexpected Midgard submit status: ${String(payload.status)}`);
  }

  if (expectedTxId && payload.txId !== expectedTxId) {
    throw new Error(`Midgard submit tx id mismatch: expected ${expectedTxId}, got ${payload.txId}`);
  }

  return payload.txId;
};
