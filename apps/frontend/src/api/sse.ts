function parseSseChunk<T>(rawEvent: string): T | null {
  const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'));
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine.slice(5).trim()) as T;
  } catch {
    return null;
  }
}

export async function* consumeSseStream<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) {
    throw new Error('Resposta sem corpo (SSE).');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const rawEvents = buffer.split('\n\n');
      buffer = rawEvents.pop() ?? '';

      for (const rawEvent of rawEvents) {
        const event = parseSseChunk<T>(rawEvent);
        if (event) yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
