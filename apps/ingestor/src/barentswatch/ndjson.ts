const DEFAULT_MAX_BUFFER_BYTES = 1_048_576;

export async function* parseNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > maxBufferBytes && !buffer.includes("\n")) {
        throw new Error(`NDJSON line exceeded ${maxBufferBytes} bytes`);
      }

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as unknown;
        newline = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    const finalLine = buffer.trim();
    if (finalLine) yield JSON.parse(finalLine) as unknown;
  } finally {
    reader.releaseLock();
  }
}
