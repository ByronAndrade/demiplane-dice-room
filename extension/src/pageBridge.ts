const source = "demiplane-dice-room-page";

export {};

type DiceRollApiPayload = {
  roll?: string;
  values: number[];
};

type DiceRollApiResponse = {
  raw_dice?: {
    parts?: Array<{
      type?: string;
      dice?: Array<{
        type?: string;
        value?: number;
        size?: number;
      }>;
    }>;
  };
};

declare global {
  interface Window {
    __demiplaneDiceRoomPageBridgeLoaded?: boolean;
  }
}

if (!window.__demiplaneDiceRoomPageBridgeLoaded) {
  window.__demiplaneDiceRoomPageBridgeLoaded = true;
  patchFetch();
  patchXhr();
}

function patchFetch(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await originalFetch(...args);
    const url = getFetchUrl(args[0], response.url);
    if (isDiceRollUrl(url)) {
      void response
        .clone()
        .text()
        .then((text) => publishDiceRollResponse(url, text))
        .catch(() => undefined);
    }

    return response;
  };
}

function patchXhr(): void {
  const xhrPrototype = XMLHttpRequest.prototype as unknown as {
    open: (...args: unknown[]) => void;
    send: (...args: unknown[]) => void;
  };
  const originalOpen = xhrPrototype.open;
  const originalSend = xhrPrototype.send;
  const requestUrlByXhr = new WeakMap<XMLHttpRequest, string>();

  xhrPrototype.open = function patchedOpen(this: XMLHttpRequest, ...args: unknown[]): void {
    const url = args[1];
    if (typeof url === "string" || url instanceof URL) {
      requestUrlByXhr.set(this, String(url));
    }

    return originalOpen.apply(this, args);
  };

  xhrPrototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]): void {
    this.addEventListener("loadend", () => {
      const url = requestUrlByXhr.get(this);
      const responseText = readXhrResponseText(this);
      if (!url || !isDiceRollUrl(url) || !responseText) {
        return;
      }

      publishDiceRollResponse(url, responseText);
    });

    return originalSend.apply(this, args);
  };
}

function readXhrResponseText(xhr: XMLHttpRequest): string | undefined {
  try {
    return typeof xhr.responseText === "string" ? xhr.responseText : undefined;
  } catch {
    return undefined;
  }
}

function getFetchUrl(input: RequestInfo | URL, fallbackUrl: string): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url || fallbackUrl;
}

function isDiceRollUrl(url: string): boolean {
  return url.includes("/dice-roll");
}

function publishDiceRollResponse(url: string, responseText: string): void {
  const payload = parseDiceRollApiPayload(url, responseText);
  if (!payload || payload.values.length === 0) {
    return;
  }

  window.postMessage(
    {
      source,
      kind: "dice-roll-api-response",
      payload
    },
    "*"
  );
}

function parseDiceRollApiPayload(url: string, responseText: string): DiceRollApiPayload | undefined {
  const data = parseJson(responseText);
  if (!data) {
    return undefined;
  }

  const values = extractDiceValues(data);
  return {
    roll: getRollParam(url),
    values
  };
}

function parseJson(responseText: string): DiceRollApiResponse | undefined {
  try {
    const data = JSON.parse(responseText) as DiceRollApiResponse;
    return typeof data === "object" && data !== null ? data : undefined;
  } catch {
    return undefined;
  }
}

function getRollParam(url: string): string | undefined {
  try {
    return new URL(url, window.location.href).searchParams.get("roll") ?? undefined;
  } catch {
    return undefined;
  }
}

function extractDiceValues(data: DiceRollApiResponse): number[] {
  const parts = data.raw_dice?.parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  const values: number[] = [];
  for (const part of parts) {
    if (part.type !== "dice" || !Array.isArray(part.dice)) {
      continue;
    }

    for (const die of part.dice) {
      if (die.type !== "single_dice" || die.size !== 10 || typeof die.value !== "number") {
        continue;
      }

      values.push(die.value);
    }
  }

  return values;
}
